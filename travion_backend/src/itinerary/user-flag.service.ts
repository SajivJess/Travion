import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OpenRouterService } from './openrouter.service';

export interface ParsedIssue {
  issueType: 'delay' | 'cancellation' | 'closure' | 'fatigue' | 'traffic' | 'weather' | 'budget' | 'other';
  affectedActivity: string;
  impact: string;
  suggestion: string;
  urgency: 'low' | 'medium' | 'high';
  shouldReplan: boolean;
  /** 0–2 days to shift the affected activity */
  shiftHours?: number;
}

export interface ReportIssueRequest {
  tripId: string;
  userId: string;
  message: string;
  dayIndex?: number;
  activityName?: string;
  destination?: string;
  activities?: string[];
}

/**
 * UserFlagService — Parses free-text user issue reports via Gemini NLP.
 *
 * Input:  "Bus got cancelled" / "Reached late" / "Museum closed" / "Feeling tired"
 * Output: { issueType, affectedActivity, impact, suggestion, urgency, shouldReplan }
 */
@Injectable()
export class UserFlagService {
  private readonly logger = new Logger(UserFlagService.name);

  constructor(private readonly openRouter: OpenRouterService) {}

  async parseIssue(request: ReportIssueRequest): Promise<ParsedIssue> {
    const { message, destination, activities, activityName } = request;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('No GEMINI_API_KEY — trying OpenRouter NLP');
      return (await this.parseWithOpenRouter(message)) ?? this.fallbackParse(message);
    }

    const activitiesCtx = activities?.length
      ? `Planned activities: ${activities.join(', ')}.`
      : '';
    const activityCtx = activityName ? `Current activity: "${activityName}".` : '';

    const prompt = `You are a travel assistant. A user reported an issue during their trip. Parse it and respond ONLY with valid JSON (no markdown).

User message: "${message}"
Destination: ${destination || 'Unknown'}
${activityCtx}
${activitiesCtx}

Respond with this exact JSON structure:
{
  "issueType": "delay|cancellation|closure|fatigue|traffic|weather|budget|other",
  "affectedActivity": "name of the impacted activity, or 'next activity' if unclear",
  "impact": "one sentence describing the impact on the trip",
  "suggestion": "one specific actionable fix (e.g. 'Shift check-in to 4PM', 'Replace with indoor museum')",
  "urgency": "low|medium|high",
  "shouldReplan": true or false,
  "shiftHours": 0
}

Rules:
- shiftHours: number of hours to shift affected activity (0 if no time shift needed)
- shouldReplan: true if the next 1–2 activities need adjustment
- urgency high = affects hotel/transport/multi-day; medium = affects next activity; low = advisory only`;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) {
        this.logger.warn('Gemini NLP returned no JSON, trying OpenRouter');
        return await this.parseWithOpenRouter(message) ?? this.fallbackParse(message);
        return this.fallbackParse(message);
      }

      const parsed = JSON.parse(jsonStr) as ParsedIssue;
      this.logger.log(
        `✅ NLP parsed: "${message}" → ${parsed.issueType} (${parsed.urgency}, replan=${parsed.shouldReplan})`,
      );
      return parsed;
    } catch (err: any) {
      this.logger.warn(`Gemini NLP parse failed: ${err.message} — trying OpenRouter`);
      return (await this.parseWithOpenRouter(message)) ?? this.fallbackParse(message);
    }
  }

  // ─── OPENROUTER NLP (Mistral-7B) ──────────────────────────────────────────

  private async parseWithOpenRouter(message: string): Promise<ParsedIssue | null> {
    if (!this.openRouter.isAvailable) return null;
    const system = `You are a travel assistant. Extract structured info from a user's trip issue.
Respond ONLY with valid JSON using exactly these fields:
{
  "issueType": "delay|cancellation|closure|fatigue|traffic|weather|budget|other",
  "affectedActivity": "short name or 'next activity'",
  "impact": "one sentence",
  "suggestion": "one specific fix",
  "urgency": "low|medium|high",
  "shouldReplan": true,
  "shiftHours": 0
}`;
    try {
      const parsed = await this.openRouter.callJSON<ParsedIssue>(system, `User issue: "${message}"`);
      if (parsed) {
        this.logger.log(`✅ OpenRouter NLP: "${message}" → ${parsed.issueType}`);
        return parsed;
      }
    } catch (err: any) {
      this.logger.warn(`OpenRouter NLP failed: ${err.message}`);
    }
    return null;
  }

  // ─── KEYWORD FALLBACK ──────────────────────────────────────────────────

  private fallbackParse(message: string): ParsedIssue {
    const lower = message.toLowerCase();

    const isCancelled = /cancel|closed|shut|unavailable|not open/.test(lower);
    const isDelay    = /late|delay|stuck|traffic|held up|missed/.test(lower);
    const isTired    = /tired|fatigue|exhausted|rest|break|unwell|sick/.test(lower);
    const isWeather  = /rain|storm|flood|wind|snow/.test(lower);
    const isBudget   = /expensive|costly|over budget|money|afford/.test(lower);

    let issueType: ParsedIssue['issueType'] = 'other';
    let suggestion = 'Review upcoming activities';
    let shiftHours = 0;
    let shouldReplan = false;

    if (isCancelled) {
      issueType = 'cancellation';
      suggestion = 'Find a nearby alternative attraction';
      shouldReplan = true;
    } else if (isDelay) {
      issueType = 'delay';
      suggestion = 'Shift next activity by 1–2 hours';
      shiftHours = 2;
      shouldReplan = true;
    } else if (isTired) {
      issueType = 'fatigue';
      suggestion = 'Add a 45-min rest break before next activity';
      shiftHours = 1;
      shouldReplan = false;
    } else if (isWeather) {
      issueType = 'weather';
      suggestion = 'Switch to indoor alternatives for remaining activities';
      shouldReplan = true;
    } else if (isBudget) {
      issueType = 'budget';
      suggestion = 'Replace remaining paid activities with free alternatives';
      shouldReplan = true;
    }

    return {
      issueType,
      affectedActivity: 'next activity',
      impact: 'Current schedule may be disrupted',
      suggestion,
      urgency: shouldReplan ? 'medium' : 'low',
      shouldReplan,
      shiftHours,
    };
  }
}
