import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Small, fast, cheap — perfect for NLP parsing and Q-A
const DEFAULT_MODEL = 'mistralai/mistral-7b-instruct';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenRouterService — shared thin wrapper around the OpenRouter inference API.
 *
 * Used by:
 *   - UserFlagService   (flag NLP parsing)
 *   - SuggestionService (group suggestion analysis)
 *   - ChatbotService    (tourism Q-A)
 */
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!this.apiKey) {
      this.logger.warn('⚠️  OPENROUTER_API_KEY not set — OpenRouter features disabled');
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Call the model with a system + user message.
   * Returns the trimmed text response.
   */
  async call(
    systemPrompt: string,
    userMessage: string,
    options: { maxTokens?: number; temperature?: number; model?: string } = {},
  ): Promise<string> {
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

    const { maxTokens = 512, temperature = 0.3, model = DEFAULT_MODEL } = options;

    try {
      const res = await axios.post(
        OPENROUTER_URL,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: maxTokens,
          temperature,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://travion.app',
            'X-Title': 'Travion',
          },
          timeout: 25_000,
        },
      );

      const content = res.data?.choices?.[0]?.message?.content ?? '';
      return typeof content === 'string' ? content.trim() : '';
    } catch (err: any) {
      // Surface the OpenRouter error body for easy debugging
      if (err?.response?.data) {
        const apiErr = err.response.data?.error ?? err.response.data;
        const code = err.response.status;
        const msg = typeof apiErr === 'object' ? (apiErr.message ?? JSON.stringify(apiErr)) : String(apiErr);
        this.logger.error(`OpenRouter API ${code}: ${msg}`);
        throw new Error(`OpenRouter ${code}: ${msg}`);
      }
      throw err;
    }
  }

  /**
   * Lightweight connectivity check — sends a 1-token ping to the model.
   * Returns { ok, model, latencyMs } on success, { ok: false, error } on failure.
   */
  async ping(): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'OPENROUTER_API_KEY not configured' };
    const start = Date.now();
    try {
      await this.call('You are a ping test.', 'Reply with: pong', { maxTokens: 5, temperature: 0 });
      return { ok: true, model: DEFAULT_MODEL, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Like call() but extracts and parses the first JSON object from the response.
   * Returns null if no valid JSON found.
   */
  async callJSON<T = Record<string, unknown>>(
    systemPrompt: string,
    userMessage: string,
    options: Parameters<OpenRouterService['call']>[2] = {},
  ): Promise<T | null> {
    try {
      const raw = await this.call(systemPrompt, userMessage, options);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        this.logger.warn(`OpenRouter returned no JSON object. Raw: ${raw.slice(0, 200)}`);
        return null;
      }
      return JSON.parse(match[0]) as T;
    } catch (err: any) {
      this.logger.warn(`OpenRouter callJSON parse error: ${err.message}`);
      return null;
    }
  }
}
