import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Expense, ExpenseInput, ExpenseChangeInput, ExpenseEditInput, RefundInput, ExpenseChange, Balances, Category } from '@bossok/contracts';
import { HttpError } from '../../http/errors.js';
import { createBudgets, businessDate } from './budget.js';
const select = 'SELECT id,request_id AS requestId,amount,category,spent_on AS spentOn,note,created_at AS createdAt,budget_applicable AS budgetApplicable,unapproved,version,deleted_at AS deletedAt,COALESCE((SELECT sum(refund_amount) FROM expense_changes WHERE expense_id=expenses.id),0) AS refunded FROM expenses';
function dto(row: Expense, startDate: string | null): Expense {
  // 首次预算当日生效，也覆盖设置前录入的同日消费。
  return { ...row, budgetApplicable: !!startDate && row.spentOn >= startDate, unapproved: !!row.unapproved };
}
export function createLedger(db: Database.Database, budgets: ReturnType<typeof createBudgets>, now: () => number) {
  function balances(relationshipId: string, date: string): Balances {
    const budget = budgets.snapshot(relationshipId, date);
    const rows = db.prepare('SELECT amount-COALESCE((SELECT sum(refund_amount) FROM expense_changes WHERE expense_id=expenses.id),0) AS amount,category,spent_on FROM expenses WHERE deleted_at IS NULL AND relationship_id=? AND substr(spent_on,1,7)=? AND spent_on>=?').all(relationshipId, date.slice(0,7), budget.startDate ?? '9999-12-31') as { amount: number; category: string; spent_on: string }[];
    const dailySpent = rows.filter(r => r.spent_on === date && budget.daily?.categories.includes(r.category as Category)).reduce((sum,r) => sum+r.amount, 0);
    const monthlySpent = rows.reduce((sum,r) => sum+r.amount, 0);
    const commitments = date === businessDate(now()) ? db.prepare("SELECT amount,category FROM approvals WHERE relationship_id=? AND spent_on=? AND status='approved'").all(relationshipId,date) as { amount: number; category: Category }[] : [];
    const dailyCommitted = commitments.filter(r => budget.daily?.categories.includes(r.category)).reduce((sum,r) => sum+r.amount,0);
    const monthlyCommitted = commitments.reduce((sum,r) => sum+r.amount,0);
    return { budget, dailySpent, monthlySpent, dailyCommitted, monthlyCommitted, dailyAvailable: budget.daily ? budget.daily.amount-dailySpent-dailyCommitted : null, monthlyAvailable: budget.monthly ? budget.monthly.amount-monthlySpent-monthlyCommitted : null, dailyRemaining: budget.daily ? budget.daily.amount-dailySpent : null, monthlyRemaining: budget.monthly ? budget.monthly.amount-monthlySpent : null };
  }
  function create(relationshipId: string, userId: string, body: ExpenseInput) {
    return db.transaction(() => {
      const existing = db.prepare(`${select} WHERE user_id=? AND request_id=?`).get(userId, body.requestId) as Expense | undefined;
      if (existing) {
        if ((db.prepare('SELECT original_input FROM expenses WHERE id=?').get(existing.id) as {original_input: string}).original_input !== JSON.stringify({ requestId: body.requestId, amount: body.amount, category: body.category, spentOn: body.spentOn, note: body.note })) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '该请求标识已用于另一笔内容');
        return dto(existing, budgets.snapshot(relationshipId, body.spentOn).startDate);
      }
      const balance = balances(relationshipId, body.spentOn);
      const applicable = !!balance.budget.daily && !!balance.budget.monthly;
      const countsDaily = balance.budget.daily?.categories.includes(body.category);
      const unapproved = applicable && ((countsDaily && balance.dailySpent + balance.dailyCommitted + body.amount > balance.budget.daily!.amount) || balance.monthlySpent + balance.monthlyCommitted + body.amount > balance.budget.monthly!.amount);
      const id = randomUUID();
      db.prepare('INSERT INTO expenses(id,relationship_id,user_id,request_id,amount,category,spent_on,note,created_at,budget_applicable,unapproved,original_input) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, relationshipId, userId, body.requestId, body.amount, body.category, body.spentOn, body.note, now(), Number(applicable), Number(!!unapproved), JSON.stringify({ requestId: body.requestId, amount: body.amount, category: body.category, spentOn: body.spentOn, note: body.note }));
      return dto(db.prepare(`${select} WHERE id=?`).get(id) as Expense, balance.budget.startDate);
    })();
  }
  function list(relationshipId: string, month: string, category: string | undefined, page: number, pageSize: number) {
    const where = ' WHERE relationship_id=? AND substr(spent_on,1,7)=?' + (category ? ' AND category=?' : '');
    const args = category ? [relationshipId, month, category] : [relationshipId, month];
    const { total } = db.prepare(`SELECT count(*) AS total FROM expenses${where}`).get(...args) as { total: number };
    const startDate = budgets.snapshot(relationshipId, `${month}-01`).startDate;
    const records = (db.prepare(`${select}${where} ORDER BY spent_on DESC,created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page-1)*pageSize) as Expense[]).map(row => dto(row, startDate));
    return { records, total, page, pageSize };
  }
  function get(relationshipId: string, id: string) {
    const row = db.prepare(`${select} WHERE relationship_id=? AND id=?`).get(relationshipId, id) as Expense | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', '账目不存在');
    return dto(row, budgets.snapshot(relationshipId, row.spentOn).startDate);
  }
  function detail(relationshipId: string, id: string) {
    const expense = get(relationshipId, id);
    const changes = (db.prepare('SELECT kind,reason,before_json,after_json,refund_amount AS refundAmount,refunded_on AS refundedOn,created_at AS createdAt FROM expense_changes WHERE expense_id=? ORDER BY id').all(id) as (Omit<ExpenseChange, 'before' | 'after'> & { before_json: string; after_json: string })[])
      .map(({ before_json, after_json, ...row }) => ({ ...row, before: JSON.parse(before_json), after: JSON.parse(after_json) }));
    return { expense, changes };
  }
  function change(relationshipId: string, userId: string, id: string, kind: 'update' | 'delete' | 'refund', body: ExpenseChangeInput | ExpenseEditInput | RefundInput) {
    return db.transaction(() => {
      const before = get(relationshipId, id);
      const input = JSON.stringify(Object.entries(body).sort(([a],[b]) => a.localeCompare(b)));
      const existing = db.prepare('SELECT expense_id,kind,input,after_json FROM expense_changes WHERE user_id=? AND request_id=?').get(userId, body.requestId) as { expense_id: string; kind: string; input: string; after_json: string } | undefined;
      if (existing) {
        if (existing.expense_id !== id || existing.kind !== kind || existing.input !== input) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他操作');
        return JSON.parse(existing.after_json) as Expense;
      }
      if (before.deletedAt !== null || before.version !== body.version) throw new HttpError(409, 'VERSION_CONFLICT', '账目已变更，请刷新后重新操作');
      if (!body.reason.trim()) throw new HttpError(400, 'INVALID_REQUEST', '请填写变更原因');
      let refundAmount = 0, refundedOn: string | null = null;
      if (kind === 'update') {
        const edit = body as ExpenseEditInput;
        const firstRefund = db.prepare('SELECT min(refunded_on) AS date FROM expense_changes WHERE expense_id=? AND refund_amount>0').get(id) as { date: string | null };
        if (firstRefund.date && edit.spentOn > firstRefund.date) throw new HttpError(400, 'INVALID_DATE', '消费日期不能晚于已有退款日');
        if (edit.amount < before.refunded) throw new HttpError(409, 'REFUND_CONFLICT', '金额不能小于累计退款');
        const balance = balances(relationshipId, edit.spentOn), budget = balance.budget;
        const oldNet = before.spentOn.slice(0,7) === edit.spentOn.slice(0,7) && before.budgetApplicable ? before.amount-before.refunded : 0;
        const oldDaily = before.spentOn === edit.spentOn && budget.daily?.categories.includes(before.category) ? oldNet : 0;
        const net = edit.amount-before.refunded;
        const unapproved = before.unapproved || (!!budget.daily && !!budget.monthly && ((budget.daily.categories.includes(edit.category) && balance.dailySpent+balance.dailyCommitted-oldDaily+net > budget.daily.amount) || balance.monthlySpent+balance.monthlyCommitted-oldNet+net > budget.monthly.amount));
        db.prepare('UPDATE expenses SET amount=?,category=?,spent_on=?,note=?,unapproved=?,version=version+1 WHERE id=?').run(edit.amount, edit.category, edit.spentOn, edit.note, Number(unapproved), id);
      } else if (kind === 'delete') {
        if (before.refunded) throw new HttpError(409, 'REFUND_CONFLICT', '有退款的账目不能删除');
        db.prepare('UPDATE expenses SET deleted_at=?,version=version+1 WHERE id=?').run(now(), id);
      } else {
        const refund = body as RefundInput;
        if (refund.refundedOn < before.spentOn) throw new HttpError(400, 'INVALID_DATE', '退款不能早于消费日期');
        if (before.refunded + refund.amount > before.amount) throw new HttpError(409, 'REFUND_CONFLICT', '累计退款不能超过原金额');
        refundAmount = refund.amount; refundedOn = refund.refundedOn;
        db.prepare('UPDATE expenses SET version=version+1 WHERE id=?').run(id);
      }
      const after = get(relationshipId, id); after.refunded += refundAmount;
      db.prepare('INSERT INTO expense_changes(expense_id,user_id,request_id,kind,input,reason,before_json,after_json,refund_amount,refunded_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,userId,body.requestId,kind,input,body.reason,JSON.stringify(before),JSON.stringify(after),refundAmount,refundedOn,now());
      return after;
    })();
  }
  return { create, list, balances, get, detail, change };
}
