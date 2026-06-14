import { useQuery } from '@tanstack/react-query';
import type { ActivityDetail as Detail } from '@fitness/shared';
import { Link, useParams } from 'react-router-dom';
import { fetchActivity } from '../api';
import { formatDateTime, formatDuration, formatKm, formatNumber, formatPace, formatType } from '../format';

function Stat({ label, value }: { label: string; value: string }) {
  if (value === '—') return null;
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function HrZones({ a }: { a: Detail }) {
  const zones = [a.hrZone1S, a.hrZone2S, a.hrZone3S, a.hrZone4S, a.hrZone5S];
  if (zones.every((z) => z == null || z === 0)) return null;
  const total = zones.reduce((sum: number, z) => sum + (z ?? 0), 0);
  const colors = ['#7f8c9b', '#5fa8e6', '#5fce6e', '#e6b95f', '#e66a5f'];
  return (
    <section>
      <h3>Heart rate zones</h3>
      <div className="zones">
        {zones.map((z, i) => (
          <div key={i} className="zone-row">
            <span className="zone-label">Z{i + 1}</span>
            <div className="zone-track">
              <div
                className="zone-bar"
                style={{ width: `${total ? ((z ?? 0) / total) * 100 : 0}%`, background: colors[i] }}
              />
            </div>
            <span className="zone-time">
              {formatDuration(z ?? 0)} ({total ? Math.round(((z ?? 0) / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Splits({ a }: { a: Detail }) {
  if (a.splits.length === 0) return null;
  const showDistance = a.splits.some((s) => (s.distanceM ?? 0) > 0);
  return (
    <section>
      <h3>Splits</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            {showDistance && <th className="num">Distance</th>}
            <th className="num">Duration</th>
            {showDistance && <th className="num">Pace</th>}
            <th className="num">Avg HR</th>
            <th className="num">Max HR</th>
          </tr>
        </thead>
        <tbody>
          {a.splits.map((s) => (
            <tr key={s.splitIndex}>
              <td>{s.splitIndex + 1}</td>
              <td>{s.splitType?.replace(/_/g, ' ').toLowerCase() ?? '—'}</td>
              {showDistance && <td className="num">{s.distanceM ? formatKm(s.distanceM) : '—'}</td>}
              <td className="num">{formatDuration(s.durationS)}</td>
              {showDistance && <td className="num">{formatPace(s.avgSpeedMps)}</td>}
              <td className="num">{formatNumber(s.avgHr)}</td>
              <td className="num">{formatNumber(s.maxHr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: a, isPending, error } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => fetchActivity(id!),
    enabled: !!id,
  });

  if (isPending) return <p className="status">Loading…</p>;
  if (error) return <p className="status">Failed to load: {(error as Error).message}</p>;
  if (!a) return null;

  const isRun = a.type?.includes('running') ?? false;

  return (
    <>
      <p>
        <Link to="/activities">← activities</Link>
      </p>
      <h2>{a.name ?? '(unnamed)'}</h2>
      <p className="status">
        {formatType(a.type)} · {formatDateTime(a.startTimeLocal)}
      </p>

      <div className="stat-grid">
        <Stat label="Distance" value={a.distanceM ? formatKm(a.distanceM) : '—'} />
        <Stat label="Duration" value={formatDuration(a.durationS)} />
        <Stat label={isRun ? 'Avg pace' : 'Avg speed'} value={
          isRun
            ? formatPace(a.avgSpeedMps)
            : a.avgSpeedMps != null
              ? `${(a.avgSpeedMps * 3.6).toFixed(1)} km/h`
              : '—'
        } />
        <Stat label="Avg HR" value={formatNumber(a.avgHr, ' bpm')} />
        <Stat label="Max HR" value={formatNumber(a.maxHr, ' bpm')} />
        <Stat label="Elevation gain" value={formatNumber(a.elevationGainM, ' m')} />
        <Stat label="Calories" value={formatNumber(a.calories)} />
        <Stat label="Training load" value={formatNumber(a.trainingLoad)} />
        <Stat label="Aerobic TE" value={formatNumber(a.aerobicTe, '', 1)} />
        <Stat label="Anaerobic TE" value={formatNumber(a.anaerobicTe, '', 1)} />
        <Stat label="VO2max" value={formatNumber(a.vo2max, '', 1)} />
        <Stat label="Avg cadence" value={formatNumber(a.avgCadence, ' spm')} />
        <Stat label="Avg power" value={formatNumber(a.avgPower, ' W')} />
        <Stat label="Norm power" value={formatNumber(a.normPower, ' W')} />
        <Stat label="Fastest km" value={a.fastestKmS ? formatDuration(a.fastestKmS) : '—'} />
        <Stat label="Fastest 5k" value={a.fastest5kS ? formatDuration(a.fastest5kS) : '—'} />
        <Stat label="Steps" value={formatNumber(a.activitySteps)} />
        <Stat label="Body battery" value={a.bodyBatteryDelta != null ? `${a.bodyBatteryDelta > 0 ? '+' : ''}${a.bodyBatteryDelta}` : '—'} />
        <Stat label="Avg respiration" value={formatNumber(a.avgRespirationRate, ' brpm', 1)} />
        <Stat label="Avg temp" value={formatNumber(a.tempAvgC, ' °C', 1)} />
        <Stat label="Sweat loss" value={formatNumber(a.waterEstimatedMl, ' ml')} />
        <Stat
          label="Stamina"
          value={
            a.staminaStart != null && a.staminaEnd != null
              ? `${a.staminaStart}% → ${a.staminaEnd}%`
              : '—'
          }
        />
      </div>

      {(a.groundContactMs != null || a.strideLengthCm != null) && (
        <section>
          <h3>Running dynamics</h3>
          <div className="stat-grid">
            <Stat label="Ground contact" value={formatNumber(a.groundContactMs, ' ms')} />
            <Stat
              label="L/R balance"
              value={
                a.groundContactBalanceLeft != null
                  ? `${a.groundContactBalanceLeft.toFixed(1)}% L / ${(100 - a.groundContactBalanceLeft).toFixed(1)}% R`
                  : '—'
              }
            />
            <Stat label="Vertical oscillation" value={formatNumber(a.verticalOscillationCm, ' cm', 1)} />
            <Stat label="Vertical ratio" value={formatNumber(a.verticalRatioPct, ' %', 1)} />
            <Stat
              label="Stride length"
              value={a.strideLengthCm != null ? `${(a.strideLengthCm / 100).toFixed(2)} m` : '—'}
            />
          </div>
        </section>
      )}

      <HrZones a={a} />
      <Splits a={a} />
    </>
  );
}
