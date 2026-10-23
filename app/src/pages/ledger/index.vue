<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { categories, yuanToCents, type Category, type ExpenseInput, type Identity, type ExpenseDetail, type ExpenseChangeInput, type ExpenseEditInput, type RefundInput, type LedgerPage } from '@bossok/contracts';
import { currentUser, sessionToken, spending } from '../../application';
import { RequestError } from '../../shared/http';
const user = ref<Identity | null>(null), list = ref<LedgerPage | null>(null), busy = ref(false), message = ref('');
const month = ref(''), filter = ref<Category | undefined>(), amount = ref(''), category = ref<Category>('餐饮'), spentOn = ref(''), note = ref('');
const detail = ref<ExpenseDetail | null>(null), editAmount = ref(''), editCategory = ref<Category>('餐饮'), editDate = ref(''), editNote = ref(''), reason = ref(''), refundAmount = ref(''), refundDate = ref('');
type Mutation = { id: string; kind: 'update' | 'delete' | 'refunds' | 'supplements'; body: ExpenseChangeInput | ExpenseEditInput | RefundInput };
const mutation = ref<Mutation | null>(null);
function mutationKey() { return `expense-mutation-${user.value!.id}`; }
async function showDetail(id: string) {
  detail.value = await spending.expense(sessionToken(), id);
  const e = detail.value.expense;
  editAmount.value = (e.amount/100).toFixed(2); editCategory.value = e.category; editDate.value = e.spentOn; editNote.value = e.note;
  reason.value = ''; refundAmount.value = '';
}
async function retryMutation() {
  if (!mutation.value) return;
  const id = mutation.value.id;
  let approvalId: string | null = null;
  try {
    if (mutation.value.kind === 'supplements') approvalId = (await spending.supplementExpense(sessionToken(),id,mutation.value.body)).id;
    else await spending.changeExpense(sessionToken(), id, mutation.value.kind, mutation.value.body);
  }
  catch(e) {
    if (e instanceof RequestError && e.statusCode >= 400 && e.statusCode < 500 && ![401,403].includes(e.statusCode)) { uni.removeStorageSync(mutationKey()); mutation.value = null; }
    throw e;
  }
  uni.removeStorageSync(mutationKey()); mutation.value = null;
  await showDetail(id); await load(); message.value = '操作成功';
  if (approvalId) openApproval(approvalId);
}
async function change(kind: Mutation['kind']) {
  if (!detail.value || mutation.value) return;
  if (!reason.value.trim()) throw new Error('请填写变更原因');
  const base = { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, version: detail.value.expense.version, reason: reason.value };
  const body = kind === 'update' ? { ...base, amount: yuanToCents(editAmount.value), category: editCategory.value, spentOn: editDate.value, note: editNote.value }
    : kind === 'refunds' ? { ...base, amount: yuanToCents(refundAmount.value), refundedOn: refundDate.value } : base;
  mutation.value = { id: detail.value.expense.id, kind, body }; uni.setStorageSync(mutationKey(), mutation.value);
  await retryMutation();
}
function openApproval(id: string) { uni.setStorageSync('open-approval',id); uni.switchTab({url:'/pages/approval/index'}); }
const pending = ref<ExpenseInput | null>(null);
function draftKey() { return `expense-pending-${user.value!.id}`; }
async function load(page = 1) { list.value = await spending.ledger(sessionToken(), month.value, filter.value, page); }
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; message.value = '';
  try { await action(); } catch(e) { message.value = e instanceof Error ? e.message : '操作失败'; }
  finally { busy.value = false; }
}
async function refresh() {
  const previousId = user.value?.id;
  user.value = null; list.value = null; detail.value = null; mutation.value = null;
  user.value = await currentUser();
  if (previousId && previousId !== user.value.id) { amount.value = ''; note.value = ''; spentOn.value = ''; month.value = ''; category.value = '餐饮'; }
  mutation.value = uni.getStorageSync(mutationKey()) || null;
  const saved = uni.getStorageSync(draftKey()) as ExpenseInput | undefined;
  pending.value = saved || null;
  if (saved) { pending.value = saved; amount.value = (saved.amount/100).toFixed(2); category.value = saved.category; spentOn.value = saved.spentOn; note.value = saved.note; }
  const balance = await spending.balances(sessionToken());
  refundDate.value = balance.budget.date;
  if (!month.value) month.value = balance.budget.date.slice(0,7);
  if (!spentOn.value) spentOn.value = balance.budget.date;
  await load();
  const openId = uni.getStorageSync('open-expense');
  if (openId) { uni.removeStorageSync('open-expense'); await showDetail(String(openId)); }
}
async function submit() {
  if (!pending.value) {
    pending.value = { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, amount: yuanToCents(amount.value), category: category.value, spentOn: spentOn.value, note: note.value };
    uni.setStorageSync(draftKey(), pending.value);
  }
  try { await spending.createExpense(sessionToken(), pending.value); }
  catch(e) {
    if (e instanceof RequestError && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 409 && e.statusCode !== 401 && e.statusCode !== 403) { pending.value = null; uni.removeStorageSync(draftKey()); }
    throw e;
  }
  const date = pending.value.spentOn;
  pending.value = null; uni.removeStorageSync(draftKey()); amount.value = ''; note.value = ''; month.value = date.slice(0,7); filter.value = undefined;
  message.value = '记账成功'; await load();
}
onShow(() => { void run(refresh); });
</script>
<template>
  <view class="page">
    <text class="title">账本</text>
    <text class="description" role="alert">{{ message }}</text>
    <template v-if="user?.relationshipId">
      <view v-if="user.role === 'applicant'" class="card">
        <text class="description">记一笔真实支出（元）；上海日期。超支也可如实录入。</text>
        <input v-model="amount" aria-label="金额" type="digit" placeholder="金额（元）" :disabled="busy || !!pending" />
        <picker :range="categories" :disabled="busy || !!pending" @change="category = categories[Number($event.detail.value)]"><view>分类：{{ category }}</view></picker>
        <picker mode="date" :value="spentOn" :disabled="busy || !!pending" @change="spentOn = String($event.detail.value)"><view>消费日期：{{ spentOn }}</view></picker>
        <input v-model="note" aria-label="备注" placeholder="备注（可选）" maxlength="500" :disabled="busy || !!pending" />
        <text v-if="pending" class="description">提交结果待确认，保留原内容与标识。请重试确认，避免重复记账。</text>
        <button :disabled="busy" @click="run(submit)">{{ pending ? '重试确认同一笔' : '保存支出' }}</button>
      </view>
      <view v-if="mutation" class="card"><text class="description">变更结果待确认，重试同一操作。</text><button :disabled="busy" @click="run(retryMutation)">重试账目变更</button></view>
      <view v-if="detail" class="card">
        <text class="description">账目详情 · 版本 {{ detail.expense.version }} · 已退款 {{ (detail.expense.refunded/100).toFixed(2) }} 元</text>
        <text v-if="detail.expense.approvalId" class="description">关联批准；当前未批准差额 {{ (detail.expense.unapprovedAmount/100).toFixed(2) }} 元。改单跨日不转移批准，缩额后再次增加需重新判断。</text>
        <button v-if="detail.expense.approvalId" :disabled="busy" @click="openApproval(detail.expense.approvalId)">查看原审批与消费历史</button>
        <text v-if="detail.expense.deletedAt !== null" class="description">已删除（保留历史，不计支出）</text>
        <template v-if="user.role === 'applicant' && detail.expense.deletedAt === null">
          <input v-model="editAmount" aria-label="更正金额" placeholder="更正金额（元）" :disabled="busy || !!mutation" />
          <picker :range="categories" :disabled="busy || !!mutation" @change="editCategory = categories[Number($event.detail.value)]"><view>更正分类：{{ editCategory }}</view></picker>
          <picker mode="date" :value="editDate" :disabled="busy || !!mutation" @change="editDate = String($event.detail.value)"><view>更正消费日：{{ editDate }}</view></picker>
          <input v-model="editNote" aria-label="更正备注" placeholder="备注" maxlength="500" :disabled="busy || !!mutation" />
          <input v-model="reason" aria-label="变更原因" placeholder="更正/删除/退款原因（必填）" maxlength="300" :disabled="busy || !!mutation" />
          <button v-if="detail.expense.approvalId && detail.expense.unapprovedAmount > 0" :disabled="busy || !!mutation" @click="run(() => change('supplements'))">申请未批准差额补批（使用上述原因）</button>
          <button :disabled="busy || !!mutation" @click="run(() => change('update'))">保存更正</button>
          <button :disabled="busy || !!mutation || detail.expense.refunded > 0" @click="run(() => change('delete'))">删除误记账目</button>
          <input v-model="refundAmount" aria-label="退款金额" placeholder="退款金额（元）" :disabled="busy || !!mutation" />
          <picker mode="date" :value="refundDate" :disabled="busy || !!mutation" @change="refundDate = String($event.detail.value)"><view>实际退款日：{{ refundDate }}</view></picker>
          <button :disabled="busy || !!mutation" @click="run(() => change('refunds'))">记录关联退款</button>
        </template>
        <text v-if="!detail.changes.length" class="description">暂无变更</text>
        <view v-for="(c, i) in detail.changes" :key="i">
          <text class="description">{{ {update:'更正',delete:'删除',refund:'退款'}[c.kind] }} · {{ c.reason }} · {{ new Date(c.createdAt).toISOString() }}</text>
          <text class="description">原：{{ c.before.spentOn }} / {{ c.before.category }} / {{ (c.before.amount/100).toFixed(2) }} 元 / {{ c.before.note }} → 后：{{ c.after.spentOn }} / {{ c.after.category }} / {{ (c.after.amount/100).toFixed(2) }} 元 / {{ c.after.note }}</text>
          <text v-if="c.kind === 'refund'" class="description">退款 {{ (c.refundAmount/100).toFixed(2) }} 元 · 实际退款日 {{ c.refundedOn }}（冲回原消费日）</text>
        </view>
      </view>
      <picker :disabled="busy" mode="date" fields="month" :value="month + '-01'" @change="month = String($event.detail.value).slice(0,7); run(() => load())"><view>月份：{{ month }}</view></picker>
      <picker :disabled="busy" :range="['全部分类', ...categories]" @change="filter = Number($event.detail.value) ? categories[Number($event.detail.value)-1] : undefined; run(() => load())"><view>分类筛选：{{ filter || '全部分类' }}</view></picker>
      <template v-if="list">
        <text v-if="!list.total" class="description">该月份/分类暂无账目</text>
        <view v-for="record in list.records" :key="record.id" class="card">
          <text class="description">{{ record.spentOn }} · {{ record.category }} · {{ (record.amount/100).toFixed(2) }} 元</text>
          <text class="description">{{ record.note }}</text>
          <text v-if="!record.budgetApplicable" class="description">预算生效前，不参与预算</text>
          <text v-if="record.deletedAt !== null" class="description">已删除，不计支出</text>
          <text class="description">已退款 {{ (record.refunded/100).toFixed(2) }} 元 · 净支出 {{ ((record.deletedAt !== null ? 0 : record.amount-record.refunded)/100).toFixed(2) }} 元</text>
          <button :disabled="busy || !!mutation" @click="run(() => showDetail(record.id))">详情 / 更正 / 退款</button>
          <text v-if="record.unapproved" class="description">{{ record.approvalId ? `未批准差额 ${(record.unapprovedAmount/100).toFixed(2)} 元` : '未审批超支（录入时标记）' }}</text>
        </view>
        <text class="description">共 {{ list.total }} 笔 · 第 {{ list.page }} 页</text>
        <button :disabled="busy || list.page <= 1" @click="run(() => load(list!.page-1))">上一页</button>
        <button :disabled="busy || list.page * list.pageSize >= list.total" @click="run(() => load(list!.page+1))">下一页</button>
      </template>
    </template>
    <button :disabled="busy" @click="run(refresh)">刷新</button>
  </view>
</template>
