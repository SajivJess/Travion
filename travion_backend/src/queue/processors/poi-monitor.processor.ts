import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { QueueService, TripMonitoringJob } from '../queue.service';

export interface PoiMonitoringJob extends TripMonitoringJob {
  /** Day-keyed activity list: { "1": ["Echo Point", "Tea Museum"], "2": ["Mattupetty Dam"] } */
  dayActivities: Record<string, string[]>;
}

interface PoiStatusResult {
  activity: string;
  day: number;
  status: 'open' | 'closed' | 'partial' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  source: string;
}

// ─── PROCESSOR ───────────────────────────────────────────────────────────────

@Processor('poi-monitor')
export class PoiMonitorProcessor {
  private readonly logger = new Logger(PoiMonitorProcessor.name);

  private readonly serpApiKeys: string[];
  private serpKeyIndex = 0;
  private geminiKeys: string[];
  private geminiKeyIndex = 0;

  constructor(private readonly queueService: QueueService) {
    this.serpApiKeys = [
      process.env.SERP_API_KEY,
      process.env.SERP_API_KEY_2,
      process.env.SERP_API_KEY_3,
      process.env.SERP_API_KEY_4,
      process.env.SERP_API_KEY_5,
    ].filter(Boolean) as string[];

    this.geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean) as string[];
  }

  private nextSerpKey(): string | null {
    if (!this.serpApiKeys.length) return null;
    const k = this.serpApiKeys[this.serpKeyIndex % this.serpApiKeys.length];
    this.serpKeyIndex++;
    return k;
  }

  private nextGeminiKey(): string | null {
    if (!this.geminiKeys.length) return null;
    const k = this.geminiKeys[this.geminiKeyIndex % this.geminiKeys.length];
    this.geminiKeyIndex++;
    return k;
  }

  // ─── MAIN JOB ─────────────────────────────────────────────────────────────

  @Process('check-poi')
  async handlePoiCheck(job: Job<PoiMonitoringJob>): Promise<any> {
    const { tripId, userId, destination, dayActivities, startDate } = job.data;

    this.logger.log(`🏛️ POI check for trip ${tripId} — ${destination}`);

    if (!this.serpApiKeys.length) {
      this.logger.debug('No SerpAPI keys — POI monitor skipped');
      return { action: 'skipped', reason: 'no_api_key' };
    }

    const closedPois: PoiStatusResult[] = [];

    for (const [dayStr, activityNames] of Object.entries(dayActivities)) {
      const dayNum = parseInt(dayStr, 10);
      // Check only the first 3 activities per day to stay within API quota
      for (const activity of activityNames.slice(0, 3)) {
        try {
          const result = await this.checkPoiStatus(activity, destination);
          if (result.status === 'closed' || result.status === 'partial') {
            closedPois.push({ ...result, day: dayNum });
            this.logger.warn(
              `🚫 POI "${activity}" on Day ${dayNum}: ${result.status} — ${result.reason}`,
            );
          } else {
            this.logger.debug(`✅ POI "${activity}": ${result.status} (${result.confidence})`);
          }
        } catch (err: any) {
          this.logger.debug(`POI check failed for "${activity}": ${err.message}`);
        }
      }
    }

    if (closedPois.length === 0) {
      return { action: 'all_open', destination };
    }

    // ── Group by day and create an update suggestion per day ──────────────
    const byDay = new Map<number, PoiStatusResult[]>();
    for (const poi of closedPois) {
      if (!byDay.has(poi.day)) byDay.set(poi.day, []);
      byDay.get(poi.day)!.push(poi);
    }

    for (const [dayNum, poiList] of byDay.entries()) {
      const affectedActivities = poiList.map(p => p.activity);
      const summary =
        `${poiList.length} attraction(s) on Day ${dayNum} may be closed: ` +
        affectedActivities.join(', ') + '. Alternatives suggested.';

      // Persist to trip_updates + notify user
      await this.queueService.createTripUpdate({
        tripId,
        userId,
        day: dayNum,
        reason: 'poi_closed',
        riskLevel: poiList.some(p => p.confidence === 'high') ? 'HIGH' : 'MEDIUM',
        affectedActivities,
        suggestedChanges: poiList.map(p => ({
          originalActivity: p.activity,
          issue: p.reason,
          source: p.source,
        })),
        summary,
        context: { destination, closedPois: poiList },
      });
    }

    return {
      action: 'updates_created',
      closedCount: closedPois.length,
      days: Array.from(byDay.keys()),
    };
  }

  // ─── POI STATUS CHECK: YouTube → Gemini + Google Reviews signal ──────────

  private async checkPoiStatus(
    activity: string,
    destination: string,
  ): Promise<Omit<PoiStatusResult, 'day'>> {
    const serpKey = this.nextSerpKey()!;

    // ── Signal 1: Google Reviews / Knowledge Graph (fast, primary) ─────────
    const kgRes = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: `${activity} ${destination} open closed hours 2025 2026`,
        api_key: serpKey,
        num: 5,
      },
      timeout: 7000,
    }).catch(() => null);

    if (kgRes?.data) {
      const kg = kgRes.data.knowledge_graph as any;
      const hours = kg?.hours?.toLowerCase() ?? '';
      const locStatus = (kg?.place_type ?? '') + ' ' + (kg?.description ?? '');

      if (hours.includes('permanently closed') || locStatus.toLowerCase().includes('permanently closed')) {
        return {
          activity, status: 'closed', confidence: 'high',
          reason: 'Google Knowledge Graph reports permanently closed',
          source: 'google_kg',
        };
      }

      const organicText = (kgRes.data.organic_results as any[] || [])
        .slice(0, 5)
        .map((r: any) => `${r.title ?? ''} ${r.snippet ?? ''}`.toLowerCase())
        .join(' ');

      const closedKeywords = /\b(closed|renovation|under maintenance|shut down|not open|temporarily closed)\b/;
      const openKeywords = /\b(open|visiting|must visit|open daily|open hours)\b/;

      if (closedKeywords.test(organicText) && !openKeywords.test(organicText)) {
        return {
          activity, status: 'closed', confidence: 'medium',
          reason: 'Recent web results mention closure/renovation',
          source: 'google_organic',
        };
      }
    }

    // ── Signal 2: YouTube video search → Gemini transcript analysis ────────
    const ytKey = this.nextSerpKey();
    if (!ytKey || !this.geminiKeys.length) {
      return { activity, status: 'unknown', confidence: 'low', reason: 'Insufficient API keys', source: 'none' };
    }

    const ytRes = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'youtube',
        search_query: `${activity} ${destination} visit 2025 2026`,
        api_key: ytKey,
        max_results: 5,
      },
      timeout: 6000,
    }).catch(() => null);

    if (!ytRes?.data?.video_results?.length) {
      return { activity, status: 'unknown', confidence: 'low', reason: 'No YouTube data', source: 'none' };
    }

    // Compile video titles + descriptions as a proxy for transcript content
    const videoContext = (ytRes.data.video_results as any[])
      .slice(0, 5)
      .map((v: any) => `Title: ${v.title ?? ''}\nDesc: ${v.description ?? ''}`)
      .join('\n---\n');

    // ── Gemini: classify POI status from the video context ─────────────────
    const geminiKey = this.nextGeminiKey()!;
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are analyzing recent YouTube video metadata to determine the current status of a tourist attraction.

Attraction: "${activity}" in ${destination}

Video metadata from recent searches:
${videoContext}

Respond with ONLY valid JSON (no markdown):
{
  "status": "open" | "closed" | "partial" | "unknown",
  "confidence": "high" | "medium" | "low",
  "reason": "one sentence explaining your determination"
}

Rules:
- "closed": videos/descriptions mention closure, renovation, maintenance, shut, not accessible
- "partial": mention of limited access, some sections closed, reduced hours
- "open": visitors shown actively visiting, recent positive visit experience reported
- "unknown": inconclusive or no relevant information
- confidence "high": explicit clear statement; "medium": implied; "low": guessing from context`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        return {
          activity,
          status: parsed.status ?? 'unknown',
          confidence: parsed.confidence ?? 'low',
          reason: parsed.reason ?? 'Gemini analysis',
          source: 'youtube_gemini',
        };
      }
    } catch {
      // Gemini failed — fall through to unknown
    }

    return { activity, status: 'unknown', confidence: 'low', reason: 'Analysis inconclusive', source: 'youtube_gemini' };
  }

  @OnQueueFailed()
  onFailed(job: Job<PoiMonitoringJob>, err: Error): void {
    this.logger.error(`POI monitor job failed for trip ${job.data.tripId}: ${err.message}`);
  }
}
