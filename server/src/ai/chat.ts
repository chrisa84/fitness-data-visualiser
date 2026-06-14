import type OpenAI from 'openai';
import { METRIC_CATALOG } from '@fitness/shared';
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools.js';

const MAX_STEPS = 8;

/** Minimal shape of the OpenAI/OpenRouter client we depend on (eases testing). */
export interface CompletionClient {
  chat: {
    completions: {
      create(body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  reply: string;
  toolCalls: { name: string; arguments: unknown }[];
}

function systemPrompt(today: string, context?: string): string {
  const catalog = METRIC_CATALOG.map(
    (m) => `${m.key} (${m.label}${m.unit ? `, ${m.unit}` : ''})`,
  ).join(', ');
  const lines = [
    `You are a fitness data analyst embedded in a personal Garmin data app. Today is ${today}.`,
    'Answer questions about the user\'s training, health, sleep, recovery and performance using the provided tools. Prefer the named tools; use run_sql only for things they cannot express.',
    'All data is local and read-only. Stored distances are metres, durations seconds, dates ISO (YYYY-MM-DD). When you report numbers, convert to friendly units (km, min/km pace, h:mm). Be concise and specific, and cite the date ranges you used. If data is missing for a period, say so rather than guessing.',
    'Replies are rendered as GitHub-flavored markdown. Use it for clarity (short tables, lists, bold), but keep tables narrow (2–3 columns) so they fit a side panel.',
    `Metric keys for get_metric_series: ${catalog}.`,
  ];
  if (context) {
    lines.push(
      `The user is currently viewing this screen: ${context}. If they say "this", "here", or "what I'm looking at", interpret it relative to that screen and its filters.`,
    );
  }
  return lines.join('\n');
}

/**
 * Runs the tool-use loop: ask the model, execute any tool calls against the
 * local databases, feed results back, repeat until it answers or hits the step
 * limit.
 */
export async function runChat(opts: {
  client: CompletionClient;
  model: string;
  ctx: ToolContext;
  messages: ChatTurn[];
  today?: string;
  /** Short description of the screen/filters the user is viewing (a hint). */
  context?: string;
}): Promise<ChatResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(today, opts.context) },
    ...opts.messages,
  ];
  const toolCalls: { name: string; arguments: unknown }[] = [];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const resp = await opts.client.chat.completions.create({
      model: opts.model,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    });
    const msg = resp.choices[0]?.message;
    if (!msg) throw new Error('no response from model');
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content ?? '', toolCalls };
    }

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      let result: unknown;
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        toolCalls.push({ name: call.function.name, arguments: args });
        result = executeTool(call.function.name, args, opts.ctx);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { reply: 'I could not complete the analysis within the step limit.', toolCalls };
}
