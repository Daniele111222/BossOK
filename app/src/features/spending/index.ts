import { isMonthlySummary } from '@bossok/contracts';
import { type ConfirmInput, type CancelInput } from '@bossok/contracts';
import { isApproval, isApprovalPage, isApprovalDetail, isApprovalPreview, type ApprovalInput, type ApprovalAction } from '@bossok/contracts';
import { isExpenseDetail, type ExpenseChangeInput, type ExpenseEditInput, type RefundInput } from '@bossok/contracts';
import { isBudgetSnapshot, isBalances, isExpense, isLedgerPage, type ExpenseInput, type Category, type BudgetInput } from '@bossok/contracts';
import { checked } from '../identity/index.js';
import type { HttpRequest } from '../../shared/http/index.js';
export function createSpendingClient(request: HttpRequest) {
  return {
    async summary(token: string, month: string) { return checked(await request(`/summary?month=${encodeURIComponent(month)}`,{token}),isMonthlySummary); },
    async confirmApproval(token: string, id: string, body: ConfirmInput) { return checked(await request(`/approvals/${encodeURIComponent(id)}/confirm`, { method: 'POST', token, body }), isApproval); },
    async cancelApproval(token: string, id: string, body: CancelInput) { return checked(await request(`/approvals/${encodeURIComponent(id)}/cancel`, { method: 'POST', token, body }), isApproval); },
    async supplementExpense(token: string, id: string, body: ExpenseChangeInput) { return checked(await request(`/expenses/${encodeURIComponent(id)}/supplements`, { method: 'POST', token, body }), isApproval); },
    async approvals(token: string, month: string, page = 1) { return checked(await request(`/approvals?month=${encodeURIComponent(month)}&page=${page}`, { token }), isApprovalPage); },
    async approval(token: string, id: string) { return checked(await request(`/approvals/${encodeURIComponent(id)}`, { token }), isApprovalDetail); },
    async previewApproval(token: string, body: ApprovalInput) { return checked(await request('/approvals/preview', { method: 'POST', token, body }), isApprovalPreview); },
    async createApproval(token: string, body: ApprovalInput) { return checked(await request('/approvals', { method: 'POST', token, body }), isApproval); },
    async actApproval(token: string, id: string, body: ApprovalAction) { return checked(await request(`/approvals/${encodeURIComponent(id)}/actions`, { method: 'POST', token, body }), isApproval); },
    async expense(token: string, id: string) { return checked(await request(`/expenses/${encodeURIComponent(id)}`, { token }), isExpenseDetail); },
    async changeExpense(token: string, id: string, kind: 'update' | 'delete' | 'refunds', body: ExpenseChangeInput | ExpenseEditInput | RefundInput) { return checked(await request(`/expenses/${encodeURIComponent(id)}/${kind}`, { method: 'POST', token, body }), isExpense); },
    async balances(token: string) { return checked(await request('/balances', { token }), isBalances); },
    async createExpense(token: string, body: ExpenseInput) { return checked(await request('/expenses', { method: 'POST', token, body }), isExpense); },
    async ledger(token: string, month: string, category?: Category, page = 1) { return checked(await request(`/expenses?month=${encodeURIComponent(month)}&page=${page}${category ? `&category=${encodeURIComponent(category)}` : ''}`, { token }), isLedgerPage); },
    async budget(token: string, date?: string) { return checked(await request(`/budget${date ? `?date=${encodeURIComponent(date)}` : ''}`, { token }), isBudgetSnapshot); },
    async saveBudget(token: string, body: BudgetInput) { return checked(await request('/budget', { method: 'POST', token, body }), isBudgetSnapshot); }
  };
}
