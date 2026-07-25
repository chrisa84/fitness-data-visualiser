import { useActiveTrainingPlan } from '../trainingPlans';
import ActivePlanView from './training/ActivePlanView';
import HistorySection from './training/HistorySection';
import IntakeForm from './training/IntakeForm';

/**
 * The Training page is one of two things depending on state: the intake form
 * and draft preview when no plan is active, or the active plan's checklist when
 * one is. Past plans are listed underneath either way. The pieces live in
 * `./training/`.
 */
export default function Training() {
  const activePlan = useActiveTrainingPlan();

  return (
    <>
      {activePlan.isLoading && <p className="status">Loading…</p>}
      {!activePlan.isLoading && activePlan.data && <ActivePlanView detail={activePlan.data} />}
      {!activePlan.isLoading && !activePlan.data && <IntakeForm />}
      <HistorySection />
    </>
  );
}
