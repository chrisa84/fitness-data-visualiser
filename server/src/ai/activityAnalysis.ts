import type { ActivityDetail, ActivitySample } from '@fitness/shared';
import type { CompletionClient } from './chat.js';
import { mmss, round1 } from './planGeneration.js';

export class ActivityAnalysisError extends Error {}

function paceOf(speedMps: number | null | undefined): string | null {
  if (speedMps == null || speedMps <= 0) return null;
  return `${mmss(Math.round(1000 / speedMps))}/km`;
}

/** Mean of the non-null values, or null when there are none. */
function mean(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Compact, fixed-size prompt summary of one activity: headline stats, HR
 * zones, running dynamics, the recorded splits, and a first-half vs
 * second-half comparison from the raw samples (pace/HR decoupling — the one
 * signal the per-split table cannot show directly).
 */
export function buildActivitySummary(a: ActivityDetail, samples: ActivitySample[]): string {
  const lines: string[] = [];

  lines.push(
    [
      `Activity: ${a.name ?? '(unnamed)'}`,
      a.type,
      a.startTimeLocal,
      a.distanceM != null ? `${round1(a.distanceM / 1000)}km` : null,
      a.durationS != null ? `duration ${mmss(a.durationS)}` : null,
      paceOf(a.avgSpeedMps) ? `avg pace ${paceOf(a.avgSpeedMps)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  const stats: [string, string | null][] = [
    ['avg HR', a.avgHr != null ? `${a.avgHr} bpm` : null],
    ['max HR', a.maxHr != null ? `${a.maxHr} bpm` : null],
    ['avg cadence', a.avgCadence != null ? `${a.avgCadence} spm` : null],
    ['elevation gain', a.elevationGainM != null ? `${Math.round(a.elevationGainM)} m` : null],
    ['training load', a.trainingLoad != null ? String(a.trainingLoad) : null],
    ['aerobic TE', a.aerobicTe != null ? String(a.aerobicTe) : null],
    ['anaerobic TE', a.anaerobicTe != null ? String(a.anaerobicTe) : null],
    ['VO2max', a.vo2max != null ? String(a.vo2max) : null],
    ['avg power', a.avgPower != null ? `${a.avgPower} W` : null],
    ['fastest km', a.fastestKmS != null ? mmss(a.fastestKmS) : null],
    ['fastest 5k', a.fastest5kS != null ? mmss(a.fastest5kS) : null],
    ['ground contact', a.groundContactMs != null ? `${a.groundContactMs} ms` : null],
    ['L/R balance', a.groundContactBalanceLeft != null ? `${a.groundContactBalanceLeft}% left` : null],
    ['vertical oscillation', a.verticalOscillationCm != null ? `${a.verticalOscillationCm} cm` : null],
    ['vertical ratio', a.verticalRatioPct != null ? `${a.verticalRatioPct}%` : null],
    ['stride length', a.strideLengthCm != null ? `${round1(a.strideLengthCm / 100)} m` : null],
    ['avg temp', a.tempAvgC != null ? `${a.tempAvgC} °C` : null],
  ];
  const present = stats.filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`);
  if (present.length > 0) lines.push(`Stats: ${present.join(', ')}.`);

  const zones = [a.hrZone1S, a.hrZone2S, a.hrZone3S, a.hrZone4S, a.hrZone5S];
  if (zones.some((z) => z != null && z > 0)) {
    lines.push(`Time in HR zones (Z1-Z5): ${zones.map((z) => mmss(z ?? 0)).join(', ')}.`);
  }

  if (a.splits.length > 0 && a.splits.length <= 60) {
    lines.push('Splits (index, distance, duration, pace, avgHR):');
    for (const s of a.splits) {
      lines.push(
        `- ${s.splitIndex + 1}: ${s.distanceM != null ? `${round1(s.distanceM / 1000)}km` : '—'} ` +
          `${s.durationS != null ? mmss(s.durationS) : '—'} ${paceOf(s.avgSpeedMps) ?? '—'} ` +
          `${s.avgHr != null ? `${s.avgHr}bpm` : '—'}`,
      );
    }
  }

  // First-half vs second-half from raw samples: pace/HR decoupling.
  if (samples.length >= 60) {
    const mid = samples.length >> 1;
    const halves = [samples.slice(0, mid), samples.slice(mid)];
    const parts = halves.map((h, i) => {
      const speed = mean(h.map((s) => (s.speedMps != null && s.speedMps >= 0.5 ? s.speedMps : null)));
      const hr = mean(h.map((s) => s.heartRate));
      return `${i === 0 ? 'first' : 'second'} half: ${paceOf(speed) ?? 'pace —'}, ${hr != null ? `${Math.round(hr)} bpm` : 'HR —'}`;
    });
    lines.push(`Halves (by time): ${parts.join('; ')}.`);
  }

  return lines.join('\n');
}

function systemPrompt(summary: string): string {
  return [
    'You are an experienced running coach embedded in a personal Garmin data app, analysing a single recorded activity for the athlete.',
    'Ground every observation in the numbers below — pacing evenness, HR drift between halves (aerobic decoupling), zone distribution, cadence, and form metrics where present. Point out what went well, what to watch, and one or two concrete suggestions. Do not invent data that is not in the summary. Keep it under ~400 words and use plain markdown (no tables).',
    '',
    summary,
  ].join('\n');
}

/** One-shot completion: no tool loop, the summary already contains everything. */
export async function analyzeActivity(opts: {
  client: CompletionClient;
  model: string;
  summary: string;
  question?: string;
}): Promise<string> {
  const resp = await opts.client.chat.completions.create({
    model: opts.model,
    messages: [
      { role: 'system', content: systemPrompt(opts.summary) },
      {
        role: 'user',
        content:
          opts.question?.trim() ||
          'Give me your overall analysis of this activity.',
      },
    ],
  });
  const content = resp.choices?.[0]?.message?.content;
  if (!content) throw new ActivityAnalysisError('no response from model');
  return content;
}
