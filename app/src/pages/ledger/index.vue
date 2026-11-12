<script setup lang="ts">
import { ref, watch } from 'vue';
import CategoryIcon from '../../components/CategoryIcon.vue';
import ExpenseRow from '../../components/ExpenseRow.vue';
import { onShow, onHide, onBackPress } from '@dcloudio/uni-app';
import { categories, yuanToCents, type Category, type ExpenseInput, type Identity, type ExpenseDetail, type ExpenseChangeInput, type ExpenseEditInput, type RefundInput, type LedgerPage } from '@bossok/contracts';
import { currentUser, sessionToken, spending } from '../../application';
import { RequestError } from '../../shared/http';
const user = ref<Identity | null>(null), list = ref<LedgerPage | null>(null), busy = ref(false), message = ref('');
const month = ref(''), filter = ref<Category | undefined>(), amount = ref(''), category = ref<Category>('餐饮'), spentOn = ref(''), note = ref('');
const detail = ref<ExpenseDetail | null>(null), editAmount = ref(''), editCategory = ref<Category>('餐饮'), editDate = ref(''), editNote = ref(''), reason = ref(''), refundAmount = ref(''), refundDate = ref('');
type Mutation = { id: string; kind: 'update' | 'delete' | 'refunds' | 'supplements'; body: ExpenseChangeInput | ExpenseEditInput | RefundInput };
const mutation = ref<Mutation | null>(null), creating = ref(false);
function mutationKey() { return `expense-mutation-${user.value!.id}`; }
async function showDetail(id: string) {
  detail.value = await spending.expense(sessionToken(), id); creating.value = false;
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
  user.value = null; list.value = null; detail.value = null; mutation.value = null; creating.value = false;
  if (!sessionToken()) return;
  user.value = await currentUser();
  if (previousId && previousId !== user.value.id) { amount.value = ''; note.value = ''; spentOn.value = ''; month.value = ''; category.value = '餐饮'; }
  if (!user.value.relationshipId) return;
  mutation.value = uni.getStorageSync(mutationKey()) || null;
  creating.value = !!uni.getStorageSync('new-expense'); uni.removeStorageSync('new-expense');
  const saved = uni.getStorageSync(draftKey()) as ExpenseInput | undefined;
  pending.value = saved || null;
  if (saved) creating.value = true;
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
  message.value = '记账成功'; creating.value = false; await load();
}
onShow(() => { void run(refresh); });
function confirmDelete() {
  uni.showModal({ title: '删除这笔账目？', content: '删除后不再计入支出，仍保留变更历史。', confirmText: '确认删除', confirmColor: '#a93b32', success: result => { if (result.confirm) void run(() => change('delete')); } });
}
watch([creating, detail], () => { if (creating.value || detail.value) uni.hideTabBar(); else uni.showTabBar(); });
onHide(() => { uni.showTabBar(); });
onBackPress(() => { if (!creating.value && !detail.value) return false; creating.value = false; detail.value = null; return true; });
function profile() { uni.switchTab({url:'/pages/profile/index'}); }
</script>
<template>
  <view class="page">
    <view class="page-header">
      <button role="button" v-if="creating || detail" class="btn icon-button" aria-label="返回账本" @click="creating=false; detail=null"><image class="icon" src="/static/icons/back.svg" /></button>
      <view class="header-copy"><text class="title">{{ detail ? '账目详情' : creating ? '记一笔' : '账本' }}</text><text class="subtitle">{{ creating ? '记下真实花费，慢慢安排生活' : '每一笔，都心中有数' }}</text></view>
      <button role="button" v-if="!creating && !detail && user?.role === 'applicant' && user.relationshipId" class="btn icon-button" aria-label="记一笔" :disabled="busy || !!mutation" @click="creating=true"><image class="icon" src="/static/icons/plus.svg" /></button>
    </view>
    <text v-if="message" class="notice" role="alert">{{ message }}</text>
    <text v-if="busy && !user" class="description" role="status">正在加载账本…</text>
    <view v-if="!busy && !user?.relationshipId" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/book.svg" /></view><text class="empty-title">和伙伴一起，开始记录</text><text class="description">{{ user ? '你已登录，请先在“我的”完成伙伴绑定。' : '请先在“我的”登录并完成伙伴绑定。' }}</text><button role="button" class="btn" @click="profile">{{ user ? '去绑定伙伴' : '前往我的' }}</button></view>
    <template v-if="user?.relationshipId">
      <view v-if="user.role === 'applicant' && creating && !detail" class="card">
        <text class="description">记一笔真实支出（元）；上海日期。超支也可如实录入。</text>
        <text class="field-label">金额（元）<text class="required">*</text></text>
        <input class="input amount-input" v-model="amount" aria-label="金额" type="digit" placeholder="0.00" :disabled="busy || !!pending" />
        <text class="field-label">消费分类</text><view class="category-grid"><button role="button" v-for="c in categories" :key="c" class="btn category-option" :class="{selected: category === c}" :disabled="busy || !!pending" :aria-pressed="category === c" @click="category=c"><CategoryIcon :category="c" />{{ c }}</button></view>
        <text class="field-label">消费日期</text>
        <picker class="picker" mode="date" :value="spentOn" :disabled="busy || !!pending" @change="spentOn = String($event.detail.value)"><view>消费日期：{{ spentOn }}</view></picker>
        <text class="field-label">备注</text>
        <input class="input" v-model="note" aria-label="备注" placeholder="备注（可选）" maxlength="500" :disabled="busy || !!pending" />
        <text v-if="pending" class="description">提交结果待确认，保留原内容与标识。请重试确认，避免重复记账。</text>
        <button role="button" class="btn primary" :disabled="busy" @click="run(submit)">{{ pending ? '重试确认同一笔' : '保存支出' }}</button>
      </view>
      <view v-if="pending && !creating" class="notice notice-warm"><text>有一笔支出待确认，已保留原请求。</text><button role="button" class="btn" :disabled="busy" @click="creating=true">查看并重试</button></view>
      <view v-if="mutation" class="card"><text class="description">变更结果待确认，重试同一操作。</text><button role="button" class="btn" :disabled="busy" @click="run(retryMutation)">重试账目变更</button></view>
      <view v-if="detail" class="card">
        <view class="row between"><text class="section-title">{{ detail.expense.category }}</text><text class="tag">{{ detail.expense.spentOn }}</text></view><text class="amount">¥{{ (detail.expense.amount/100).toFixed(2) }}</text><text class="description">{{ detail.expense.note || '未填写备注' }}</text><view class="divider" />
        <text class="description">账目详情 · 版本 {{ detail.expense.version }} · 已退款 {{ (detail.expense.refunded/100).toFixed(2) }} 元</text>
        <text v-if="detail.expense.approvalId" class="description">关联批准；当前未批准差额 {{ (detail.expense.unapprovedAmount/100).toFixed(2) }} 元。改单跨日不转移批准，缩额后再次增加需重新判断。</text>
        <button role="button" class="btn" v-if="detail.expense.approvalId" :disabled="busy" @click="openApproval(detail.expense.approvalId)">查看原审批与消费历史</button>
        <text v-if="detail.expense.deletedAt !== null" class="description">已删除（保留历史，不计支出）</text>
        <template v-if="user.role === 'applicant' && detail.expense.deletedAt === null">
          <input class="input" v-model="editAmount" aria-label="更正金额" placeholder="更正金额（元）" :disabled="busy || !!mutation" type="digit" />
          <picker class="picker" :range="categories" :disabled="busy || !!mutation" @change="editCategory = categories[Number($event.detail.value)]"><view>更正分类：{{ editCategory }}</view></picker>
          <picker class="picker" mode="date" :value="editDate" :disabled="busy || !!mutation" @change="editDate = String($event.detail.value)"><view>更正消费日：{{ editDate }}</view></picker>
          <input class="input" v-model="editNote" aria-label="更正备注" placeholder="备注" maxlength="500" :disabled="busy || !!mutation" />
          <input class="input" v-model="reason" aria-label="变更原因" placeholder="更正/删除/退款原因（必填）" maxlength="300" :disabled="busy || !!mutation" />
          <button role="button" class="btn" v-if="detail.expense.approvalId && detail.expense.unapprovedAmount > 0" :disabled="busy || !!mutation" @click="run(() => change('supplements'))">申请未批准差额补批（使用上述原因）</button>
          <button role="button" class="btn primary" :disabled="busy || !!mutation" @click="run(() => change('update'))">保存更正</button>
          <button role="button" class="btn danger" :disabled="busy || !!mutation || detail.expense.refunded > 0" @click="confirmDelete">删除误记账目</button>
          <input class="input" v-model="refundAmount" aria-label="退款金额" placeholder="退款金额（元）" :disabled="busy || !!mutation" type="digit" />
          <picker class="picker" mode="date" :value="refundDate" :disabled="busy || !!mutation" @change="refundDate = String($event.detail.value)"><view>实际退款日：{{ refundDate }}</view></picker>
          <button role="button" class="btn" :disabled="busy || !!mutation" @click="run(() => change('refunds'))">记录关联退款</button>
        </template>
        <text v-if="!detail.changes.length" class="description">暂无变更</text>
        <view v-for="(c, i) in detail.changes" :key="i" class="history-item">
          <text class="description">{{ {update:'更正',delete:'删除',refund:'退款'}[c.kind] }} · {{ c.reason }} · {{ new Date(c.createdAt).toISOString() }}</text>
          <text class="description">原：{{ c.before.spentOn }} / {{ c.before.category }} / {{ (c.before.amount/100).toFixed(2) }} 元 / {{ c.before.note }} → 后：{{ c.after.spentOn }} / {{ c.after.category }} / {{ (c.after.amount/100).toFixed(2) }} 元 / {{ c.after.note }}</text>
          <text v-if="c.kind === 'refund'" class="description">退款 {{ (c.refundAmount/100).toFixed(2) }} 元 · 实际退款日 {{ c.refundedOn }}（冲回原消费日）</text>
        </view>
      </view>
      <template v-if="!creating && !detail">
        <view class="filter-row">
          <picker class="picker" :disabled="busy" mode="date" fields="month" :value="month + '-01'" @change="month = String($event.detail.value).slice(0,7); run(() => load())"><view>{{ month }} 月 ▾</view></picker>
          <picker class="picker" :disabled="busy" :range="['全部分类', ...categories]" @change="filter = Number($event.detail.value) ? categories[Number($event.detail.value)-1] : undefined; run(() => load())"><view>{{ filter || '全部分类' }} ▾</view></picker>
        </view>
        <template v-if="list">
          <view class="card"><view class="row between"><text class="budget-label">本月支出合计</text><text class="caption">{{ filter || '全部分类' }}</text></view><text class="amount amount-md">¥{{ (list.totalAmount/100).toFixed(2) }}</text><text class="caption">按所选月份全部记录统计，扣除退款，已删除账目不计支出。</text></view>
          <view class="section-head"><text class="section-title">支出记录</text><text class="caption">共 {{ list.total }} 笔</text></view>
          <view v-if="!list.total" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/book.svg" /></view><text class="empty-title">这个月还没有账目</text><text class="description">{{ filter ? '换个分类看看，或记下一笔新的消费。' : '从一笔真实消费开始，把日子记清楚。' }}</text><button role="button" class="btn" v-if="user.role === 'applicant'" @click="creating=true">记第一笔</button></view>
          <template v-for="(record, index) in list.records" :key="record.id">
            <view v-if="index === 0 || list.records[index-1].spentOn !== record.spentOn" class="section-head"><text class="caption">{{ record.spentOn }}</text></view>
            <view class="card list-card"><ExpenseRow :expense="record" :disabled="busy || !!mutation" @select="id => run(() => showDetail(id))" /></view>
          </template>
          <view class="pagination"><button role="button" class="btn" :disabled="busy || list.page <= 1" @click="run(() => load(list!.page-1))">上一页</button><text class="caption">第 {{ list.page }} 页</text><button role="button" class="btn" :disabled="busy || list.page * list.pageSize >= list.total" @click="run(() => load(list!.page+1))">下一页</button></view>
        </template>
      </template>
    </template>
    <button role="button" class="btn" v-if="!creating && !detail" :disabled="busy" @click="run(refresh)">刷新账本</button>
  </view>
</template>
