import { registerSpending } from './modules/spending/index.js';
import { createIdentity } from './modules/identity/index.js';
import Fastify from 'fastify';
import { openDatabase } from './infrastructure/database/index.js';
import { healthModule } from './modules/health/index.js';
import { registerErrorHandlers } from './http/errors.js';

export function buildApp(options: { databasePath: string; logger?: boolean; now?: () => number }) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false
  });
  const db = openDatabase(options.databasePath);

  try {
    app.addHook('onClose', async () => { db.close(); });
    registerErrorHandlers(app);
    const identity = createIdentity(db, options.now);
    app.register(async (instance) => identity.register(instance));
    app.register(async (instance) => registerSpending(instance, db, identity, options.now));
    app.register(healthModule, { db, prefix: '/api' });
    return app;
  } catch (error) {
    db.close();
    throw error;
  }
}
