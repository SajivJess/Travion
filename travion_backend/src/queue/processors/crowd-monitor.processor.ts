import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { Job } from 'bull';
import axios from 'axios';
import { TripMonitoringJob, QueueService } from '../queue.service';
import { TourismAdvisoryService } from '../../itinerary/tourism-advisory.service';

/** Three-signal crowd score: 0–100 */
interface CrowdScoreSignals {
  popularityScore: number;   // 0-40: SerpAPI popular times / busyness data
  eventScore: number;        // 0-30: nearby events/festivals detected today
  reviewVelocityScore: number; // 0-30: surge in recent reviews (crowd proxy)
  total: number;             // 0-100
  signals: string[];         // Human-readable signal summaries
}

interface CrowdData {
  location: string;
  crowdLevel: 'low' | 'moderate' | 'high' | 'very_high';
  waitTime: number; // minutes
  bestTimeToVisit: string;
  isHoliday: boolean;
  localEvents: string[];
}

@Processor('crowd-monitor')
export class CrowdMonitorProcessor {
  private readonly logger = new Logger(CrowdMonitorProcessor.name);
  private readonly serpApiKeys: string[];
  private serpKeyIndex = 0;

  constructor(
    private readonly queueService: QueueService,
    @Inject(forwardRef(() => TourismAdvisoryService))
    private readonly tourismAdvisoryService: TourismAdvisoryService,
  ) {
    this.serpApiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];
  }

  private getNextSerpKey(): string | null {
    if (this.serpApiKeys.length === 0) return null;
    const key = this.serpApiKeys[this.serpKeyIndex];
    this.serpKeyIndex = (this.serpKeyIndex + 1) % this.serpApiKeys.length;
    return key;
  }

  @Process('check-crowds')
  async handleCrowdCheck(job: Job<TripMonitoringJob>): Promise<any> {
    const { tripId, userId, destination, activities, startDate } = job.data;
    
    this.logger.log(`👥 Checking crowd levels for trip ${tripId} - ${destination}`);

    try {
      // Check crowd levels for key activities
      const crowdData = await this.getCrowdData(destination, activities, startDate);
      
      // Identify high-crowd days/activities
      const problematicActivities = crowdData.filter(
        c => c.crowdLevel === 'very_high' || (c.crowdLevel === 'high' && c.waitTime > 60)
      );

      if (problematicActivities.length > 0) {
        this.logger.warn(`⚠️ High crowd levels detected at: ${problematicActivities.map(a => a.location).join(', ')}`);
        
        // Store update and send PLAN_UPDATE_AVAILABLE
        await this.queueService.createTripUpdate({
          tripId,
          userId,
          day: 1, // Crowd monitoring is pre-trip, affecting day 1 onwards
          reason: 'crowd',
          riskLevel: problematicActivities.some(a => a.crowdLevel === 'very_high') ? 'HIGH' : 'MEDIUM',
          affectedActivities: problematicActivities.map(a => a.location),
          suggestedChanges: problematicActivities.map(a => ({
            location: a.location,
            crowdLevel: a.crowdLevel,
            waitTime: a.waitTime,
            bestTimeToVisit: a.bestTimeToVisit,
            suggestion: `Visit at ${a.bestTimeToVisit} to avoid crowds`,
            localEvents: a.localEvents,
          })),
          summary: `High crowds expected at ${problematicActivities.length} location(s) in ${destination}. ${problematicActivities.map(a => a.location).join(', ')}.`,
          context: {
            destination,
            startDate,
            problematicActivities,
            allCrowdData: crowdData,
          },
        });

        return { action: 'update_created', problematicActivities };
      }

      return { action: 'no_issues', crowdData };
    } catch (error) {
      this.logger.error(`Crowd check failed: ${error.message}`);
      throw error;
    }
  }

  private async getCrowdData(
    destination: string,
    activities: string[],
    date: string,
  ): Promise<CrowdData[]> {
    const crowdData: CrowdData[] = [];
    const tripDate = new Date(date);

    // Check for holidays/events
    const holidays = this.checkHolidays(tripDate);
    const isWeekend = tripDate.getDay() === 0 || tripDate.getDay() === 6;

    // Get tourism advisories for festival/event detection
    let tourismCrowdBoost = 0;
    let tourismEvents: string[] = [];
    try {
      const intel = await this.tourismAdvisoryService.getAdvisories(destination);
      if (intel) {
        tourismCrowdBoost = intel.totalCrowdBoost || 0;
        tourismEvents = intel.advisories
          ?.filter(a => a.type === 'festival')
          ?.map(a => a.alert) || [];
        if (tourismCrowdBoost > 0) {
          this.logger.log(`📈 Tourism advisory crowd boost: +${tourismCrowdBoost} (${tourismEvents.length} events)`);
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ Could not fetch tourism advisories: ${err.message}`);
    }

    for (const activity of activities) {
      try {
        // Get three-signal CrowdScore from SerpAPI
        const serpScore = await this.getSerpapiCrowdScore(activity, destination, tripDate);

        // Combine SerpAPI score with holiday/event boost
        const combinedBoost = tourismCrowdBoost + (serpScore.total * 0.5);

        const estimated = this.estimateCrowdLevel(
          activity, destination, isWeekend,
          [...holidays, ...tourismEvents], combinedBoost,
        );

        // If SerpAPI detected signals, log them
        if (serpScore.total > 0) {
          this.logger.log(
            `📊 CrowdScore for "${activity}": ${serpScore.total}/100 ` +
            `[P:${serpScore.popularityScore} E:${serpScore.eventScore} R:${serpScore.reviewVelocityScore}] ` +
            `→ ${estimated.crowdLevel}`,
          );
        }

        crowdData.push({
          ...estimated,
          isHoliday: holidays.length > 0 || tourismEvents.length > 0,
          localEvents: [...holidays, ...tourismEvents, ...serpScore.signals],
        });
      } catch (error: any) {
        this.logger.warn(`Could not get crowd data for ${activity}: ${error.message}`);
        crowdData.push(this.estimateCrowdLevel(activity, destination, isWeekend, [...holidays, ...tourismEvents], tourismCrowdBoost));
      }
    }

    return crowdData;
  }

  /**
   * THREE-SIGNAL CROWD SCORE via SerpAPI
   *
   * A. Popular Times / "busy now" signal  → 0–40 pts
   * B. Event / festival detection today    → 0–30 pts
   * C. Review velocity (surge proxy)       → 0–30 pts
   * ─────────────────────────────────────────────────
   * Total CrowdScore 0–100
   */
  private async getSerpapiCrowdScore(
    place: string,
    destination: string,
    date: Date,
  ): Promise<CrowdScoreSignals> {
    const apiKey = this.getNextSerpKey();
    const result: CrowdScoreSignals = {
      popularityScore: 0,
      eventScore: 0,
      reviewVelocityScore: 0,
      total: 0,
      signals: [],
    };

    if (!apiKey) return result;

    const todayStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    try {
      // ── Signal A: Popular times / live busyness ──────────────────────
      const busyRes = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: `${place} ${destination} popular times busy hours`,
          api_key: apiKey,
          num: 3,
        },
        timeout: 6000,
      }).catch(() => null);

      if (busyRes?.data) {
        const kg = busyRes.data.knowledge_graph as any;
        const answerBox = busyRes.data.answer_box as any;

        // Knowledge graph may have "Popular times" or "Currently" data
        if (kg?.popular_times || kg?.live_busyness) {
          const busyness = kg.live_busyness ?? 70;
          result.popularityScore = Math.min(40, Math.round((busyness / 100) * 40));
          result.signals.push(`Popular times: ${busyness}% busy`);
        } else if (answerBox?.answer?.toLowerCase().includes('busy')) {
          result.popularityScore = 25;
          result.signals.push('Google reports busy conditions');
        } else {
          // Check organic snippets for busyness keywords
          const organicText = (busyRes.data.organic_results as any[] || [])
            .slice(0, 3)
            .map((r: any) => r.snippet?.toLowerCase() ?? '').join(' ');

          if (organicText.includes('very busy') || organicText.includes('extremely crowded')) {
            result.popularityScore = 35;
            result.signals.push('Very busy per search results');
          } else if (organicText.includes('busy') || organicText.includes('crowded')) {
            result.popularityScore = 20;
            result.signals.push('Busy per search results');
          } else if (organicText.includes('quiet') || organicText.includes('not crowded')) {
            result.popularityScore = 5;
            result.signals.push('Quiet per search results');
          }
        }
      }

      // ── Signal B: Event / festival detection ────────────────────────
      const eventRes = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: `festival event near ${destination} today ${todayStr}`,
          api_key: this.getNextSerpKey() ?? apiKey,
          num: 5,
        },
        timeout: 6000,
      }).catch(() => null);

      if (eventRes?.data) {
        const events = (eventRes.data.events_results as any[]) || [];
        const organic = (eventRes.data.organic_results as any[]) || [];

        if (events.length >= 3) {
          result.eventScore = 30;
          result.signals.push(`${events.length} events detected near ${destination} today`);
        } else if (events.length >= 1) {
          result.eventScore = 18;
          result.signals.push(`${events.length} event(s) near destination today`);
        } else {
          // Check organic for event keywords
          const eventText = organic.slice(0, 5)
            .map((r: any) => r.title?.toLowerCase() ?? '').join(' ');
          if (/festival|fair|carnival|parade|market|concert|mela/.test(eventText)) {
            result.eventScore = 20;
            result.signals.push('Festival/event keywords detected in search');
          }
        }
      }

      // ── Signal C: Review velocity (surge = more visitors) ───────────
      const reviewRes = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: `"${place}" ${destination} review 2025 2026`,
          api_key: this.getNextSerpKey() ?? apiKey,
          num: 10,
        },
        timeout: 6000,
      }).catch(() => null);

      if (reviewRes?.data) {
        const organic = (reviewRes.data.organic_results as any[]) || [];
        const recentCount = organic.filter((r: any) => {
          const date = r.date ?? r.snippet ?? '';
          return /2025|2026|days? ago|hours? ago|week ago/.test(String(date));
        }).length;

        if (recentCount >= 5) {
          result.reviewVelocityScore = 30;
          result.signals.push(`High review velocity: ${recentCount} recent mentions`);
        } else if (recentCount >= 2) {
          result.reviewVelocityScore = 15;
          result.signals.push(`Moderate review velocity: ${recentCount} recent mentions`);
        }
      }
    } catch (err: any) {
      this.logger.debug(`SerpAPI crowd signals failed for "${place}": ${err.message}`);
    }

    result.total = result.popularityScore + result.eventScore + result.reviewVelocityScore;
    return result;
  }

  private estimateCrowdLevel(
    activity: string,
    destination: string,
    isWeekend: boolean,
    holidays: string[],
    tourismCrowdBoost: number = 0,
  ): CrowdData {
    // Define tourist hotspots that are typically crowded
    const hotspots = ['taj mahal', 'red fort', 'gateway of india', 'victoria memorial', 
                      'qutub minar', 'india gate', 'hawa mahal', 'amber fort'];
    
    const isHotspot = hotspots.some(h => activity.toLowerCase().includes(h));
    const hasHoliday = holidays.length > 0;

    let crowdLevel: 'low' | 'moderate' | 'high' | 'very_high';
    let waitTime: number;

    // Base calculation
    if (isHotspot && hasHoliday) {
      crowdLevel = 'very_high';
      waitTime = 90 + Math.floor(Math.random() * 60);
    } else if (isHotspot && isWeekend) {
      crowdLevel = 'high';
      waitTime = 45 + Math.floor(Math.random() * 45);
    } else if (isHotspot || hasHoliday) {
      crowdLevel = 'moderate';
      waitTime = 15 + Math.floor(Math.random() * 30);
    } else {
      crowdLevel = 'low';
      waitTime = Math.floor(Math.random() * 15);
    }

    // Apply tourism advisory crowd boost (from festivals/major events)
    if (tourismCrowdBoost > 0) {
      waitTime += Math.floor(tourismCrowdBoost);
      
      // Escalate crowd level if boost is significant
      if (tourismCrowdBoost >= 30 && crowdLevel !== 'very_high') {
        crowdLevel = 'very_high';
      } else if (tourismCrowdBoost >= 20 && (crowdLevel === 'low' || crowdLevel === 'moderate')) {
        crowdLevel = 'high';
      } else if (tourismCrowdBoost >= 10 && crowdLevel === 'low') {
        crowdLevel = 'moderate';
      }
    }

    const bestTimeToVisit = isHotspot ? 'Early morning (7-9 AM) or late afternoon (4-6 PM)' : 'Anytime';

    return {
      location: activity,
      crowdLevel,
      waitTime,
      bestTimeToVisit,
      isHoliday: hasHoliday,
      localEvents: holidays,
    };
  }

  private checkHolidays(date: Date): string[] {
    const holidays: string[] = [];
    const month = date.getMonth() + 1;
    const day = date.getDate();

    // India public holidays (simplified)
    const indianHolidays: Record<string, string> = {
      '1-26': 'Republic Day',
      '8-15': 'Independence Day',
      '10-2': 'Gandhi Jayanti',
      '11-1': 'Diwali (approximate)',
      '3-25': 'Holi (approximate)',
      '12-25': 'Christmas',
    };

    const key = `${month}-${day}`;
    if (indianHolidays[key]) {
      holidays.push(indianHolidays[key]);
    }

    // Check nearby dates for multi-day festivals
    for (let i = -3; i <= 3; i++) {
      const nearbyDate = new Date(date);
      nearbyDate.setDate(nearbyDate.getDate() + i);
      const nearbyKey = `${nearbyDate.getMonth() + 1}-${nearbyDate.getDate()}`;
      if (indianHolidays[nearbyKey] && i !== 0) {
        holidays.push(`${indianHolidays[nearbyKey]} season`);
      }
    }

    return [...new Set(holidays)];
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`✅ Crowd check completed for job ${job.id}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`❌ Crowd check failed for job ${job.id}: ${error.message}`);
  }
}
