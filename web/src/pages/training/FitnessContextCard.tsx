import type { TrainingPlanAutofill, TrainingPlanAutofillOverrides } from '@fitness/shared';
import { formatDuration, formatKm, formatType } from '../../format';
import { summarizeNonRunningLoad } from './workoutFormat';

/**
 * The fitness context sent to the plan generator: auto-filled from Garmin data
 * on mount, always visible, and always editable — the model is told these as
 * facts, so the user needs to be able to correct them before generating.
 */
export default function FitnessContextCard({
  autofill,
  overrides,
  setOverrides,
  onRefresh,
  isRefreshing,
}: {
  autofill: TrainingPlanAutofill | undefined;
  overrides: TrainingPlanAutofillOverrides;
  setOverrides: (o: TrainingPlanAutofillOverrides) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const numberField = (
    label: string,
    key: 'weeklyVolumeAvgKm' | 'longestRecentRunKm' | 'vo2max',
    width: number,
  ) => (
    <label>
      {label}{' '}
      <input
        type="number"
        value={overrides[key] ?? ''}
        onChange={(e) =>
          setOverrides({ ...overrides, [key]: e.target.value === '' ? null : Number(e.target.value) })
        }
        style={{ width }}
      />
    </label>
  );

  return (
    <div className="settings-card">
      <h3>Your recent fitness (editable)</h3>
      <div className="controls">
        {numberField('weekly volume (km, avg last 6 wks)', 'weeklyVolumeAvgKm', 70)}
        {numberField('longest recent run (km, last 12 wks)', 'longestRecentRunKm', 70)}
        {numberField('VO2max', 'vo2max', 60)}
        <button type="button" disabled={isRefreshing} onClick={onRefresh}>
          Refresh from Garmin
        </button>
      </div>

      {autofill && autofill.weeklyVolumeTrend.length > 0 && (
        <p className="status">
          Volume trend (oldest→newest):{' '}
          {autofill.weeklyVolumeTrend.map((w) => `${w.distanceKm}km`).join(', ')}
        </p>
      )}

      {autofill && autofill.representativeRuns.length > 0 && (
        <p className="status">
          Representative recent runs (last 3 months):{' '}
          {autofill.representativeRuns
            .map(
              (r) =>
                `${r.date} ${r.label.replace('_', ' ')} (${formatType(r.type)}): ${formatKm(r.distanceKm * 1000, 1)} in ${formatDuration(r.durationS)}` +
                `${r.elevationGainM ? `, +${Math.round(r.elevationGainM)}m` : ''}`,
            )
            .join('; ')}
        </p>
      )}

      {autofill && (autofill.trainingLoad.acute != null || autofill.trainingLoad.chronic != null) && (
        <p className="status">
          Training load: acute {autofill.trainingLoad.acute ?? '—'}, chronic{' '}
          {autofill.trainingLoad.chronic ?? '—'}
          {autofill.trainingLoad.acwrTrend.length > 0
            ? `, ACWR trend ${autofill.trainingLoad.acwrTrend.join(' → ')}`
            : ''}
        </p>
      )}

      <div className="controls" style={{ display: 'block' }}>
        <label style={{ display: 'block', width: '100%' }}>
          Anything about your recent pace/effort we should know? (optional)
          <br />
          <textarea
            value={overrides.paceNotes ?? ''}
            onChange={(e) => setOverrides({ ...overrides, paceNotes: e.target.value })}
            rows={2}
            style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
          />
        </label>
      </div>
      <div className="controls" style={{ display: 'block' }}>
        <label style={{ display: 'block', width: '100%' }}>
          Other current training (non-running: cycling/swimming/walking, last 12 wks) — edit if this
          looks wrong
          <br />
          <textarea
            value={
              overrides.nonRunningLoadSummary ??
              (autofill ? (summarizeNonRunningLoad(autofill) ?? '') : '')
            }
            onChange={(e) => setOverrides({ ...overrides, nonRunningLoadSummary: e.target.value })}
            rows={2}
            style={{ width: '100%', maxWidth: 500, boxSizing: 'border-box' }}
          />
        </label>
      </div>
    </div>
  );
}
