import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { ReplanJob, QueueService } from '../queue.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Processor('replan')
export class ReplanProcessor {
  private readonly logger = new Logger(ReplanProcessor.name);
  private geminiKeys: string[] = [];
  private geminiKeyIndex = 0;

  constructor(
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
  ) {
    // Load all available Gemini keys for rotation
    const keys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean) as string[];
    
    this.geminiKeys = keys;
    if (keys.length === 0) {
      this.logger.warn('No GEMINI_API_KEY found — replan processor disabled');
    } else {
      this.logger.log(`🔑 Replan processor loaded ${keys.length} Gemini key(s)`);
    }
  }

  /**
   * Call Gemini with automatic key rotation on 429/quota errors.
   */
  private async callGemini(prompt: string, maxRetries = 3): Promise<string> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const key = this.geminiKeys[this.geminiKeyIndex % this.geminiKeys.length];
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      try {
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || '';
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
          this.geminiKeyIndex++;
          this.logger.warn(`Gemini key rotated (replan) → key #${(this.geminiKeyIndex % this.geminiKeys.length) + 1}`);
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  @Process('execute-replan')
  async handleReplan(job: Job<ReplanJob>): Promise<any> {
    const { tripId, userId, reason, affectedDays, context } = job.data;
    
    this.logger.log(`🔄 Executing replan for trip ${tripId}`);
    this.logger.log(`   Reason: ${reason}`);
    this.logger.log(`   Affected days: ${affectedDays.join(', ')}`);

    try {
      if (this.geminiKeys.length === 0) {
        throw new Error('AI engine not configured (no GEMINI_API_KEY found)');
      }

      // Build replan prompt based on reason
      const prompt = this.buildReplanPrompt(reason, affectedDays, context);
      
      // Call Gemini with key rotation
      const text = await this.callGemini(prompt);

      // Parse AI response
      const updatedActivities = this.parseReplanResponse(text);

      if (updatedActivities.length > 0) {
        // ── Create proposal for user consent (don't auto-apply) ──────────
        const summary = this.getUpdateMessage(reason, affectedDays.length);
        const proposalId = await this.queueService.createProposal(
          tripId, userId, reason, affectedDays, updatedActivities, context, summary,
        );

        // Notify user with consent action required
        await this.queueService.queueNotification(userId, 'REPLAN_PROPOSED', {
          tripId,
          proposalId,
          reason,
          affectedDays,
          changes: updatedActivities,
          message: summary,
          actionRequired: true,
        });

        this.logger.log(`✅ Replan proposal ${proposalId} created. ${updatedActivities.length} change(s) awaiting user consent.`);
        return {
          success: true,
          tripId,
          reason,
          affectedDays,
          proposalId,
          proposedChanges: updatedActivities,
        };
      }

      return { success: true, tripId, noChangesNeeded: true };
    } catch (error) {
      const is429 = error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED');
      
      if (is429) {
        this.logger.warn(`⚠️ Replan skipped for ${tripId} — all Gemini keys rate-limited. Will retry on next weather check cycle.`);
        // DON'T throw — swallow 429 errors to prevent infinite BullMQ retries
        // The next weather monitoring cycle (6h later) will re-trigger if needed
        await this.queueService.queueNotification(userId, 'REPLAN_DELAYED', {
          tripId,
          reason,
          error: 'AI service is temporarily busy. Your itinerary will be updated automatically when available.',
        });
        return { success: false, tripId, reason: 'rate_limited', retryLater: true };
      }

      this.logger.error(`Replan failed: ${error.message}`);
      
      // Notify user of failure
      await this.queueService.queueNotification(userId, 'REPLAN_FAILED', {
        tripId,
        reason,
        error: 'Unable to automatically replan. Please review your itinerary manually.',
      });

      throw error;
    }
  }

  private buildReplanPrompt(
    reason: string,
    affectedDays: number[],
    context: any,
  ): string {
    let prompt = `You are an intelligent travel replanning assistant. `;

    switch (reason) {
      case 'weather':
        prompt += `
Due to weather changes, we need to replan the following days: ${affectedDays.join(', ')}.

Weather conditions detected:
${JSON.stringify(context.detectedConditions, null, 2)}

Current activities for these days that need alternatives:
${JSON.stringify(context.currentActivities || [], null, 2)}

Please suggest indoor alternatives or reschedule outdoor activities to days with better weather.
Maintain the same budget level and travel style.

Respond with a JSON array of replacement activities:
[
  {
    "day": 1,
    "originalActivity": "Beach visit",
    "newActivity": "Visit local museum",
    "reason": "Rain expected",
    "time": "10:00 AM",
    "duration": "2 hours",
    "estimatedCost": 500
  }
]`;
        break;

      case 'crowd':
        prompt += `
High crowd levels detected at certain locations. Suggest alternative timings or venues.

Problematic locations:
${JSON.stringify(context.crowdData || [], null, 2)}

Suggest optimal visit times or alternative attractions with similar experiences.

Respond with a JSON array of adjustments:
[
  {
    "day": 1,
    "location": "Taj Mahal",
    "issue": "Very high crowds expected",
    "suggestion": "Visit at 6:00 AM instead",
    "alternative": "Mehtab Bagh for sunset view"
  }
]`;
        break;

      case 'availability':
        prompt += `
Some attractions or services are unavailable. Please suggest alternatives.

Unavailable items:
${JSON.stringify(context.unavailable || [], null, 2)}

Suggest similar alternatives maintaining the trip's quality and budget.

Respond with a JSON array:
[
  {
    "day": 1,
    "unavailable": "Restaurant XYZ",
    "alternative": "Restaurant ABC",
    "reason": "Closed for renovation",
    "impactOnBudget": 0
  }
]`;
        break;

      case 'transport_delay':
        prompt += `
Traffic delays detected on today's activity routes.

Delay details:
${JSON.stringify(context.delayedRoutes || context, null, 2)}

Push back start times by the delay amount. Drop the lowest-priority activity if the day runs short. Keep hotel/meals unchanged.

Respond with JSON array: [{ "day": 1, "originalActivity": "...", "newActivity": "...", "reason": "...", "time": "...", "duration": "...", "estimatedCost": 0 }]`;
        break;

      case 'user_flag':
        prompt += `
User-reported issue during the trip. Adjust only the next 1-2 activities.

Message: "${context.userMessage || 'Issue reported'}"
Issue analysis: ${JSON.stringify(context.parsedIssue || {}, null, 2)}
Affected activity: ${context.affectedActivity || 'next activity'}
Shift by: ${context.shiftHours || 0} hours

Do NOT change hotel or multi-day schedule. Stay within budget.

Respond with JSON array: [{ "day": 1, "originalActivity": "...", "newActivity": "...", "reason": "...", "time": "...", "duration": "...", "estimatedCost": 0 }]`;
        break;

      case 'flight_delay':
        prompt += `
A flight delay or cancellation has been detected. Replan the affected day(s) to accommodate the new arrival time.

Flight delay details:
${JSON.stringify(context.delayInfo || context, null, 2)}

Affected days: ${affectedDays.join(', ')}

Please reschedule Day 1 activities to start at least 1.5 hours after the new estimated arrival time.
If the flight is cancelled or diverted, suggest alternative full-day activities at the origin or destination.
Maintain the same budget level and travel style.

Respond with a JSON array of updated activities:
[
  {
    "day": 1,
    "originalActivity": "Check-in at hotel",
    "newActivity": "Late arrival check-in and evening stroll",
    "reason": "Flight delayed — arrival pushed back",
    "time": "7:00 PM",
    "duration": "1 hour",
    "estimatedCost": 0
  }
]`;
        break;

      case 'poi_closed':
        prompt += `
One or more planned attractions may be permanently closed, under renovation, or temporarily unavailable.

Closed/unavailable POIs:
${JSON.stringify(context.closedPois || context.affectedActivities || [], null, 2)}

Affected days: ${affectedDays.join(', ')}
Destination: ${context.destination || 'the destination'}

For each closed POI, find a similar alternative attraction of the same category (museum → museum, park → park, etc.) that:
- Is currently open and operational
- Has similar visitor experience and rating
- Is within 15 km of the original
- Fits the same time slot and budget

Do NOT change hotels, meals, or transport. Keep the same day structure.

Respond with a JSON array:
[
  {
    "day": 1,
    "originalActivity": "Closed Museum Name",
    "newActivity": "Alternative Museum Name",
    "reason": "Original venue is closed for renovation",
    "time": "10:00 AM",
    "duration": "2 hours",
    "estimatedCost": 400
  }
]`;
        break;

      default:
        prompt += `
Please optimize the itinerary for days: ${affectedDays.join(', ')}.

Context: ${JSON.stringify(context, null, 2)}

Respond with a JSON array of suggested changes.`;
    }

    return prompt;
  }

  private parseReplanResponse(text: string): any[] {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (error) {
      this.logger.warn(`Could not parse replan response: ${error.message}`);
      return [];
    }
  }

  private getUpdateMessage(reason: string, daysAffected: number): string {
    switch (reason) {
      case 'weather':
        return `Your itinerary has been updated for ${daysAffected} day(s) due to weather changes. Indoor activities have been suggested where needed.`;
      case 'crowd':
        return `We've adjusted ${daysAffected} activity time(s) to avoid crowds. Check the updated schedule.`;
      case 'availability':
        return `Some items in your itinerary were unavailable. We've found suitable alternatives.`;
      case 'flight_delay':
        return `Your flight has been delayed or cancelled. We've rescheduled your Day 1 activities to match your new arrival time. ${daysAffected} day(s) updated.`;
      case 'transport_delay':
        return `Heavy traffic detected on today's routes. We've adjusted activity start times to compensate. ${daysAffected} day(s) updated.`;
      case 'user_flag':
        return `Your reported issue has been analysed. We've adjusted the next activity to keep your trip on track.`;      case 'poi_closed':
        return `One or more planned attractions appear to be closed or unavailable. We\'ve found similar alternatives nearby. ${daysAffected} activity change(s) ready for review.`;      default:
        return `Your itinerary has been optimized. ${daysAffected} day(s) updated.`;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`✅ Replan job ${job.id} completed successfully`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Replan job ${job.id} failed: ${error.message}`);
  }
}
