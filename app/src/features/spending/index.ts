import { isBudgetSnapshot, type BudgetInput } from '@bossok/contracts';
import { checked } from '../identity/index';
import type { HttpRequest } from '../../shared/http';
export function createSpendingClient(request: HttpRequest) {
  return {
    async budget(token: string, date?: string) { return checked(await request(`/budget${date ? `?date=${encodeURIComponent(date)}` : ''}`, { token }), isBudgetSnapshot); },
    async saveBudget(token: string, body: BudgetInput) { return checked(await request('/budget', { method: 'POST', token, body }), isBudgetSnapshot); }
  };
}
