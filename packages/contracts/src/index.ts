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
