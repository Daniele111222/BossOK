import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Approval, ApprovalInput, ApprovalAction, Role } from '@bossok/contracts';
import { HttpError } from '../../http/errors.js';
import { businessDate } from './budget.js';
import type { createLedger } from './ledger.js';

const select = 'SELECT id,request_id AS requestId,amount,category,spent_on AS spentOn,purpose,reason,status,opinion,daily_over AS dailyOver,monthly_over AS monthlyOver,created_at AS createdAt,approved_at AS approvedAt,expired_from AS expiredFrom FROM approvals';
const canonical = (body: object) => JSON.stringify(Object.entries(body).sort(([a],[b]) => a.localeCompare(b)));
export function createApprovals(db: Database.Database, ledger: ReturnType<typeof createLedger>, notify: (relationshipId: string, role: Role, id: string, title: string) => void, now: () => number) {
  function expire(relationshipId: string) {
    db.transaction(() => {
      const rows = db.prepare(`${select} WHERE relationship_id=? AND spent_on<? AND status IN ('pending','approved')`).all(relationshipId,businessDate(now())) as Approval[];
      for (const row of rows) {
        db.prepare("UPDATE approvals SET expired_from=status,status='expired' WHERE id=?").run(row.id);
        db.prepare("INSERT INTO approval_events(approval_id,action,opinion,created_at) VALUES(?,'expire','当日结束自动过期',?)").run(row.id,now());
        notify(relationshipId,'applicant',row.id,'申请已过期，请进入应用查看');
      }
    })();
  }
  function get(relationshipId: string, id: string): Approval {
    const row = db.prepare(`${select} WHERE relationship_id=? AND id=?`).get(relationshipId,id) as Approval | undefined;
    if (!row) throw new HttpError(404,'NOT_FOUND','申请不存在');
    return row;
  }
  function preview(relationshipId: string, body: ApprovalInput) {
    if (body.spentOn !== businessDate(now())) throw new HttpError(400,'INVALID_DATE','仅可申请上海当天消费');
    const balances = ledger.balances(relationshipId,body.spentOn);
    if (!balances.budget.daily || !balances.budget.monthly) throw new HttpError(409,'NO_BUDGET','请先约定预算');
    return { balances, dailyOver: balances.budget.daily.categories.includes(body.category) ? Math.max(0,body.amount-balances.dailyAvailable!) : 0, monthlyOver: Math.max(0,body.amount-balances.monthlyAvailable!) };
  }
  function create(relationshipId: string, userId: string, body: ApprovalInput) {
    return db.transaction(() => {
      expire(relationshipId);
      const existing = db.prepare('SELECT id,input FROM approvals WHERE user_id=? AND request_id=?').get(userId,body.requestId) as { id: string; input: string } | undefined;
      if (existing) {
        if (existing.input !== canonical(body)) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','请求标识已用于不同申请');
        return get(relationshipId,existing.id);
      }
      if (!body.purpose.trim() || !body.reason.trim()) throw new HttpError(400,'INVALID_REQUEST','请填写用途和申请原因');
      const check = preview(relationshipId,body);
      if (!check.dailyOver && !check.monthlyOver) throw new HttpError(409,'WITHIN_BUDGET','预算内可直接记账，无需申请');
      const id = randomUUID();
      db.prepare("INSERT INTO approvals(id,relationship_id,user_id,request_id,input,amount,category,spent_on,purpose,reason,status,daily_over,monthly_over,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)").run(id,relationshipId,userId,body.requestId,canonical(body),body.amount,body.category,body.spentOn,body.purpose,body.reason,check.dailyOver,check.monthlyOver,now());
      db.prepare("INSERT INTO approval_events(approval_id,actor_id,action,opinion,created_at) VALUES(?,?,'submit',?,?)").run(id,userId,body.reason,now());
      notify(relationshipId,'approver',id,'有待审批申请，请进入应用查看');
      return get(relationshipId,id);
    })();
  }
  function act(relationshipId: string, userId: string, role: Role, id: string, body: ApprovalAction) {
    return db.transaction(() => {
      expire(relationshipId);
      const before = get(relationshipId,id);
      if ((body.action === 'withdraw' ? 'applicant' : 'approver') !== role) throw new HttpError(403,'FORBIDDEN','当前角色不能执行该操作');
      const previous = db.prepare('SELECT approval_id,input FROM approval_events WHERE actor_id=? AND request_id=?').get(userId,body.requestId) as { approval_id: string; input: string } | undefined;
      if (previous) {
        if (previous.approval_id !== id || previous.input !== canonical(body)) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','请求标识已用于其他操作');
        return before;
      }
      if (before.status !== 'pending') throw new HttpError(409,'STATE_CONFLICT','申请已处理或过期，请刷新');
      const status = { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[body.action];
      const changed = db.prepare("UPDATE approvals SET status=?,opinion=?,approved_at=? WHERE id=? AND status='pending'").run(status,body.opinion,status === 'approved' ? now() : null,id);
      if (!changed.changes) throw new HttpError(409,'STATE_CONFLICT','申请已被处理');
      db.prepare('INSERT INTO approval_events(approval_id,actor_id,request_id,input,action,opinion,created_at) VALUES(?,?,?,?,?,?,?)').run(id,userId,body.requestId,canonical(body),body.action,body.opinion,now());
      notify(relationshipId,role === 'approver' ? 'applicant' : 'approver',id,'申请状态已更新，请进入应用查看');
      return get(relationshipId,id);
    })();
  }
  function list(relationshipId: string, month: string, page: number) {
    expire(relationshipId);
    const where = ' WHERE relationship_id=? AND substr(spent_on,1,7)=?', pageSize = 20;
    const records = db.prepare(`${select}${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(relationshipId,month,pageSize,(page-1)*pageSize) as Approval[];
    const { total } = db.prepare(`SELECT count(*) AS total FROM approvals${where}`).get(relationshipId,month) as { total: number };
    return { records, total, page, pageSize };
  }
  function detail(relationshipId: string, id: string) {
    expire(relationshipId);
    const approval = get(relationshipId,id);
    const history = db.prepare('SELECT action,opinion,actor_id AS actorId,created_at AS createdAt FROM approval_events WHERE approval_id=? ORDER BY id').all(id);
    const projection = approval.status === 'pending' ? preview(relationshipId,approval) : { balances: ledger.balances(relationshipId,businessDate(now())), dailyOver: approval.dailyOver, monthlyOver: approval.monthlyOver };
    return { approval, history, ...projection };
  }
  return { create, act, list, detail, preview };
}
