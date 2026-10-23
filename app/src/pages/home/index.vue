<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { BudgetSnapshot, Balances, Identity } from '@bossok/contracts';
import { currentUser, spending, sessionToken } from '../../application';
const balance = ref<Balances | null>(null);
const budget = ref<BudgetSnapshot | null>(null), user = ref<Identity | null>(null), message = ref(''), busy = ref(false);
async function refresh() {
  busy.value = true; message.value = ''; budget.value = null; balance.value = null; user.value = null;
  try { user.value = await currentUser(); balance.value = await spending.balances(sessionToken()); budget.value = balance.value.budget; }
  catch(e) { message.value = e instanceof Error ? e.message : '加载失败'; }
  finally { busy.value = false; }
}
function ledger() { uni.switchTab({ url: '/pages/ledger/index' }); }
function approvals() { uni.switchTab({ url: '/pages/approval/index' }); }
function profile() { uni.switchTab({ url: '/pages/profile/index' }); }
onShow(() => { void refresh(); });
</script>
<template>
  <view class="page">
    <text class="title">老板批了</text>
    <text class="description" role="alert">{{ message }}</text>
    <template v-if="budget">
      <text class="description">{{ budget.date }} · 上海时间 · 不结转余额</text>
      <view v-if="budget.daily && budget.monthly" class="card">
        <text class="description">日额度：{{ (budget.daily.amount / 100).toFixed(2) }} 元（{{ budget.daily.effectiveDate }} 起）</text>
        <text class="description">月预算：{{ (budget.monthly.amount / 100).toFixed(2) }} 元（{{ budget.monthly.effectiveDate }} 起沿用）</text>
        <text v-if="balance" class="description">今日已支出 {{ (balance.dailySpent/100).toFixed(2) }} 元 · 剩余 {{ ((balance.dailyRemaining ?? 0)/100).toFixed(2) }} 元</text>
        <text v-if="balance" class="description">本月已支出 {{ (balance.monthlySpent/100).toFixed(2) }} 元 · 剩余 {{ ((balance.monthlyRemaining ?? 0)/100).toFixed(2) }} 元</text>
        <text v-if="balance" class="description">待消费承诺：今日 {{ (balance.dailyCommitted/100).toFixed(2) }} 元 / 本月 {{ (balance.monthlyCommitted/100).toFixed(2) }} 元</text>
        <text v-if="balance" class="description">可安排：今日 {{ ((balance.dailyAvailable ?? 0)/100).toFixed(2) }} 元 / 本月 {{ ((balance.monthlyAvailable ?? 0)/100).toFixed(2) }} 元（预算减实际支出及承诺）</text>
        <text class="description">计日分类：{{ budget.daily.categories.join('、') || '无' }}；全部分类计月预算</text>
      </view>
      <text v-else class="description">尚未设置预算，{{ user?.role === 'approver' ? '请到我的页面设置' : '请等待审批人设置' }}</text>
    </template>
    <button v-if="user?.relationshipId" @click="ledger">记一笔 / 查看账本</button>
    <button v-if="user?.relationshipId" @click="approvals">申请超支 / 查看审批</button>
    <button :disabled="busy" @click="refresh">刷新</button>
    <button @click="profile">登录 / 绑定 / 预算设置</button>
  </view>
</template>
