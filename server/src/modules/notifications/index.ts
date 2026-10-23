import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { messagePageSchema } from '@bossok/contracts';
import type { IdentityService } from '../identity/index.js';

export function createNotifications(db: Database.Database, now: () => number) {
  function write(recipientId: string, approvalId: string, title: string) {
    db.prepare('INSERT INTO messages(id,recipient_id,approval_id,title,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), recipientId, approvalId, title, now());
  }
  function register(app: FastifyInstance, identity: IdentityService) {
    app.get<{ Querystring: { page?: number } }>('/api/messages', { schema: { response: { 200: messagePageSchema }, querystring: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer', minimum: 1, maximum: 100000 } } } } }, async request => {
      const actor = identity.member(request), page = request.query.page ?? 1, pageSize = 20;
      const records = db.prepare('SELECT id,approval_id AS approvalId,title,created_at AS createdAt FROM messages WHERE recipient_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(actor.id, pageSize, (page-1)*pageSize);
      const { total } = db.prepare('SELECT count(*) AS total FROM messages WHERE recipient_id=?').get(actor.id) as { total: number };
      return { records, total, page, pageSize };
    });
  }
  return { write, register };
}
