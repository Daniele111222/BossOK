import { createApprovals } from './approval.js';
import { createNotifications } from '../notifications/index.js';
import { approvalBodySchema, approvalActionSchema, approvalSchema, approvalPageSchema, approvalDetailSchema, approvalPreviewSchema, type ApprovalInput, type ApprovalAction } from '@bossok/contracts';
import { expenseChangeSchema, expenseEditSchema, refundBodySchema, expenseDetailSchema, type ExpenseChangeInput, type ExpenseEditInput, type RefundInput } from '@bossok/contracts';
import { createLedger } from './ledger.js';
import { categories, expenseBodySchema, expenseSchema, ledgerPageSchema, balancesSchema, type ExpenseInput } from '@bossok/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { budgetBodySchema, budgetSnapshotSchema, dateSchema, type BudgetInput } from '@bossok/contracts';
import type { IdentityService } from '../identity/index.js';
import { createBudgets, businessDate, validDate } from './budget.js';

export function registerSpending(app: FastifyInstance, db: Database.Database, identity: IdentityService, now = Date.now) {
  const budgets = createBudgets(db, now);
  const ledger = createLedger(db, budgets, now);
  const notifications = createNotifications(db, now);
  notifications.register(app, identity);
  const approvals = createApprovals(db, ledger, (relationshipId,role,id,title) => notifications.write(identity.recipient(relationshipId,role),id,title), now);
  app.post<{ Body: ApprovalInput }>('/api/approvals/preview', { schema: { body: approvalBodySchema, response: { 200: approvalPreviewSchema } } }, async request => approvals.preview(identity.member(request, 'applicant').relationshipId,request.body));
  app.post<{ Body: ApprovalInput }>('/api/approvals', { schema: { body: approvalBodySchema, response: { 200: approvalSchema } } }, async request => {
    const actor = identity.member(request,'applicant');
    return approvals.create(actor.relationshipId,actor.id,request.body);
  });
  app.get<{ Querystring: { month: string; page?: number } }>('/api/approvals', { schema: { response: { 200: approvalPageSchema }, querystring: { type: 'object', additionalProperties: false, required: ['month'], properties: { month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, page: { type: 'integer', minimum: 1, maximum: 100000 } } } } }, async request => {
    const actor = identity.member(request); validDate(`${request.query.month}-01`, businessDate(now()));
    return approvals.list(actor.relationshipId,request.query.month,request.query.page ?? 1);
  });
  app.get<{ Params: { id: string } }>('/api/approvals/:id', { schema: { response: { 200: approvalDetailSchema } } }, async request => approvals.detail(identity.member(request).relationshipId,request.params.id));
  app.post<{ Params: { id: string }; Body: ApprovalAction }>('/api/approvals/:id/actions', { schema: { body: approvalActionSchema, response: { 200: approvalSchema } } }, async request => {
    const actor = identity.member(request);
    return approvals.act(actor.relationshipId,actor.id,actor.role,request.params.id,request.body);
  });
  app.get<{ Params: { id: string } }>('/api/expenses/:id', { schema: { response: { 200: expenseDetailSchema } } }, async request => ledger.detail(identity.member(request).relationshipId, request.params.id));
  for (const [path, kind, schema] of [['update','update',expenseEditSchema], ['delete','delete',expenseChangeSchema], ['refunds','refund',refundBodySchema]] as const) {
    app.post<{ Params: { id: string }; Body: ExpenseChangeInput | ExpenseEditInput | RefundInput }>(`/api/expenses/:id/${path}`, { schema: { body: schema, response: { 200: expenseSchema } } }, async request => {
      const actor = identity.member(request, 'applicant');
      if ('spentOn' in request.body) validDate(request.body.spentOn, businessDate(now()));
      if ('refundedOn' in request.body) validDate(request.body.refundedOn, businessDate(now()));
      return ledger.change(actor.relationshipId, actor.id, request.params.id, kind, request.body);
    });
  }
  app.get('/api/balances', { schema: { response: { 200: balancesSchema } } }, async request => {
    const actor = identity.member(request);
    return ledger.balances(actor.relationshipId, businessDate(now()));
  });
  app.post<{ Body: ExpenseInput }>('/api/expenses', { schema: { body: expenseBodySchema, response: { 200: expenseSchema } } }, async request => {
    const actor = identity.member(request, 'applicant');
    validDate(request.body.spentOn, businessDate(now()));
    return ledger.create(actor.relationshipId, actor.id, request.body);
  });
  app.get<{ Querystring: { month: string; category?: string; page?: number; pageSize?: number } }>('/api/expenses', { schema: {
    response: { 200: ledgerPageSchema },
    querystring: { type: 'object', required: ['month'], additionalProperties: false, properties: {
      month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' }, category: { enum: categories }, page: { type: 'integer', minimum: 1, maximum: 100000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }
    } }
  } }, async request => {
    const actor = identity.member(request), query = request.query;
    validDate(`${query.month}-01`, businessDate(now()));
    return ledger.list(actor.relationshipId, query.month, query.category, query.page ?? 1, query.pageSize ?? 20);
  });
  app.get<{ Querystring: { date?: string } }>('/api/budget', { schema: { response: { 200: budgetSnapshotSchema }, querystring: { type: 'object', additionalProperties: false, properties: { date: dateSchema } } } }, async request => {
    const actor = identity.member(request);
    return budgets.snapshot(actor.relationshipId, validDate(request.query.date ?? businessDate(now()), businessDate(now())));
  });
  app.post<{ Body: BudgetInput }>('/api/budget', { schema: { body: budgetBodySchema, response: { 200: budgetSnapshotSchema } } }, async request => {
    const actor = identity.member(request, 'approver');
    return budgets.save(actor.relationshipId, actor.id, request.body);
  });
}
