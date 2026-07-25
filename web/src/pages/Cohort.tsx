import { useQuery } from '@tanstack/react-query';
import type * as echarts from 'echarts';
import type { CohortOp, CohortStats } from '@fitness/shared';
import { COHORT_OPS, COHORT_OP_LABELS, METRIC_CATALOG, metricMeta } from '@fitness/shared';
import { useMemo, useState } from 'react';
import { fetchCohort } from '../api';
import Chart from '../Chart';
import RangeControls from '../RangeControls';
import { formatDuration } from '../format';
import { useChartRange } from '../useChartRange';

// EXPERIMENTAL (Phase 21) — see EXPERIMENTS.md for the removal recipe.

/**
 * "Does X change what Y looks like?" — split every day by a threshold on one
 * metric and compare another metric across the two groups.
 *
 * The Analysis page already does correlation-with-lag, which answers "do these
 * move together". This answers the differently-shaped question people actually
 * ask: "what happens on the days when…". A correlation over a threshold effect
 * (fine until 6 hours, bad below) reads as weak; a split shows it plainly.
 */

const DEFAULTS = {
  splitKey: 'sleep_hours',
  splitOp: 'lt' as CohortOp,
  splitValue: 6,
  outcomeKey: 'resting_hr',
  lagDays: 1,
};

/** Time-valued metrics (predicted 5K) read as durations, not raw seconds. */
function formatValue(value: number | null, key: string): string {
  if (value == null) return '—';
  return metricMeta(key)?.format === 'duration' ? formatDuration(value) : String(value);
}

function groupedByMetricGroup() {
  const groups = new Map<string, typeof METRIC_CATALOG>();
  for (const metric of METRIC_CATALOG) {
    groups.set(metric.group, [...(groups.get(metric.group) ?? []), metric] as typeof METRIC_CATALOG);
  }
  return [...groups.entries()];
}

function MetricSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {groupedByMetricGroup().map(([group, metrics]) => (
        <optgroup key={group} label={group}>
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
              {m.unit ? ` (${m.unit})` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function StatsTable({ outcomeKey, cohorts }: { outcomeKey: string; cohorts: CohortStats[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Group</th>
          <th className="num">Days</th>
          <th className="num">Mean</th>
          <th className="num">Median</th>
          <th className="num">25th–75th</th>
          <th className="num">Range</th>
        </tr>
      </thead>
      <tbody>
        {cohorts.map((c) => (
          <tr key={c.label}>
            <td>{c.label}</td>
            <td className="num">{c.n}</td>
            <td className="num">{formatValue(c.mean, outcomeKey)}</td>
            <td className="num">{formatValue(c.median, outcomeKey)}</td>
            <td className="num">
              {c.p25 == null ? '—' : `${formatValue(c.p25, outcomeKey)}–${formatValue(c.p75, outcomeKey)}`}
            </td>
            <td className="num">
              {c.min == null ? '—' : `${formatValue(c.min, outcomeKey)}–${formatValue(c.max, outcomeKey)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Cohort() {
  const { from, to, setParam } = useChartRange('day');
  const [splitKey, setSplitKey] = useState(DEFAULTS.splitKey);
  const [splitOp, setSplitOp] = useState<CohortOp>(DEFAULTS.splitOp);
  const [splitValue, setSplitValue] = useState(String(DEFAULTS.splitValue));
  const [outcomeKey, setOutcomeKey] = useState(DEFAULTS.outcomeKey);
  const [lagDays, setLagDays] = useState(DEFAULTS.lagDays);

  const numericSplitValue = Number(splitValue);
  const valid = splitValue.trim() !== '' && Number.isFinite(numericSplitValue);

  const cohort = useQuery({
    queryKey: ['cohort', { splitKey, splitOp, splitValue: numericSplitValue, outcomeKey, lagDays, from, to }],
    queryFn: () =>
      fetchCohort({
        splitKey,
        splitOp,
        splitValue: numericSplitValue,
        outcomeKey,
        lagDays,
        from: from || undefined,
        to: to || undefined,
      }),
    enabled: valid,
    placeholderData: (prev) => prev,
  });

  const data = cohort.data;
  const outcomeLabel = metricMeta(outcomeKey)?.label ?? outcomeKey;
  const better = metricMeta(outcomeKey)?.better;

  const chartOption = useMemo<echarts.EChartsOption | null>(() => {
    if (!data || data.matched.n === 0 || data.other.n === 0) return null;
    const cohorts = [data.matched, data.other];
    return {
      backgroundColor: 'transparent',
      title: {
        text: `${outcomeLabel} by group (median, with the middle half shaded)`,
        textStyle: { color: '#e6e8eb', fontSize: 13 },
        left: 0,
        top: 4,
      },
      grid: { containLabel: true, left: 8, right: 16, top: 40, bottom: 16 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: cohorts.map((c) => c.label),
        axisLabel: { color: '#8a93a0', interval: 0, width: 180, overflow: 'break' },
      },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#2a3038' } } },
      series: [
        // A floating bar from the 25th to the 75th percentile, drawn as an
        // invisible base plus the visible span — a poor man's box plot that
        // avoids pulling in ECharts' boxplot transform for two categories.
        {
          type: 'bar',
          name: 'base',
          stack: 'iqr',
          data: cohorts.map((c) => c.p25 ?? 0),
          itemStyle: { color: 'transparent' },
          tooltip: { show: false },
          silent: true,
        },
        {
          type: 'bar',
          name: '25th–75th percentile',
          stack: 'iqr',
          data: cohorts.map((c) => (c.p75 != null && c.p25 != null ? c.p75 - c.p25 : 0)),
          barCategoryGap: '45%',
          itemStyle: { color: 'rgba(95,168,230,0.35)' },
        },
        {
          type: 'scatter',
          name: 'Median',
          data: cohorts.map((c) => c.median),
          symbolSize: 14,
          symbol: 'rect',
          itemStyle: { color: '#5fce6e' },
        },
        {
          type: 'scatter',
          name: 'Mean',
          data: cohorts.map((c) => c.mean),
          symbolSize: 9,
          itemStyle: { color: '#e6b95f' },
        },
      ],
    };
  }, [data, outcomeLabel]);

  // "Better" is metric-specific: a lower resting HR is good, a lower HRV is not.
  const verdict = useMemo(() => {
    if (!data || data.differenceMean == null || data.differenceLow == null || data.differenceHigh == null) {
      return null;
    }
    const spansZero = data.differenceLow <= 0 && data.differenceHigh >= 0;
    if (spansZero) {
      return `No clear difference — the interval still includes zero, so these days look the same on ${outcomeLabel.toLowerCase()}.`;
    }
    const higher = data.differenceMean > 0;
    const direction = higher ? 'higher' : 'lower';
    if (!better) return `${outcomeLabel} runs ${direction} in the matched group.`;
    const good = (higher && better === 'higher') || (!higher && better === 'lower');
    return `${outcomeLabel} runs ${direction} in the matched group — the ${good ? 'better' : 'worse'} direction.`;
  }, [data, outcomeLabel, better]);

  return (
    <>
      <h2>Cohort comparison</h2>
      <p className="status">
        <strong>Experimental.</strong> Split your days by a condition on one metric, then compare
        another metric between the two groups — "resting HR the morning after a night under 6 hours,
        versus every other morning". Trial view; see EXPERIMENTS.md.
      </p>

      <RangeControls from={from} to={to} granularity="day" granularities={['day']} setParam={setParam} />

      <div className="settings-card">
        <h3>The question</h3>
        <div className="controls">
          <span>on days when</span>
          <MetricSelect value={splitKey} onChange={setSplitKey} />
          <select value={splitOp} onChange={(e) => setSplitOp(e.target.value as CohortOp)}>
            {COHORT_OPS.map((op) => (
              <option key={op} value={op}>
                is {COHORT_OP_LABELS[op]}
              </option>
            ))}
          </select>
          <input
            value={splitValue}
            onChange={(e) => setSplitValue(e.target.value)}
            inputMode="decimal"
            style={{ width: 80 }}
          />
          {!valid && <span className="status">enter a number</span>}
        </div>
        <div className="controls">
          <span>what happens to</span>
          <MetricSelect value={outcomeKey} onChange={setOutcomeKey} />
          <label>
            measured{' '}
            <select value={lagDays} onChange={(e) => setLagDays(Number(e.target.value))}>
              <option value={0}>the same day</option>
              <option value={1}>the next day</option>
              <option value={2}>2 days later</option>
              <option value={3}>3 days later</option>
              <option value={7}>a week later</option>
            </select>
          </label>
        </div>
      </div>

      {cohort.isPending && valid && <p className="status">Loading…</p>}
      {cohort.error && <p className="status">Failed to load: {(cohort.error as Error).message}</p>}

      {data && data.pairedDays === 0 && (
        <p className="status">
          No days where both metrics were recorded{data.lagDays > 0 ? ' the right distance apart' : ''}.
          Try a wider date range, a different lag, or metrics whose histories overlap.
        </p>
      )}

      {data && data.pairedDays > 0 && (
        <>
          <p className="status">
            {data.pairedDays} days compared · {data.matched.n} matched the condition,{' '}
            {data.other.n} did not.
          </p>

          <StatsTable outcomeKey={outcomeKey} cohorts={[data.matched, data.other]} />

          {data.differenceMean != null && (
            <div className="settings-card">
              <h3>Difference</h3>
              <p>
                {formatValue(data.differenceMean, outcomeKey)}{' '}
                <span className="status">
                  (95% interval {formatValue(data.differenceLow, outcomeKey)} to{' '}
                  {formatValue(data.differenceHigh, outcomeKey)})
                </span>
              </p>
              {verdict && <p className="status">{verdict}</p>}
              <p className="status">
                These are your own days, sorted after the fact — not an experiment. The interval says
                how precisely the gap is measured, not that the split caused it. Anything that moves
                both metrics (illness, a hard training block, a holiday) will show up here as a
                difference.
              </p>
            </div>
          )}

          {chartOption && <Chart option={chartOption} height={300} />}

          {(data.matched.n < 10 || data.other.n < 10) && (
            <p className="status">
              One group has fewer than 10 days — treat this as a hint, not a finding.
            </p>
          )}
        </>
      )}
    </>
  );
}
