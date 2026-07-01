import { useQuery } from '@tanstack/react-query';
import type { TrainingPlanStatus } from '@fitness/shared';
import { fetchActiveTrainingPlan, fetchTrainingPlan, fetchTrainingPlans } from './api';

export function useActiveTrainingPlan() {
  return useQuery({ queryKey: ['training-plans', 'active'], queryFn: fetchActiveTrainingPlan });
}

export function useTrainingPlans(status?: TrainingPlanStatus) {
  return useQuery({ queryKey: ['training-plans', status ?? 'all'], queryFn: () => fetchTrainingPlans(status) });
}

export function useTrainingPlanDetail(id: number | undefined) {
  return useQuery({
    queryKey: ['training-plans', 'detail', id],
    queryFn: () => fetchTrainingPlan(id!),
    enabled: id != null,
  });
}
