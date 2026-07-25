import { useState } from 'react';
import { useTrainingPlanDetail, useTrainingPlans } from '../../trainingPlans';
import { metresToKmInput, workoutDetailsLine } from './workoutFormat';

/** Ended plans stay browsable — expand one to see how it actually went. */
export default function HistorySection() {
  const ended = useTrainingPlans('ended');
  const [expandedId, setExpandedId] = useState<number | undefined>(undefined);
  const detail = useTrainingPlanDetail(expandedId);

  if (!ended.data || ended.data.length === 0) return null;

  return (
    <>
      <h3>Past plans</h3>
      <table>
        <thead>
          <tr>
            <th>Goal</th>
            <th>Dates</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ended.data.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.goalDescription || '—'}</td>
              <td>
                {plan.startDate} to {plan.endDate}
              </td>
              <td>
                <button onClick={() => setExpandedId(expandedId === plan.id ? undefined : plan.id)}>
                  {expandedId === plan.id ? 'hide' : 'view'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.data && (
        <table>
          <thead>
            <tr>
              <th>Done</th>
              <th>Date</th>
              <th>Type</th>
              <th>Workout</th>
              <th>Distance</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.workouts.map((w) => (
              <tr key={w.id}>
                <td>{w.completedAt != null ? '✓' : ''}</td>
                <td>{w.date}</td>
                <td>{w.workoutType}</td>
                <td>
                  {w.title}
                  {workoutDetailsLine(w) && (
                    <div className="status" style={{ fontSize: '0.85em' }}>
                      {workoutDetailsLine(w)}
                    </div>
                  )}
                </td>
                <td>{w.targetDistanceM != null ? `${metresToKmInput(w.targetDistanceM)} km` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
