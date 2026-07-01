import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ActivePlanExistsError,
  createTrainingPlan,
  createWorkout,
  deleteTrainingPlan,
  deleteWorkout,
  endTrainingPlan,
  getActiveTrainingPlan,
  getTrainingPlanDetail,
  listTrainingPlans,
  listWorkouts,
  updateWorkout,
  WorkoutValidationError,
} from '../repositories/trainingPlans.js';
import { trainingPlanBody, trainingPlanWorkoutBody, trainingPlanWorkoutUpdateBody } from '../schemas/trainingPlan.js';
import { badRequest } from './validation.js';

const listQuery = z.object({ status: z.enum(['active', 'ended']).optional() });

/** CRUD routes for training plans + their workouts, backed by the writable database. No AI here. */
export function registerTrainingPlanRoutes(app: FastifyInstance, eventsDb: Database): void {
  app.get('/api/training-plans', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error);
    return listTrainingPlans(eventsDb, parsed.data.status);
  });

  app.get('/api/training-plans/active', async (_request, reply) => {
    const plan = getActiveTrainingPlan(eventsDb);
    if (!plan) return reply.code(404).send({ error: 'not_found', message: 'no active training plan' });
    return { plan, workouts: listWorkouts(eventsDb, plan.id) };
  });

  app.get('/api/training-plans/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const detail = getTrainingPlanDetail(eventsDb, id);
    if (!detail) return reply.code(404).send({ error: 'not_found', message: `no training plan ${id}` });
    return detail;
  });

  app.post('/api/training-plans', async (request, reply) => {
    const parsed = trainingPlanBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    try {
      return reply.code(201).send(createTrainingPlan(eventsDb, parsed.data));
    } catch (e) {
      if (e instanceof ActivePlanExistsError) {
        return reply.code(409).send({ error: 'active_plan_exists', message: e.message });
      }
      throw e;
    }
  });

  app.post('/api/training-plans/:id/end', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const plan = endTrainingPlan(eventsDb, id);
    if (!plan) return reply.code(404).send({ error: 'not_found', message: `no training plan ${id}` });
    return plan;
  });

  app.delete('/api/training-plans/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deleteTrainingPlan(eventsDb, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no training plan ${id}` });
    }
    return { deleted: id };
  });

  app.post('/api/training-plans/:id/workouts', async (request, reply) => {
    const planId = Number((request.params as { id: string }).id);
    const parsed = trainingPlanWorkoutBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    const workout = createWorkout(eventsDb, planId, parsed.data);
    if (!workout) return reply.code(404).send({ error: 'not_found', message: `no training plan ${planId}` });
    return reply.code(201).send(workout);
  });

  app.patch('/api/training-plan-workouts/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = trainingPlanWorkoutUpdateBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error);
    try {
      const workout = updateWorkout(eventsDb, id, parsed.data);
      if (!workout) return reply.code(404).send({ error: 'not_found', message: `no workout ${id}` });
      return workout;
    } catch (e) {
      if (e instanceof WorkoutValidationError) {
        return reply.code(400).send({ error: 'invalid_workout', message: e.message });
      }
      throw e;
    }
  });

  app.delete('/api/training-plan-workouts/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deleteWorkout(eventsDb, id)) {
      return reply.code(404).send({ error: 'not_found', message: `no workout ${id}` });
    }
    return { deleted: id };
  });
}
