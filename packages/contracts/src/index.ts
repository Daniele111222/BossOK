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
