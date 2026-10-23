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
