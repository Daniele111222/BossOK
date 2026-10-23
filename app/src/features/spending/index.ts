import { isBudgetSnapshot, isBalances, isExpense, isLedgerPage, type ExpenseInput, type Category, type BudgetInput } from '@bossok/contracts';
import { checked } from '../identity/index.js';
import type { HttpRequest } from '../../shared/http/index.js';
export function createSpendingClient(request: HttpRequest) {
  return {
    async balances(token: string) { return checked(await request('/balances', { token }), isBalances); },
    async createExpense(token: string, body: ExpenseInput) { return checked(await request('/expenses', { method: 'POST', token, body }), isExpense); },
    async ledger(token: string, month: string, category?: Category, page = 1) { return checked(await request(`/expenses?month=${encodeURIComponent(month)}&page=${page}${category ? `&category=${encodeURIComponent(category)}` : ''}`, { token }), isLedgerPage); },
    async budget(token: string, date?: string) { return checked(await request(`/budget${date ? `?date=${encodeURIComponent(date)}` : ''}`, { token }), isBudgetSnapshot); },
    async saveBudget(token: string, body: BudgetInput) { return checked(await request('/budget', { method: 'POST', token, body }), isBudgetSnapshot); }
  };
}
