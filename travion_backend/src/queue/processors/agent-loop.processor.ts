import { Process, Processor, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ReplanJob, QueueService } from '../queue.service';
import { AgentToolsService, ToolCallRequest, ToolCallResult } from '../../itinerary/agent-tools.service';
import { ImpactEngineService } from '../../itinerary/impact-engine.service';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStep {
  stepNumber: number;
  thought: string;
  toolCalls: ToolCallRequest[];
  observations: ToolCallResult[];
  decision: 'continue' | 'finalize' | 'abort';
}

export interface AgentLoopJob extends ReplanJob {
  /** Full current itinerary days (injected from trip_planning_jobs) */
  currentDays?: any[];
  destination?: string;
  travelStyle?: string;
}

interface FinalPlan {
  changes: any[];
  summary: string;
  impactRisk: string;
  toolsUsed: string[];
}

// ─── Safety Limits ────────────────────────────────────────────────────────────

const MAX_STEPS = 5;       // Max think→tool→observe loops
const MAX_TOOL_CALLS = 8;  // Max total tool invocations per job

/**
 * AgentLoopProcessor — True Think → Call Tool → Observe → Decide → Replan loop.
 *
 * Replaces the one-shot ReplanProcessor for high-stakes triggers
 * (weather, flight_delay, crowd, user_flag, poi_closed).
 *
 * Each iteration:
 *   1. THINK: send context + observations so far to Gemini
 *   2. TOOL: if Gemini requests tool calls → execute them
 *   3. OBSERVE: append results to context
 *   4. DECIDE: Gemini decides continue/finalize/abort
 *   5. FINALIZE: produce structured change list + impact assessment
 */
@Processor('agent-loop')
export class AgentLoopProcessor {
  private readonly logger = new Logger(AgentLoopProcessor.name);
  private geminiKeys: string[];
  private geminiKeyIndex = 0;

  constructor(
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    private readonly agentTools: AgentToolsService,
    private readonly impactEngine: ImpactEngineService,
  ) {
    this.geminiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean) as string[];
  }

  // ─── Entry Point ─────────────────────────────────────────────────────────

  @Process('run-agent-loop')
  async handleAgentLoop(job: Job<AgentLoopJob>): Promise<any> {
    const { tripId, userId, reason, affectedDays, context, currentDays, destination, travelStyle } = job.data;

    this.logger.log(`🤖 Agent loop START — trip=${tripId} reason=${reason} days=${affectedDays.join(',')}`);

    if (!this.geminiKeys.length) {
      this.logger.warn('No Gemini key — falling back to static replan');
      return this.staticFallback(tripId, userId, reason, affectedDays, context);
    }

    const toolDefs = this.agentTools.getToolDefinitions();
    const allObservations: ToolCallResult[] = [];
    const steps: AgentStep[] = [];
    let totalToolCalls = 0;

    // ── Build initial context message ────────────────────────────────────────
    const systemPrompt = this.buildSystemPrompt(toolDefs);
    let conversationHistory = this.buildInitialUserMessage(reason, affectedDays, context, currentDays, destination, travelStyle);

    // ── Think → Tool → Observe loop ─────────────────────────────────────────
    for (let stepNum = 1; stepNum <= MAX_STEPS; stepNum++) {
      this.logger.log(`🔄 Agent step ${stepNum}/${MAX_STEPS}`);

      // 1. THINK — ask Gemini what to do
      let geminiResponse: string;
      try {
        geminiResponse = await this.callGemini(systemPrompt + '\n\n' + conversationHistory);
      } catch (err: any) {
        this.logger.warn(`Gemini step ${stepNum} failed: ${err.message}`);
        break;
      }

      // 2. PARSE — extract tool calls or final plan
      const parsed = this.parseGeminiResponse(geminiResponse);

      const step: AgentStep = {
        stepNumber: stepNum,
        thought: parsed.thought,
        toolCalls: parsed.toolCalls,
        observations: [],
        decision: parsed.decision,
      };

      // 3. TOOL CALLS — execute in parallel (with safety limit)
      if (parsed.toolCalls.length > 0 && totalToolCalls < MAX_TOOL_CALLS) {
        const callsToRun = parsed.toolCalls.slice(0, MAX_TOOL_CALLS - totalToolCalls);
        this.logger.log(`🔧 Executing ${callsToRun.length} tool(s): ${callsToRun.map(c => c.name).join(', ')}`);

        const results = await Promise.all(
          callsToRun.map(tc => this.agentTools.executeTool(tc)),
        );

        step.observations = results;
        allObservations.push(...results);
        totalToolCalls += callsToRun.length;

        // Append tool results to conversation history for next step
        conversationHistory += `\n\nASSISTANT THOUGHT: ${parsed.thought}`;
        conversationHistory += `\n\nTOOL RESULTS:\n${results.map(r =>
          `[${r.tool}]: ${r.error ? `ERROR: ${r.error}` : JSON.stringify(r.result, null, 2)}`
        ).join('\n\n')}`;
        conversationHistory += `\n\nContinue your analysis using the above tool results. If you have enough data, produce the FINAL_PLAN.`;
      }

      steps.push(step);

      // 4. DECIDE — break if agent is done or aborting
      if (parsed.decision === 'finalize' || parsed.decision === 'abort') {
        this.logger.log(`Agent decided: ${parsed.decision} at step ${stepNum}`);

        if (parsed.decision === 'finalize' && parsed.finalPlan) {
          return this.submitProposal(
            tripId, userId, reason, affectedDays, context,
            parsed.finalPlan, allObservations,
          );
        }
        break;
      }

      if (totalToolCalls >= MAX_TOOL_CALLS) {
        this.logger.warn(`Tool call limit (${MAX_TOOL_CALLS}) reached. Forcing finalize.`);
        break;
      }
    }

    // ── FINAL STEP — force a finalization pass with all observations ─────────
    this.logger.log('🏁 Forcing final plan generation with all observations');
    const finalPrompt =
      systemPrompt + '\n\n' + conversationHistory +
      `\n\nYou must now produce the FINAL_PLAN JSON. Use all observations above. Do not call any more tools.`;

    try {
      const finalResponse = await this.callGemini(finalPrompt);
      const finalParsed = this.parseGeminiResponse(finalResponse);
      if (finalParsed.finalPlan) {
        return this.submitProposal(
          tripId, userId, reason, affectedDays, context,
          finalParsed.finalPlan, allObservations,
        );
      }
    } catch (err: any) {
      this.logger.error(`Final Gemini pass failed: ${err.message}`);
    }

    return this.staticFallback(tripId, userId, reason, affectedDays, context);
  }

  // ─── Prompt Builders ─────────────────────────────────────────────────────

  private buildSystemPrompt(toolDefs: any[]): string {
    const toolList = toolDefs.map(t => `  - ${t.name}: ${t.description}`).join('\n');

    return `You are an intelligent Indian travel agent AI for Travion. Your job is to replan a trip when something goes wrong.

## YOUR CAPABILITIES
You have access to these tools that return real data:
${toolList}

## HOW TO RESPOND

### If you need more data, respond with:
THOUGHT: <your reasoning>
TOOL_CALLS: <JSON array of tool calls>
[{"name": "tool_name", "args": {"param": "value"}}]
DECISION: continue

### When you have enough data, respond with:
THOUGHT: <your final reasoning>
TOOL_CALLS: []
DECISION: finalize
FINAL_PLAN: <JSON object>
{
  "changes": [
    {
      "day": 1,
      "originalActivity": "Beach visit",
      "newActivity": "City Museum tour",
      "reason": "Heavy rain — outdoor replaced with indoor",
      "time": "10:00 AM",
      "duration": "2 hours",
      "estimatedCost": 400
    }
  ],
  "summary": "2 activities replaced due to heavy rain on Day 1–2.",
  "impactRisk": "Low — budget unchanged, timing adjusted by 30 min."
}

## RULES
- Only change activities forced by the trigger. Never change hotels, flights, or unaffected days.
- Stay within original budget ±15%.
- Prefer well-known, verified Indian attractions as alternatives.
- If trigger is crowd: suggest time shifts or alternatives, don't cancel.
- If trigger is weather: prefer indoor alternatives with similar cultural/leisure value.
- If no changes are needed, return changes: [].`;
  }

  private buildInitialUserMessage(
    reason: string,
    affectedDays: number[],
    context: any,
    currentDays?: any[],
    destination?: string,
    travelStyle?: string,
  ): string {
    const daysList = affectedDays.map(d => `Day ${d + 1}`).join(', ');
    const ctxStr = JSON.stringify(context, null, 2);
    const daysStr = currentDays
      ? JSON.stringify(
          currentDays.filter((_, i) => affectedDays.includes(i)).map(d => ({
            day: d.day,
            activities: d.activities?.map((a: any) => ({
              name: a.name, time: a.time, duration: a.duration, estimatedCost: a.estimatedCost,
            })),
          })),
          null, 2,
        )
      : 'not provided';

    return `## TRIGGER: ${reason.toUpperCase()}
Destination: ${destination || context.destination || 'Unknown'}
Travel style: ${travelStyle || context.travelStyle || 'Cultural'}
Affected days: ${daysList}

## TRIGGER CONTEXT
${ctxStr}

## CURRENT ACTIVITIES FOR AFFECTED DAYS
${daysStr}

Analyze the situation using available tools, then produce a FINAL_PLAN.
Start by calling the most relevant tools to gather real-time data.`;
  }

  // ─── Gemini Call ─────────────────────────────────────────────────────────

  private async callGemini(prompt: string, retries = 3): Promise<string> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
      const key = this.geminiKeys[this.geminiKeyIndex % this.geminiKeys.length];
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err: any) {
        lastErr = err;
        if (/429|quota|RESOURCE_EXHAUSTED/.test(err.message || '')) {
          this.geminiKeyIndex++;
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  // ─── Response Parser ─────────────────────────────────────────────────────

  private parseGeminiResponse(text: string): {
    thought: string;
    toolCalls: ToolCallRequest[];
    decision: 'continue' | 'finalize' | 'abort';
    finalPlan?: FinalPlan;
  } {
    const clean = text.trim();

    // Extract THOUGHT
    const thoughtMatch = clean.match(/THOUGHT:\s*([\s\S]*?)(?=TOOL_CALLS:|DECISION:|FINAL_PLAN:|$)/);
    const thought = thoughtMatch?.[1]?.trim() || '';

    // Extract TOOL_CALLS JSON array
    let toolCalls: ToolCallRequest[] = [];
    const toolMatch = clean.match(/TOOL_CALLS:\s*(\[[\s\S]*?\])(?=\s*DECISION:)/);
    if (toolMatch) {
      try {
        const parsed = JSON.parse(toolMatch[1]);
        if (Array.isArray(parsed)) toolCalls = parsed;
      } catch { /* ignore parse errors */ }
    }

    // Extract DECISION
    const decMatch = clean.match(/DECISION:\s*(continue|finalize|abort)/i);
    const decision = (decMatch?.[1]?.toLowerCase() || 'continue') as 'continue' | 'finalize' | 'abort';

    // Extract FINAL_PLAN
    let finalPlan: FinalPlan | undefined;
    const finalMatch = clean.match(/FINAL_PLAN:\s*(\{[\s\S]*\})/);
    if (finalMatch) {
      try {
        const raw = JSON.parse(finalMatch[1]);
        finalPlan = {
          changes: Array.isArray(raw.changes) ? raw.changes : [],
          summary: raw.summary || '',
          impactRisk: raw.impactRisk || '',
          toolsUsed: [],
        };
      } catch { /* ignore */ }
    }

    return { thought, toolCalls, decision, finalPlan };
  }

  // ─── Proposal Submission ─────────────────────────────────────────────────

  private async submitProposal(
    tripId: string,
    userId: string,
    reason: string,
    affectedDays: number[],
    context: any,
    plan: FinalPlan,
    observations: ToolCallResult[],
  ): Promise<any> {
    const toolsUsed = [...new Set(observations.map(o => o.tool))];
    plan.toolsUsed = toolsUsed;

    if (plan.changes.length === 0) {
      this.logger.log(`✅ Agent concluded no changes needed for trip ${tripId}`);
      return { success: true, noChangesNeeded: true, toolsUsed };
    }

    // Run impact engine on the proposed changes
    let impactSummary = plan.impactRisk || 'Impact not calculated';
    try {
      if (context.currentDays?.length) {
        const firstChange = plan.changes[0];
        const dayIdx = (firstChange.day || 1) - 1;
        const dayData = context.currentDays[dayIdx];
        if (dayData?.activities?.length) {
          const impact = this.impactEngine.simulateSwap(
            context.currentDays,
            dayIdx,
            0,
            { estimatedCost: firstChange.estimatedCost, duration: firstChange.duration },
            reason,
          );
          impactSummary = impact.riskSummary;
        }
      }
    } catch { /* best-effort */ }

    const summary = [
      plan.summary || `${plan.changes.length} change(s) suggested for ${reason.replace('_', ' ')}.`,
      `Impact: ${impactSummary}`,
      toolsUsed.length ? `Tools used: ${toolsUsed.join(', ')}` : '',
    ].filter(Boolean).join(' ');

    const proposalId = await this.queueService.createProposal(
      tripId, userId, reason, affectedDays, plan.changes, { ...context, toolsUsed }, summary,
    );

    await this.queueService.queueNotification(userId, 'REPLAN_PROPOSED', {
      tripId, proposalId, reason, affectedDays,
      changes: plan.changes,
      message: summary,
      actionRequired: true,
      agentLoopUsed: true,
    });

    this.logger.log(`✅ Agent loop proposal ${proposalId} created — ${plan.changes.length} change(s), tools: [${toolsUsed.join(',')}]`);
    return { success: true, proposalId, changes: plan.changes.length, toolsUsed };
  }

  // ─── Static Fallback ─────────────────────────────────────────────────────

  private async staticFallback(
    tripId: string,
    userId: string,
    reason: string,
    affectedDays: number[],
    context: any,
  ): Promise<any> {
    this.logger.warn(`🔁 Falling back to static replan for trip ${tripId}`);
    const safeReason = (['weather', 'crowd', 'availability', 'user_request', 'flight_delay', 'transport_delay', 'user_flag', 'poi_closed'].includes(reason)
      ? reason
      : 'user_request') as 'weather' | 'crowd' | 'availability' | 'user_request' | 'flight_delay' | 'transport_delay' | 'user_flag' | 'poi_closed';
    await this.queueService.queueReplan({ tripId, userId, reason: safeReason, affectedDays, context });
    return { success: true, fallback: true };
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`✅ Agent loop job ${job.id} completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`❌ Agent loop job ${job.id} failed: ${err.message}`);
  }
}
