import type { Database } from '../../infrastructure/database/index.js';
import { defaultDailyCategories, type BudgetSnapshot, type BudgetVersion } from '@bossok/contracts';
import { HttpError } from '../../http/errors.js';
export function businessDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);
}
export function validDate(value: unknown, today: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > today || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'INVALID_DATE', '日期须为 2000 年起至今的有效日期');
  return value;
}
export function createBudgets(db: Database, now: () => number) {
  async function history(relationshipId: string): Promise<BudgetVersion[]> {
    return (await db.all('SELECT id,kind,amount,categories,effective_date AS "effectiveDate",reason,created_at AS "createdAt" FROM budget_versions WHERE relationship_id=$1 ORDER BY effective_date,id', relationshipId) as (Omit<BudgetVersion, 'categories'> & { categories: string })[])
      .map(row => ({ ...row, categories: JSON.parse(row.categories) }));
  }
  async function snapshot(relationshipId: string, date: string): Promise<BudgetSnapshot> {
    const versions = await history(relationshipId);
    const daily = versions.filter(v => v.kind === 'daily' && v.effectiveDate <= date).at(-1) ?? null;
    const monthly = versions.filter(v => v.kind === 'monthly' && v.effectiveDate.slice(0, 7) <= date.slice(0, 7)).at(-1) ?? null;
    const startDate = versions.find(v => v.kind === 'daily')?.effectiveDate ?? null;
    return { date, startDate, daily, monthly: startDate && date >= startDate ? monthly : null, history: versions };
  }
  function save(relationshipId: string, userId: string, body: { daily?: number; monthly?: number; dailyCategories?: readonly string[]; reason: string }) {
    return db.transaction(async () => {
      const today = businessDate(now()), current = await snapshot(relationshipId, today);
      if (!body.reason.trim()) throw new HttpError(400, 'INVALID_REQUEST', '请填写设置或修改原因');
      if (!current.startDate && (!body.daily || !body.monthly)) throw new HttpError(400, 'INVALID_REQUEST', '首次请同时设置日额度和月预算');
      const insert = 'INSERT INTO budget_versions(relationship_id,kind,amount,categories,effective_date,reason,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)';
      if (body.daily !== undefined || body.dailyCategories !== undefined) {
        const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const effective = current.startDate ? tomorrow.toISOString().slice(0, 10) : today;
        const scheduled = (await snapshot(relationshipId, effective)).daily;
        await db.run(insert, relationshipId, 'daily', body.daily ?? scheduled!.amount, JSON.stringify(body.dailyCategories ?? scheduled?.categories ?? defaultDailyCategories), effective, body.reason, userId, now());
      }
      if (body.monthly !== undefined) await db.run(insert, relationshipId, 'monthly', body.monthly, '[]', today, body.reason, userId, now());
      return snapshot(relationshipId, today);
    });
  }
  return { snapshot, save };
}
