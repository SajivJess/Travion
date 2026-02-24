import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { OpenRouterService } from './openrouter.service';
import { TourismAdvisoryService } from './tourism-advisory.service';
import { STATE_TOURISM_MAP } from './tourism-data';
import { supabase } from '../supabase/client';

// Jina Reader AI — turns any URL into clean markdown/text for LLM ingestion
const JINA_BASE = 'https://r.jina.ai/';

// Max chars of scraped text we send to the model (to stay within context budget)
const MAX_CONTEXT_CHARS = 3500;

// How long to keep scraped tourism page content in memory (gov sites rarely change)
const JINA_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ChatbotResponse {
  answer: string;
  source?: string;
  sourceUrl?: string;
}

/**
 * ChatbotService — "Ask about this place" feature for Travion.
 *
 * Flow:
 *   1. Resolve destination → Indian state
 *   2. Look up official state tourism website
 *   3. Scrape it via Jina Reader (r.jina.ai) for authoritative content
 *   4. Send to OpenRouter → Mistral-7B-Instruct for precise Q-A
 *
 * The model is instructed to answer ONLY from official data — no hallucinations.
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  /** In-memory cache: stateKey → { text, expiresAt } */
  private readonly jinaCache = new Map<string, { text: string; expiresAt: number }>();

  constructor(
    private readonly openRouter: OpenRouterService,
    private readonly advisoryService: TourismAdvisoryService,
  ) {}

  async askAboutPlace(
    place: string,
    destination: string,
    question: string,
  ): Promise<ChatbotResponse> {
    if (!this.openRouter.isAvailable) {
      return {
        answer:
          'The AI chatbot is not available. Please add OPENROUTER_API_KEY to your backend .env file.',
      };
    }

    // ── Step 1: Resolve state ────────────────────────────────────────────────
    const state = await this.advisoryService.resolveState(destination);
    let tourismEntry = state ? STATE_TOURISM_MAP[state.toLowerCase()] : null;

    // Try destination itself as a state key too (e.g. user typed "Goa" as destination)
    if (!tourismEntry) {
      tourismEntry = STATE_TOURISM_MAP[destination.toLowerCase()] ?? null;
    }

    // ── Step 2: Scrape via Jina Reader (with in-memory cache) ───────────────
    let tourismContext = '';
    let sourceName = tourismEntry?.name ? `${tourismEntry.name} Tourism` : undefined;
    let sourceUrl = tourismEntry?.url;

    if (tourismEntry?.url) {
      const cacheKey = tourismEntry.url;

      // 1. Memory cache (fastest)
      const cached = this.jinaCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.logger.log(`🗂️  Jina memory cache HIT for "${sourceName}"`);
        tourismContext = cached.text;
      } else {
        // 2. Supabase cache (survives restarts)
        let foundInDb = false;
        if (supabase) {
          try {
            const { data: dbRow } = await supabase
              .from('jina_cache')
              .select('content')
              .eq('url', cacheKey)
              .gt('expires_at', new Date().toISOString())
              .single();
            if (dbRow?.content) {
              this.logger.log(`🗂️  Jina Supabase cache HIT for "${sourceName}"`);
              tourismContext = dbRow.content;
              this.jinaCache.set(cacheKey, { text: tourismContext, expiresAt: Date.now() + JINA_CACHE_TTL_MS });
              foundInDb = true;
            }
          } catch { /* miss — proceed to scrape */ }
        }

        // 3. Fresh Jina scrape
        if (!foundInDb) {
          try {
            const jinaUrl = `${JINA_BASE}${tourismEntry.url}`;
            this.logger.log(`🔍 Jina scrape → ${jinaUrl}`);
            const res = await axios.get(jinaUrl, {
              headers: { Accept: 'text/plain', 'User-Agent': 'Travion/1.0 Travel Planner' },
              timeout: 22_000,
            });
            const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            tourismContext = raw.replace(/\[.*?\]\(.*?\)/g, '').slice(0, MAX_CONTEXT_CHARS);
            this.logger.log(`✅ Jina scraped ${tourismContext.length} chars from ${sourceName} — caching 24h`);

            // Populate memory cache
            this.jinaCache.set(cacheKey, { text: tourismContext, expiresAt: Date.now() + JINA_CACHE_TTL_MS });

            // Persist to Supabase
            if (supabase && tourismContext.length > 100) {
              const expiresAt = new Date(Date.now() + JINA_CACHE_TTL_MS).toISOString();
              supabase.from('jina_cache').upsert(
                { url: cacheKey, content: tourismContext, source_name: sourceName || '', expires_at: expiresAt, created_at: new Date().toISOString() },
                { onConflict: 'url' },
              ).then(({ error }) => { if (error) this.logger.warn(`Jina DB cache write failed: ${error.message}`); });
            }
          } catch (err: any) {
            this.logger.warn(`⚠️  Jina scrape failed for ${tourismEntry.url}: ${err.message} — proceeding without context`);
          }
        }
      }
    }

    // ── Step 3: Compose prompt & call OpenRouter/Mistral ────────────────────
    const systemPrompt = tourismContext
      ? `You are a knowledgeable Indian tourism guide for the Travion travel app.
Use ONLY the official tourism information provided below to answer the user's question.
Be factual, concise, and helpful (3–6 sentences). If the provided data does not contain enough detail to answer the question, say so clearly and suggest where the user can find more info — do NOT make up facts.

Official tourism data from ${sourceName ?? 'Government of India tourism site'}:
---
${tourismContext}
---`
      : `You are a knowledgeable Indian tourism guide for the Travion travel app.
Answer the user's question about ${place} at ${destination} as accurately as possible.
Be concise (3–6 sentences). Mention timings, fees, and dress codes where relevant.`;

    const userMessage = `Place: ${place}
Destination: ${destination}
Question: ${question}`;

    try {
      const answer = await this.openRouter.call(systemPrompt, userMessage, {
        maxTokens: 450,
        temperature: 0.2,
      });

      return { answer, source: sourceName, sourceUrl };
    } catch (err: any) {
      this.logger.error(`OpenRouter chatbot error: ${err.message}`);
      return {
        answer:
          'Sorry, I could not fetch an answer right now. Please try again in a moment.',
      };
    }
  }
}
