import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Expense, ExpenseInput, Balances, Category } from '@bossok/contracts';
import { HttpError } from '../../http/errors.js';
import { createBudgets } from './budget.js';
const select = 'SELECT id,request_id AS requestId,amount,category,spent_on AS spentOn,note,created_at AS createdAt,budget_applicable AS budgetApplicable,unapproved FROM expenses';
function dto(row: Expense, startDate: string | null): Expense {
  // 首次预算当日生效，也覆盖设置前录入的同日消费。
  return { ...row, budgetApplicable: !!startDate && row.spentOn >= startDate, unapproved: !!row.unapproved };
}
export function createLedger(db: Database.Database, budgets: ReturnType<typeof createBudgets>, now: () => number) {
  function balances(relationshipId: string, date: string): Balances {
    const budget = budgets.snapshot(relationshipId, date);
    const rows = db.prepare('SELECT amount,category,spent_on FROM expenses WHERE relationship_id=? AND substr(spent_on,1,7)=? AND spent_on>=?').all(relationshipId, date.slice(0,7), budget.startDate ?? '9999-12-31') as { amount: number; category: string; spent_on: string }[];
    const dailySpent = rows.filter(r => r.spent_on === date && budget.daily?.categories.includes(r.category as Category)).reduce((sum,r) => sum+r.amount, 0);
    const monthlySpent = rows.reduce((sum,r) => sum+r.amount, 0);
    return { budget, dailySpent, monthlySpent, dailyRemaining: budget.daily ? budget.daily.amount-dailySpent : null, monthlyRemaining: budget.monthly ? budget.monthly.amount-monthlySpent : null };
  }
  function create(relationshipId: string, userId: string, body: ExpenseInput) {
    return db.transaction(() => {
      const existing = db.prepare(`${select} WHERE user_id=? AND request_id=?`).get(userId, body.requestId) as Expense | undefined;
      if (existing) {
        if (existing.amount !== body.amount || existing.category !== body.category || existing.spentOn !== body.spentOn || existing.note !== body.note) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '该请求标识已用于另一笔内容');
        return dto(existing, budgets.snapshot(relationshipId, body.spentOn).startDate);
      }
      const balance = balances(relationshipId, body.spentOn);
      const applicable = !!balance.budget.daily && !!balance.budget.monthly;
      const countsDaily = balance.budget.daily?.categories.includes(body.category);
      const unapproved = applicable && ((countsDaily && balance.dailySpent + body.amount > balance.budget.daily!.amount) || balance.monthlySpent + body.amount > balance.budget.monthly!.amount);
      const id = randomUUID();
      db.prepare('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, relationshipId, userId, body.requestId, body.amount, body.category, body.spentOn, body.note, now(), Number(applicable), Number(!!unapproved));
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
  return { create, list, balances };
}
