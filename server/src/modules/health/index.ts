import { healthyResponse, healthResponseSchema } from '@bossok/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';

export const healthModule: FastifyPluginAsync<{ db: Database.Database }> = async (app, { db }) => {
  app.get('/health', {
    schema: { response: { 200: healthResponseSchema } }
  }, async () => {
    db.prepare('SELECT count(*) FROM schema_migrations').get();
    return healthyResponse;
  });
};
