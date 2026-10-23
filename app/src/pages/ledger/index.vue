<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { categories, yuanToCents, type Category, type ExpenseInput, type Identity, type LedgerPage } from '@bossok/contracts';
import { currentUser, sessionToken, spending } from '../../application';
import { RequestError } from '../../shared/http';
const user = ref<Identity | null>(null), list = ref<LedgerPage | null>(null), busy = ref(false), message = ref('');
const month = ref(''), filter = ref<Category | undefined>(), amount = ref(''), category = ref<Category>('餐饮'), spentOn = ref(''), note = ref('');
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
  user.value = null; list.value = null;
  user.value = await currentUser();
  if (previousId && previousId !== user.value.id) { amount.value = ''; note.value = ''; spentOn.value = ''; month.value = ''; category.value = '餐饮'; }
  const saved = uni.getStorageSync(draftKey()) as ExpenseInput | undefined;
  pending.value = saved || null;
  if (saved) { pending.value = saved; amount.value = (saved.amount/100).toFixed(2); category.value = saved.category; spentOn.value = saved.spentOn; note.value = saved.note; }
  const balance = await spending.balances(sessionToken());
  if (!month.value) month.value = balance.budget.date.slice(0,7);
  if (!spentOn.value) spentOn.value = balance.budget.date;
  await load();
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
      <picker :disabled="busy" mode="date" fields="month" :value="month + '-01'" @change="month = String($event.detail.value).slice(0,7); run(() => load())"><view>月份：{{ month }}</view></picker>
      <picker :disabled="busy" :range="['全部分类', ...categories]" @change="filter = Number($event.detail.value) ? categories[Number($event.detail.value)-1] : undefined; run(() => load())"><view>分类筛选：{{ filter || '全部分类' }}</view></picker>
      <template v-if="list">
        <text v-if="!list.total" class="description">该月份/分类暂无账目</text>
        <view v-for="record in list.records" :key="record.id" class="card">
          <text class="description">{{ record.spentOn }} · {{ record.category }} · {{ (record.amount/100).toFixed(2) }} 元</text>
          <text class="description">{{ record.note }}</text>
          <text v-if="!record.budgetApplicable" class="description">预算生效前，不参与预算</text>
          <text v-if="record.unapproved" class="description">未审批超支（录入时标记）</text>
        </view>
        <text class="description">共 {{ list.total }} 笔 · 第 {{ list.page }} 页</text>
        <button :disabled="busy || list.page <= 1" @click="run(() => load(list!.page-1))">上一页</button>
        <button :disabled="busy || list.page * list.pageSize >= list.total" @click="run(() => load(list!.page+1))">下一页</button>
      </template>
    </template>
    <button :disabled="busy" @click="run(refresh)">刷新</button>
  </view>
</template>
