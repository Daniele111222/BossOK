import { healthyResponse, healthResponseSchema } from '@bossok/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../../infrastructure/database/index.js';

export const healthModule: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/health', {
    schema: { response: { 200: healthResponseSchema } }
  }, async () => {
    await db.one('SELECT count(*) FROM schema_migrations');
    return healthyResponse;
  });
};
