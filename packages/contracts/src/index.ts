export const healthyResponse = {
  status: 'ok',
  service: 'bossok-api',
  database: 'ok'
} as const;

export type HealthResponse = typeof healthyResponse;

export const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'service', 'database'],
  properties: {
    status: { type: 'string', const: healthyResponse.status },
    service: { type: 'string', const: healthyResponse.service },
    database: { type: 'string', const: healthyResponse.database }
  }
} as const;

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.status === healthyResponse.status
    && response.service === healthyResponse.service
    && response.database === healthyResponse.database;
}

export interface ErrorResponse {
  code: string;
  message: string;
  requestId: string;
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return typeof response.code === 'string'
    && typeof response.message === 'string'
    && typeof response.requestId === 'string';
}

export type Role = 'approver' | 'applicant';
export interface Identity { id: string; username: string; role: Role; relationshipId: string | null }
export interface LoginResponse { token: string; expiresAt: number; user: Identity }
export interface Invitation { code: string; expiresAt: number }
export function isIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Identity;
  return typeof v.id === 'string' && typeof v.username === 'string'
    && (v.role === 'approver' || v.role === 'applicant')
    && (v.relationshipId === null || typeof v.relationshipId === 'string');
}
export function isLoginResponse(value: unknown): value is LoginResponse {
  const v = value as LoginResponse | null;
  return !!v && typeof v.token === 'string' && typeof v.expiresAt === 'number' && isIdentity(v.user);
}
export function isInvitation(value: unknown): value is Invitation {
  const v = value as Invitation | null;
  return !!v && typeof v.code === 'string' && typeof v.expiresAt === 'number';
}

const stringField = (maxLength: number, minLength = 1) => ({ type: 'string', minLength, maxLength });
export const loginBodySchema = { type: 'object', required: ['username', 'password'], properties: { username: stringField(64), password: stringField(128) } } as const;
export const bindBodySchema = { type: 'object', required: ['code', 'acceptSharing'], properties: { code: stringField(64), acceptSharing: { const: true } } } as const;
export const identitySchema = {
  type: 'object', required: ['id', 'username', 'role', 'relationshipId'], additionalProperties: false,
  properties: { id: stringField(64), username: stringField(64), role: { enum: ['approver', 'applicant'] }, relationshipId: { type: ['string', 'null'] } }
} as const;
export const loginResponseSchema = {
  type: 'object', required: ['token', 'expiresAt', 'user'], additionalProperties: false,
  properties: { token: stringField(64), expiresAt: { type: 'integer' }, user: identitySchema }
} as const;
export const invitationSchema = {
  type: 'object', required: ['code', 'expiresAt'], additionalProperties: false,
  properties: { code: stringField(64), expiresAt: { type: 'integer' } }
} as const;

export const categories = ['餐饮', '交通', '购物', '娱乐', '生活缴费', '其他'] as const;
export type Category = typeof categories[number];
export const defaultDailyCategories: Category[] = categories.filter(c => c !== '生活缴费');
export interface BudgetVersion { id: number; kind: 'daily' | 'monthly'; amount: number; categories: Category[]; effectiveDate: string; reason: string; createdAt: number }
export interface BudgetSnapshot { date: string; startDate: string | null; daily: BudgetVersion | null; monthly: BudgetVersion | null; history: BudgetVersion[] }
export interface BudgetInput { daily?: number; monthly?: number; dailyCategories?: Category[]; reason: string }
export const amountSchema = { type: 'integer', minimum: 1, maximum: 100000000 } as const;
export const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
export const budgetBodySchema = {
  type: 'object', additionalProperties: false, required: ['reason'], minProperties: 2,
  properties: { daily: amountSchema, monthly: amountSchema, dailyCategories: { type: 'array', uniqueItems: true, maxItems: 6, items: { enum: categories } }, reason: { type: 'string', minLength: 1, maxLength: 300 } }
} as const;
export function isBudgetVersion(value: unknown): value is BudgetVersion {
  const v = value as BudgetVersion | null;
  return !!v && Number.isSafeInteger(v.id) && (v.kind === 'daily' || v.kind === 'monthly') && Number.isSafeInteger(v.amount) && v.amount > 0
    && Array.isArray(v.categories) && v.categories.every(c => categories.includes(c)) && typeof v.effectiveDate === 'string' && typeof v.reason === 'string' && typeof v.createdAt === 'number';
}
export function isBudgetSnapshot(value: unknown): value is BudgetSnapshot {
  const v = value as BudgetSnapshot | null;
  return !!v && typeof v.date === 'string' && (v.startDate === null || typeof v.startDate === 'string')
    && (v.daily === null || isBudgetVersion(v.daily)) && (v.monthly === null || isBudgetVersion(v.monthly)) && Array.isArray(v.history) && v.history.every(isBudgetVersion);
}
export function yuanToCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('金额需为正数，最多两位小数');
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) throw new Error('金额范围为 0.01–1,000,000 元');
  return amount;
}
export const budgetVersionSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'kind', 'amount', 'categories', 'effectiveDate', 'reason', 'createdAt'],
  properties: { id: { type: 'integer' }, kind: { enum: ['daily', 'monthly'] }, amount: amountSchema, categories: { type: 'array', items: { enum: categories } }, effectiveDate: dateSchema, reason: { type: 'string' }, createdAt: { type: 'integer' } }
} as const;
export const budgetSnapshotSchema = {
  type: 'object', additionalProperties: false, required: ['date', 'startDate', 'daily', 'monthly', 'history'],
  properties: { date: dateSchema, startDate: { type: ['string', 'null'] }, daily: { anyOf: [budgetVersionSchema, { type: 'null' }] }, monthly: { anyOf: [budgetVersionSchema, { type: 'null' }] }, history: { type: 'array', items: budgetVersionSchema } }
} as const;

export interface ExpenseInput { requestId: string; amount: number; category: Category; spentOn: string; note: string }
export interface Expense extends ExpenseInput { id: string; createdAt: number; budgetApplicable: boolean; unapproved: boolean; version: number; deletedAt: number | null; refunded: number; approvalId: string | null; unapprovedAmount: number }
export interface LedgerPage { records: Expense[]; total: number; page: number; pageSize: number }
export interface Balances { budget: BudgetSnapshot; dailySpent: number; monthlySpent: number; dailyRemaining: number | null; monthlyRemaining: number | null; dailyCommitted: number; monthlyCommitted: number; dailyAvailable: number | null; monthlyAvailable: number | null }
export const expenseBodySchema = {
  type: 'object', additionalProperties: false, required: ['requestId', 'amount', 'category', 'spentOn', 'note'],
  properties: { requestId: { type: 'string', minLength: 8, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' }, amount: amountSchema, category: { enum: categories }, spentOn: dateSchema, note: { type: 'string', maxLength: 500 } }
} as const;
export const expenseSchema = { type: 'object', additionalProperties: false,
  required: [...expenseBodySchema.required, 'id', 'createdAt', 'budgetApplicable', 'unapproved', 'version', 'deletedAt', 'refunded', 'approvalId', 'unapprovedAmount'],
  properties: { ...expenseBodySchema.properties, id: { type: 'string' }, createdAt: { type: 'integer' }, budgetApplicable: { type: 'boolean' }, unapproved: { type: 'boolean' }, version: { type: 'integer' }, deletedAt: { type: ['integer', 'null'] }, refunded: { type: 'integer' }, approvalId: { type: ['string','null'] }, unapprovedAmount: { type: 'integer' } }
} as const;
export const ledgerPageSchema = { type: 'object', required: ['records','total','page','pageSize'], properties: { records: { type: 'array', items: expenseSchema }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } } as const;
export const balancesSchema = { type: 'object', required: ['budget', 'dailySpent', 'monthlySpent', 'dailyRemaining', 'monthlyRemaining', 'dailyCommitted', 'monthlyCommitted', 'dailyAvailable', 'monthlyAvailable'], properties: { budget: budgetSnapshotSchema, dailySpent: { type: 'integer' }, monthlySpent: { type: 'integer' }, dailyRemaining: { type: ['integer', 'null'] }, monthlyRemaining: { type: ['integer', 'null'] }, dailyCommitted: { type: 'integer' }, monthlyCommitted: { type: 'integer' }, dailyAvailable: { type: ['integer','null'] }, monthlyAvailable: { type: ['integer','null'] } } } as const;
export function isExpense(value: unknown): value is Expense {
  const v = value as Expense | null;
  return !!v && typeof v.id === 'string' && typeof v.requestId === 'string' && Number.isSafeInteger(v.amount) && v.amount > 0 && categories.includes(v.category)
    && typeof v.spentOn === 'string' && typeof v.note === 'string' && typeof v.createdAt === 'number' && typeof v.budgetApplicable === 'boolean' && typeof v.unapproved === 'boolean' && Number.isInteger(v.version) && (v.deletedAt === null || Number.isSafeInteger(v.deletedAt)) && Number.isSafeInteger(v.refunded) && (v.approvalId === null || typeof v.approvalId === 'string') && Number.isSafeInteger(v.unapprovedAmount);
}
export function isLedgerPage(value: unknown): value is LedgerPage {
  const v = value as LedgerPage | null;
  return !!v && Array.isArray(v.records) && v.records.every(isExpense) && Number.isInteger(v.total) && Number.isInteger(v.page) && Number.isInteger(v.pageSize);
}
export function isBalances(value: unknown): value is Balances {
  const v = value as Balances | null;
  return !!v && isBudgetSnapshot(v.budget) && Number.isSafeInteger(v.dailySpent) && Number.isSafeInteger(v.monthlySpent)
    && (v.dailyRemaining === null || Number.isSafeInteger(v.dailyRemaining)) && (v.monthlyRemaining === null || Number.isSafeInteger(v.monthlyRemaining)) && Number.isSafeInteger(v.dailyCommitted) && Number.isSafeInteger(v.monthlyCommitted) && (v.dailyAvailable === null || Number.isSafeInteger(v.dailyAvailable)) && (v.monthlyAvailable === null || Number.isSafeInteger(v.monthlyAvailable));
}

export interface ExpenseChangeInput { requestId: string; version: number; reason: string }
export interface ExpenseEditInput extends ExpenseChangeInput { amount: number; category: Category; spentOn: string; note: string }
export interface RefundInput extends ExpenseChangeInput { amount: number; refundedOn: string }
export interface ExpenseChange { kind: 'update' | 'delete' | 'refund'; reason: string; before: Expense; after: Expense; refundAmount: number; refundedOn: string | null; createdAt: number }
export interface ExpenseDetail { expense: Expense; changes: ExpenseChange[] }
export const changeProperties = { requestId: expenseBodySchema.properties.requestId, version: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 300 } } as const;
export const expenseChangeSchema = { type: 'object', additionalProperties: false, required: ['requestId', 'version', 'reason'], properties: changeProperties } as const;
export const expenseEditSchema = { type: 'object', additionalProperties: false, required: [...expenseChangeSchema.required, 'amount', 'category', 'spentOn', 'note'], properties: { ...changeProperties, amount: amountSchema, category: { enum: categories }, spentOn: dateSchema, note: expenseBodySchema.properties.note } } as const;
export const refundBodySchema = { type: 'object', additionalProperties: false, required: [...expenseChangeSchema.required, 'amount', 'refundedOn'], properties: { ...changeProperties, amount: amountSchema, refundedOn: dateSchema } } as const;
export function isExpenseDetail(value: unknown): value is ExpenseDetail {
  const v = value as ExpenseDetail | null;
  return !!v && isExpense(v.expense) && Array.isArray(v.changes) && v.changes.every(c => !!c && typeof c === 'object' && ['update','delete','refund'].includes(c.kind) && typeof c.reason === 'string' && isExpense(c.before) && isExpense(c.after) && Number.isSafeInteger(c.refundAmount) && (c.refundedOn === null || typeof c.refundedOn === 'string') && Number.isSafeInteger(c.createdAt));
}
export const expenseDetailSchema = { type: 'object', required: ['expense','changes'], properties: { expense: expenseSchema, changes: { type: 'array', items: { type: 'object', required: ['kind','reason','before','after','refundAmount','refundedOn','createdAt'], properties: { kind: { enum: ['update','delete','refund'] }, reason: { type: 'string' }, before: expenseSchema, after: expenseSchema, refundAmount: { type: 'integer' }, refundedOn: { type: ['string','null'] }, createdAt: { type: 'integer' } } } } } } as const;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'consumed' | 'cancelled';
export interface ApprovalInput { requestId: string; amount: number; category: Category; spentOn: string; purpose: string; reason: string }
export interface Approval extends ApprovalInput { id: string; status: ApprovalStatus; opinion: string; dailyOver: number; monthlyOver: number; createdAt: number; approvedAt: number | null; expiredFrom: string | null; kind: 'purchase' | 'supplement'; expenseId: string | null; expenseVersion: number | null }
export interface ApprovalAction { requestId: string; action: 'approve' | 'reject' | 'withdraw'; opinion: string }
export interface ApprovalEvent { action: string; opinion: string; actorId: string | null; createdAt: number }
export interface ApprovalPage { records: Approval[]; total: number; page: number; pageSize: number }
export interface ApprovalDetail extends ApprovalPreview { approval: Approval; expense: Expense | null; history: ApprovalEvent[]; balances: Balances }
export interface ApprovalPreview { dailyOver: number; monthlyOver: number; balances: Balances }
export interface Message { id: string; approvalId: string; title: string; createdAt: number }
export interface MessagePage { records: Message[]; total: number; page: number; pageSize: number }
export const approvalBodySchema = { type: 'object', additionalProperties: false, required: ['requestId','amount','category','spentOn','purpose','reason'], properties: { requestId: expenseBodySchema.properties.requestId, amount: amountSchema, category: { enum: categories }, spentOn: dateSchema, purpose: { type: 'string', minLength: 1, maxLength: 100 }, reason: { type: 'string', minLength: 1, maxLength: 300 } } } as const;
export const approvalActionSchema = { type: 'object', additionalProperties: false, required: ['requestId','action','opinion'], properties: { requestId: expenseBodySchema.properties.requestId, action: { enum: ['approve','reject','withdraw'] }, opinion: { type: 'string', maxLength: 300 } } } as const;
export const approvalSchema = { type: 'object', additionalProperties: false, required: [...approvalBodySchema.required,'id','status','opinion','dailyOver','monthlyOver','createdAt','approvedAt','expiredFrom','kind','expenseId','expenseVersion'], properties: { ...approvalBodySchema.properties, id: { type: 'string' }, status: { enum: ['pending','approved','rejected','withdrawn','expired','consumed','cancelled'] }, opinion: { type: 'string' }, dailyOver: { type: 'integer' }, monthlyOver: { type: 'integer' }, createdAt: { type: 'integer' }, approvedAt: { type: ['integer','null'] }, expiredFrom: { type: ['string','null'] }, kind: { enum: ['purchase','supplement'] }, expenseId: { type: ['string','null'] }, expenseVersion: { type: ['integer','null'] } } } as const;
export const approvalPageSchema = { type: 'object', required: ['records','total','page','pageSize'], properties: { records: { type: 'array', items: approvalSchema }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } } as const;
export const approvalPreviewSchema = { type: 'object', required: ['dailyOver','monthlyOver','balances'], properties: { dailyOver: { type: 'integer' }, monthlyOver: { type: 'integer' }, balances: balancesSchema } } as const;
export const approvalDetailSchema = { type: 'object', required: ['approval','expense','history','balances','dailyOver','monthlyOver'], properties: { approval: approvalSchema, expense: { anyOf: [expenseSchema, { type: 'null' }] }, dailyOver: { type: 'integer' }, monthlyOver: { type: 'integer' }, balances: balancesSchema, history: { type: 'array', items: { type: 'object', required: ['action','opinion','actorId','createdAt'], properties: { action: { type: 'string' }, opinion: { type: 'string' }, actorId: { type: ['string','null'] }, createdAt: { type: 'integer' } } } } } } as const;
export const messagePageSchema = { type: 'object', required: ['records','total','page','pageSize'], properties: { records: { type: 'array', items: { type: 'object', required: ['id','approvalId','title','createdAt'], properties: { id: { type: 'string' }, approvalId: { type: 'string' }, title: { type: 'string' }, createdAt: { type: 'integer' } } } }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } } as const;
export function isApproval(value: unknown): value is Approval {
  const v = value as Approval | null;
  return !!v && typeof v.id === 'string' && typeof v.requestId === 'string' && Number.isSafeInteger(v.amount) && v.amount > 0 && categories.includes(v.category) && typeof v.spentOn === 'string' && typeof v.purpose === 'string' && typeof v.reason === 'string' && ['pending','approved','rejected','withdrawn','expired','consumed','cancelled'].includes(v.status) && typeof v.opinion === 'string' && Number.isSafeInteger(v.dailyOver) && Number.isSafeInteger(v.monthlyOver) && Number.isSafeInteger(v.createdAt) && (v.approvedAt === null || Number.isSafeInteger(v.approvedAt)) && (v.expiredFrom === null || typeof v.expiredFrom === 'string') && (v.kind === 'purchase' || v.kind === 'supplement') && (v.expenseId === null || typeof v.expenseId === 'string') && (v.expenseVersion === null || Number.isInteger(v.expenseVersion));
}
export function isApprovalPage(value: unknown): value is ApprovalPage {
  const v = value as ApprovalPage | null;
  return !!v && Array.isArray(v.records) && v.records.every(isApproval) && Number.isInteger(v.total) && Number.isInteger(v.page) && Number.isInteger(v.pageSize);
}
export function isApprovalPreview(value: unknown): value is ApprovalPreview {
  const v = value as ApprovalPreview | null;
  return !!v && Number.isSafeInteger(v.dailyOver) && Number.isSafeInteger(v.monthlyOver) && isBalances(v.balances);
}
export function isApprovalDetail(value: unknown): value is ApprovalDetail {
  const v = value as ApprovalDetail | null;
  return !!v && isApproval(v.approval) && (v.expense === null || isExpense(v.expense)) && isApprovalPreview(v) && Array.isArray(v.history) && v.history.every(e => !!e && typeof e === 'object' && typeof e.action === 'string' && typeof e.opinion === 'string' && (e.actorId === null || typeof e.actorId === 'string') && Number.isSafeInteger(e.createdAt));
}
export function isMessagePage(value: unknown): value is MessagePage {
  const v = value as MessagePage | null;
  return !!v && Array.isArray(v.records) && v.records.every(m => !!m && typeof m === 'object' && typeof m.id === 'string' && typeof m.approvalId === 'string' && typeof m.title === 'string' && Number.isSafeInteger(m.createdAt)) && Number.isInteger(v.total) && Number.isInteger(v.page) && Number.isInteger(v.pageSize);
}

export interface ConfirmInput { requestId: string; amount: number; spentOn: string; note: string }
export interface CancelInput { requestId: string; reason: string }
export const confirmBodySchema = { type: 'object', additionalProperties: false, required: ['requestId','amount','spentOn','note'], properties: { requestId: expenseBodySchema.properties.requestId, amount: amountSchema, spentOn: dateSchema, note: expenseBodySchema.properties.note } } as const;
export const cancelBodySchema = { type: 'object', additionalProperties: false, required: ['requestId','reason'], properties: { requestId: expenseBodySchema.properties.requestId, reason: changeProperties.reason } } as const;
