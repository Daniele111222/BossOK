<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { BudgetSnapshot, Balances, Identity, Expense, Approval } from '@bossok/contracts';
import { currentUser, spending, sessionToken, openPendingPushMessage } from '../../application';
import ExpenseRow from '../../components/ExpenseRow.vue';
const balance = ref<Balances | null>(null);
const budget = ref<BudgetSnapshot | null>(null), user = ref<Identity | null>(null), message = ref(''), busy = ref(false);
const recent = ref<Expense[]>([]), requests = ref<Approval[]>([]), activityError = ref('');
async function refresh() {
  if (busy.value) return;
  busy.value = true; message.value = ''; activityError.value = ''; budget.value = null; balance.value = null; user.value = null; recent.value = []; requests.value = [];
  try {
    if (!sessionToken()) return;
    user.value = await currentUser();
    if (!user.value.relationshipId) return;
    balance.value = await spending.balances(sessionToken()); budget.value = balance.value.budget;
    try {
      const month = budget.value.date.slice(0,7);
      const [ledger, approvals] = await Promise.all([spending.ledger(sessionToken(), month, undefined, 1), spending.approvals(sessionToken(), month, 1)]);
      recent.value = ledger.records.slice(0,4);
      requests.value = approvals.records.filter(a => a.status === 'pending' || (a.kind === 'purchase' && a.status === 'approved')).slice(0,3);
    } catch(e) { activityError.value = e instanceof Error ? e.message : '最近动态加载失败，请刷新重试'; }
  } catch(e) { message.value = e instanceof Error ? e.message : '加载失败'; }
  finally { busy.value = false; }
}
function ledger(create = false) { if (create) uni.setStorageSync('new-expense', true); uni.switchTab({ url: '/pages/ledger/index' }); }
function approvals(id?: string) { if (id) uni.setStorageSync('open-approval', id); uni.switchTab({ url: '/pages/approval/index' }); }
function newApproval() { uni.setStorageSync('new-approval', true); approvals(); }
function profile() { uni.switchTab({ url: '/pages/profile/index' }); }
function openExpense(id: string) { uni.setStorageSync('open-expense', id); ledger(); }
onShow(() => { if(!openPendingPushMessage()) void refresh(); });
</script>
<template>
  <view class="page">
    <view class="page-header">
      <view class="header-copy"><text class="brand">老板<text class="brand-accent">批了</text></text><text class="subtitle">{{ budget ? `${budget.date} · 上海时间` : '两个人的预算，一起安排' }}</text></view>
      <text v-if="user" class="tag tag-green">{{ user.role === 'approver' ? '老板 · 审批人' : '小弟 · 申请人' }}</text>
      <button role="button" class="btn icon-button" aria-label="刷新首页" :disabled="busy" @click="refresh"><image class="icon" src="/static/icons/refresh.svg" /></button>
    </view>
    <text v-if="message" class="notice notice-warm" role="alert">{{ message }}</text>
    <text v-if="busy && !budget" class="description" role="status">正在同步预算与账目…</text>
    <view v-if="!busy && !message && !user" class="card empty">
      <view class="empty-icon"><image class="icon" src="/static/icons/wallet.svg" /></view><text class="empty-title">花得明白，也互相体谅</text>
      <text class="description">一个人记账，一个人把关。登录后，和伙伴一起安排每天的预算。</text><button role="button" class="btn primary" @click="profile">登录，开始记录</button>
    </view>
    <view v-if="user && !user.relationshipId" class="card empty">
      <view class="empty-icon"><image class="icon" src="/static/icons/link.svg" /></view><text class="empty-title">还没绑定伙伴</text><text class="description">绑定后，双方就能共享预算、账目和超支申请。</text><button role="button" class="btn primary" @click="profile">去绑定伙伴</button>
    </view>
    <template v-if="budget && balance">
      <template v-if="budget.daily && budget.monthly">
        <view class="card">
          <view class="row budget-label"><image class="icon" src="/static/icons/wallet.svg" /><text>{{ user?.role === 'approver' ? '小弟今天的额度' : '今天的额度' }}</text></view>
          <view class="budget-hero"><text class="caption">{{ (balance.dailyRemaining ?? 0) < 0 ? '今日超支' : '今日剩余' }}</text><text class="amount" :class="{'is-over': (balance.dailyRemaining ?? 0) < 0}"><text class="currency">¥</text>{{ (Math.abs(balance.dailyRemaining ?? 0)/100).toFixed(2) }}</text></view>
          <view class="meter" role="img" :aria-label="`今日已花 ${(balance.dailySpent/100).toFixed(2)} 元，额度 ${(budget.daily.amount/100).toFixed(2)} 元`"><view class="meter-fill" :class="{'is-over': (balance.dailyRemaining ?? 0) < 0}" :style="{width: `${Math.max(0, Math.min(100, balance.dailySpent / budget.daily.amount * 100))}%`}" /></view>
          <view class="stats">
            <view class="stat"><text class="stat-label">今日额度</text><text class="stat-value">¥{{ (budget.daily.amount/100).toFixed(2) }}</text></view>
            <view class="stat"><text class="stat-label">今日已花</text><text class="stat-value">¥{{ (balance.dailySpent/100).toFixed(2) }}</text></view>
            <view class="stat"><text class="stat-label">{{ (balance.dailyRemaining ?? 0) < 0 ? '超支' : '剩余' }}</text><text class="stat-value" :class="{'is-over': (balance.dailyRemaining ?? 0) < 0}">¥{{ (Math.abs(balance.dailyRemaining ?? 0)/100).toFixed(2) }}</text></view>
          </view>
          <view class="commitment"><text class="caption">待消费承诺 ¥{{ (balance.dailyCommitted/100).toFixed(2) }} · 今日可安排 ¥{{ ((balance.dailyAvailable ?? 0)/100).toFixed(2) }}</text></view>
        </view>
        <text v-if="activityError" class="notice notice-warm" role="alert">{{ activityError }}</text>
        <button role="button" v-for="a in requests" :key="a.id" class="btn notice row between" :class="a.status === 'pending' ? 'notice-warm' : 'notice-green'" @click="approvals(a.id)">
          <view class="grow"><text class="row-title">{{ a.status === 'pending' ? (user?.role === 'approver' ? '有一笔申请等你把关' : '申请已提交，等老板回复') : (user?.role === 'approver' ? '已同意，等待小弟确认消费' : '老板同意了，记得确认消费') }}</text><text class="caption">{{ a.purpose }} · ¥{{ (a.amount/100).toFixed(2) }}</text></view><text aria-hidden="true">›</text>
        </button>
        <view class="actions" v-if="user?.role === 'applicant'"><button role="button" class="btn primary" @click="ledger(true)">＋ 记一笔</button><button role="button" class="btn" @click="newApproval">申请超支</button></view>
        <view class="actions" v-else><button role="button" class="btn primary" @click="approvals()">查看审批</button><button role="button" class="btn" @click="profile">预算设置</button></view>
        <view class="card">
          <view class="row between"><text class="section-title">{{ budget.date.slice(0,7).replace('-', ' 年 ') }} 月预算</text><text class="caption">双方共享</text></view>
          <view class="stats">
            <view class="stat"><text class="stat-label">月预算</text><text class="stat-value">¥{{ (budget.monthly.amount/100).toFixed(2) }}</text></view>
            <view class="stat"><text class="stat-label">当月已支出</text><text class="stat-value">¥{{ (balance.monthlySpent/100).toFixed(2) }}</text></view>
            <view class="stat"><text class="stat-label">{{ (balance.monthlyRemaining ?? 0) < 0 ? '月度超支' : '月度剩余' }}</text><text class="stat-value" :class="{'is-over': (balance.monthlyRemaining ?? 0) < 0}">¥{{ (Math.abs(balance.monthlyRemaining ?? 0)/100).toFixed(2) }}</text></view>
          </view>
          <view class="meter"><view class="meter-fill" :class="{'is-over': (balance.monthlyRemaining ?? 0) < 0}" :style="{width: `${Math.max(0, Math.min(100, balance.monthlySpent / budget.monthly.amount * 100))}%`}" /></view>
          <text class="caption commitment">待消费承诺 ¥{{ (balance.monthlyCommitted/100).toFixed(2) }} · 本月可安排 ¥{{ ((balance.monthlyAvailable ?? 0)/100).toFixed(2) }}</text>
        </view>
      </template>
      <view v-else class="card empty"><text class="empty-title">还没设置预算</text><text class="description">{{ user?.role === 'approver' ? '先约定日额度和月预算，记账时就有参照。' : '等老板设置好预算后，这里会显示剩余额度。' }}</text><button role="button" v-if="user?.role === 'approver'" class="btn primary" @click="profile">设置预算</button></view>
      <view class="section-head"><text class="section-title">最近消费</text><button role="button" class="btn text-button" @click="ledger()">全部账目</button></view>
      <view v-if="recent.length" class="card list-card"><ExpenseRow v-for="e in recent" :key="e.id" :expense="e" @select="openExpense" /></view>
      <view v-else-if="!activityError" class="card empty"><text class="empty-title">还没有消费记录</text><text class="description">记下第一笔，账本和月度汇总会一起更新。</text></view>
      <text v-if="budget.daily" class="caption footer-note">计日分类：{{ budget.daily.categories.join('、') || '无' }}。全部分类计月预算；日额度不结转。日额度自 {{ budget.daily.effectiveDate }} 生效，月预算自 {{ budget.monthly?.effectiveDate }} 生效并沿用。</text>
    </template>
    <button role="button" class="btn" v-if="message" @click="profile">前往我的，检查登录与绑定</button>
  </view>
</template>
