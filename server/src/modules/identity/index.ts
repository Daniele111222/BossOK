import { loginBodySchema, bindBodySchema, identitySchema, loginResponseSchema, invitationSchema } from '@bossok/contracts';
import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from '../../infrastructure/database/index.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Identity, Role } from '@bossok/contracts';
import { HttpError } from '../../http/errors.js';

const scrypt = promisify(derive);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function input(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_REQUEST', '请求格式不正确');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || !value.trim()) throw new HttpError(400, 'INVALID_REQUEST', '输入内容不符合要求');
  return value;
}
async function passwordHash(password: string) {
  text(password, 128, 10);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64) as Buffer).toString('hex')}`;
}
export async function createAccount(db: Database, username: string, role: Role, password: string) {
  text(username, 64);
  if (role !== 'approver' && role !== 'applicant') throw new Error('角色无效');
  const hash = await passwordHash(password);
  await db.run('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', randomUUID(), username, hash, role);
}
export async function resetPassword(db: Database, username: string, password: string) {
  const hash = await passwordHash(password);
  await db.transaction(async () => {
    const user = await db.one('SELECT id FROM users WHERE username=$1', username) as { id: string } | undefined;
    if (!user) throw new Error('账户不存在');
    await db.run('UPDATE users SET password_hash=$1 WHERE id=$2', hash, user.id);
    await db.run('DELETE FROM sessions WHERE user_id=$1', user.id);
  });
}
export function createIdentity(db: Database, now = Date.now) {
  async function user(id: string): Promise<Identity> {
    const row = await db.one(`SELECT u.id,u.username,u.role,r.id AS "relationshipId" FROM users u
      LEFT JOIN relationships r ON r.approver_id=u.id OR r.applicant_id=u.id WHERE u.id=$1 AND u.role IS NOT NULL`, id) as Identity | undefined;
    if (!row) throw new HttpError(401, 'UNAUTHORIZED', '请重新登录');
    return row;
  }
  async function authenticate(request: FastifyRequest): Promise<Identity> {
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const session = token && await db.one('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>$2', digest(token), now()) as { user_id: string } | undefined;
    if (!session) throw new HttpError(401, 'UNAUTHORIZED', '请登录，或会话已过期');
    return user(session.user_id);
  }
  async function member(request: FastifyRequest, role?: Role) {
    const actor = await authenticate(request);
    if (role && actor.role !== role) throw new HttpError(403, 'FORBIDDEN', '当前角色无权执行此操作');
    if (!actor.relationshipId) throw new HttpError(403, 'NOT_BOUND', '请先在我的页面完成绑定');
    return actor as Identity & { relationshipId: string };
  }
  async function register(app: FastifyInstance) {
    app.post('/api/login', { schema: { body: loginBodySchema, response: { 200: loginResponseSchema } } }, async (request) => {
      const body = input(request.body);
      const username = text(body.username, 64), password = text(body.password, 128);
      const row = await db.one('SELECT id,password_hash FROM users WHERE username=$1 AND role IS NOT NULL', username) as { id: string; password_hash: string } | undefined;
      const [salt, hash] = row?.password_hash.split(':') ?? ['00000000000000000000000000000000', '00'.repeat(64)];
      const derived = await scrypt(password, salt, 64) as Buffer;
      if (!row || hash.length !== 128 || !timingSafeEqual(Buffer.from(hash, 'hex'), derived)) throw new HttpError(401, 'UNAUTHORIZED', '账号或密码错误');
      const token = randomBytes(32).toString('hex'), expiresAt = now() + 7 * 86400000;
      await db.run('INSERT INTO sessions VALUES($1,$2,$3)', digest(token), row.id, expiresAt);
      return { token, expiresAt, user: await user(row.id) };
    });
    app.get('/api/me', { schema: { response: { 200: identitySchema } } }, async (request) => authenticate(request));
    app.post('/api/logout', async (request) => {
      await authenticate(request);
      await db.run('DELETE FROM sessions WHERE token_hash=$1', digest(request.headers.authorization!.slice(7)));
      return { ok: true };
    });
    app.post('/api/invitations', { schema: { response: { 200: invitationSchema } } }, async (request) => {
      const actor = await authenticate(request);
      if (actor.role !== 'approver' || actor.relationshipId) throw new HttpError(403, 'FORBIDDEN', '仅未绑定审批人可邀请');
      const code = randomBytes(16).toString('hex'), expiresAt = now() + 86400000;
      await db.transaction(async () => {
        await db.run('DELETE FROM invitations WHERE approver_id=$1', actor.id);
        await db.run('INSERT INTO invitations(token_hash,approver_id,expires_at) VALUES($1,$2,$3)', digest(code), actor.id, expiresAt);
      });
      return { code, expiresAt };
    });
    app.post('/api/bind', { schema: { body: bindBodySchema, response: { 200: identitySchema } } }, async (request) => {
      const actor = await authenticate(request), body = input(request.body);
      const code = text(body.code, 64);
      if (body.acceptSharing !== true) throw new HttpError(400, 'INVALID_REQUEST', '请先确认共享说明');
      if (actor.role !== 'applicant' || actor.relationshipId) throw new HttpError(403, 'FORBIDDEN', '当前账户不能绑定');
      await db.transaction(async () => {
        const invite = await db.one('SELECT approver_id FROM invitations WHERE token_hash=$1 AND expires_at>$2 AND used=0', digest(code), now()) as { approver_id: string } | undefined;
        if (!invite || await db.one('SELECT 1 FROM relationships WHERE approver_id=$1 OR applicant_id=$2', invite.approver_id, actor.id)) throw new HttpError(409, 'INVALID_INVITATION', '邀请码无效、过期或已使用');
        await db.run('INSERT INTO relationships VALUES($1,$2,$3)', randomUUID(), invite.approver_id, actor.id);
        await db.run('UPDATE invitations SET used=1 WHERE token_hash=$1', digest(code));
      });
      return user(actor.id);
    });
  }
  async function recipient(relationshipId: string, role: Role): Promise<string> {
    const row = await db.one('SELECT approver_id,applicant_id FROM relationships WHERE id=$1', relationshipId) as { approver_id: string; applicant_id: string } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', '共享关系不存在');
    return role === 'approver' ? row.approver_id : row.applicant_id;
  }
  async function session(request: FastifyRequest) {
    const actor=await member(request),hash=digest(request.headers.authorization!.slice(7));
    const row=await db.one('SELECT expires_at FROM sessions WHERE token_hash=$1', hash) as {expires_at:number} | undefined;
    if (!row) throw new HttpError(401, 'UNAUTHORIZED', '请登录，或会话已过期');
    return {actor,hash,expiresAt:row.expires_at};
  }
  return { authenticate, member, register, recipient, session };
}
export type IdentityService = ReturnType<typeof createIdentity>;
