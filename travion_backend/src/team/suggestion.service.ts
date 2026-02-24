import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../supabase/client';
import { OpenRouterService } from '../itinerary/openrouter.service';

export interface ParsedSuggestion {
  activity: string;
  issue: string;
  suggestion: string;
}

export interface TripSuggestion {
  id: string;
  tripJobId: string;
  userId: string;
  originalText: string;
  parsedActivity?: string;
  parsedIssue?: string;
  parsedSuggestion?: string;
  status: 'pending' | 'applied' | 'ignored';
  createdAt: string;
}

@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(private readonly openRouter: OpenRouterService) {
    const key =
      process.env.GEMINI_API_KEY_1 ||
      process.env.GEMINI_API_KEY ||
      '';
    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  // ─────────────────────────────────────────────────────────────
  // Submit a free-text suggestion → Gemini NLP → store
  // ─────────────────────────────────────────────────────────────
  async submitSuggestion(
    tripJobId: string,
    userId: string,
    text: string,
  ): Promise<TripSuggestion> {
    // Parse with Gemini
    const parsed = await this.parseSuggestionNLP(text);

    const row: any = {
      trip_job_id: tripJobId,
      user_id: userId,
      original_text: text,
      parsed_activity: parsed.activity || null,
      parsed_issue: parsed.issue || null,
      parsed_suggestion: parsed.suggestion || null,
      status: 'pending',
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('trip_suggestions')
        .insert(row)
        .select()
        .single();

      if (!error && data) {
        return this.mapRow(data);
      }
    }

    // Fallback (no DB): return synthetic record
    return {
      id: `local-${Date.now()}`,
      tripJobId,
      userId,
      originalText: text,
      parsedActivity: parsed.activity,
      parsedIssue: parsed.issue,
      parsedSuggestion: parsed.suggestion,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // List pending suggestions for a trip (owner dashboard)
  // ─────────────────────────────────────────────────────────────
  async getSuggestions(tripJobId: string, statusFilter?: string): Promise<TripSuggestion[]> {
    if (!supabase) return [];

    let q = supabase
      .from('trip_suggestions')
      .select('*')
      .eq('trip_job_id', tripJobId)
      .order('created_at', { ascending: false });

    if (statusFilter) q = q.eq('status', statusFilter);

    const { data } = await q;
    return (data || []).map((r: any) => this.mapRow(r));
  }

  // ─────────────────────────────────────────────────────────────
  // Update suggestion status (apply / ignore)
  // ─────────────────────────────────────────────────────────────
  async updateStatus(id: string, status: 'applied' | 'ignored'): Promise<void> {
    if (!supabase) return;
    await supabase.from('trip_suggestions').update({ status }).eq('id', id);
  }

  // ─────────────────────────────────────────────────────────────
  // Gemini NLP parser
  // ─────────────────────────────────────────────────────────────
  private async parseSuggestionNLP(text: string): Promise<ParsedSuggestion> {
    const prompt = `You are a travel itinerary assistant for Travion.
A trip member has sent this message:
"${text}"

Extract the intent as a JSON object with EXACTLY these three fields:
- activity: the itinerary activity being referred to (short name, e.g. "Beach Visit", or "Unknown" if unclear)
- issue: one short phrase describing the problem (e.g. "crowd risk", "timing conflict", "cost concern")
- suggestion: one short actionable fix (e.g. "move to morning", "replace with indoor activity", "reduce duration")

Respond with ONLY valid JSON — no markdown, no explanation.
Example: {"activity":"Echo Point Visit","issue":"crowd risk","suggestion":"move to 9 AM"}`;

    try {
      const result = await this.model.generateContent(prompt);
      const raw = result.response.text().trim();
      // Strip any markdown fences
      const clean = raw.replace(/^```json?\n?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(clean);
      return {
        activity: String(parsed.activity || 'Unknown'),
        issue: String(parsed.issue || 'Unspecified'),
        suggestion: String(parsed.suggestion || 'Review manually'),
      };
    } catch {
      // Try OpenRouter as secondary
      if (this.openRouter.isAvailable) {
        try {
          const sys = `Extract trip suggestion info as JSON with exactly: {"activity":"...","issue":"...","suggestion":"..."}. Respond ONLY with JSON.`;
          const parsed = await this.openRouter.callJSON<ParsedSuggestion>(sys, `Suggestion: "${text}"`);
          if (parsed) {
            this.logger.log(`✅ OpenRouter suggestion NLP for: "${text}"`);
            return {
              activity: String(parsed.activity || 'Unknown'),
              issue: String(parsed.issue || 'Unspecified'),
              suggestion: String(parsed.suggestion || 'Review manually'),
            };
          }
        } catch (orErr: any) {
          this.logger.warn(`OpenRouter suggestion NLP failed: ${orErr.message}`);
        }
      }
      return { activity: 'Unknown', issue: text.slice(0, 80), suggestion: 'Review manually' };
    }
  }

  private mapRow(r: any): TripSuggestion {
    return {
      id: r.id,
      tripJobId: r.trip_job_id,
      userId: r.user_id,
      originalText: r.original_text,
      parsedActivity: r.parsed_activity,
      parsedIssue: r.parsed_issue,
      parsedSuggestion: r.parsed_suggestion,
      status: r.status,
      createdAt: r.created_at,
    };
  }
}
