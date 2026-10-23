import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { budgetBodySchema, budgetSnapshotSchema, dateSchema, type BudgetInput } from '@bossok/contracts';
import type { IdentityService } from '../identity/index.js';
import { createBudgets, businessDate, validDate } from './budget.js';

export function registerSpending(app: FastifyInstance, db: Database.Database, identity: IdentityService, now = Date.now) {
  const budgets = createBudgets(db, now);
  app.get<{ Querystring: { date?: string } }>('/api/budget', { schema: { response: { 200: budgetSnapshotSchema }, querystring: { type: 'object', additionalProperties: false, properties: { date: dateSchema } } } }, async request => {
    const actor = identity.member(request);
    return budgets.snapshot(actor.relationshipId, validDate(request.query.date ?? businessDate(now()), businessDate(now())));
  });
  app.post<{ Body: BudgetInput }>('/api/budget', { schema: { body: budgetBodySchema, response: { 200: budgetSnapshotSchema } } }, async request => {
    const actor = identity.member(request, 'approver');
    return budgets.save(actor.relationshipId, actor.id, request.body);
  });
}
