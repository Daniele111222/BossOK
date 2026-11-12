<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { Identity, MonthlySummary } from '@bossok/contracts';
import { currentUser,sessionToken,spending } from '../../application';
import CategoryIcon from '../../components/CategoryIcon.vue';
const summary=ref<MonthlySummary|null>(null),user=ref<Identity|null>(null),month=ref(''),busy=ref(false),message=ref('');
async function refresh() {
  if(busy.value) return;
  busy.value=true;message.value='';summary.value=null;user.value=null;
  try {
    if(!sessionToken()) return;
    user.value=await currentUser();
    if(!user.value.relationshipId) return;
    if(!month.value) month.value=(await spending.balances(sessionToken())).budget.date.slice(0,7);
    summary.value=await spending.summary(sessionToken(),month.value);
  } catch(e) {message.value=e instanceof Error?e.message:'加载失败';}
  finally {busy.value=false;}
}
onShow(()=>{void refresh();});
function profile() { uni.switchTab({url:'/pages/profile/index'}); }
</script>
<template>
  <view class="page">
    <view class="page-header"><view class="header-copy"><text class="title">月度汇总</text><text class="subtitle">按已录入账目统计，看见生活的节奏</text></view><button role="button" class="btn icon-button" aria-label="刷新汇总" :disabled="busy" @click="refresh"><image class="icon" src="/static/icons/refresh.svg" /></button></view>
    <text v-if="message" role="alert" class="notice notice-warm">{{ message }}</text>
    <view v-if="!busy && !user?.relationshipId" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/chart.svg" /></view><text class="empty-title">和伙伴一起，查看月度汇总</text><text class="description">{{ user ? '你已登录，请先在“我的”完成伙伴绑定。' : '请先在“我的”登录并完成伙伴绑定。' }}</text><button role="button" class="btn" @click="profile">{{ user ? '去绑定伙伴' : '前往我的' }}</button></view>
    <picker v-if="user?.relationshipId" class="picker" mode="date" fields="month" :value="month+'-01'" :disabled="busy" @change="month=String($event.detail.value).slice(0,7);refresh()"><view>{{ month || '选择月份' }} 月 ▾</view></picker>
    <text v-if="busy" class="description" role="status">正在整理这个月的账目…</text>
    <view v-if="summary && !summary.eligibleDays" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/chart.svg" /></view><text class="empty-title">这个月的记录，慢慢积累</text><text class="description">本月暂无预算生效后已结束的日期，暂不计算结余。尚未设置预算时，请到“我的”设置。</text></view>
    <template v-if="summary && summary.eligibleDays">
      <view class="card summary-hero"><text class="budget-label">统计期内总支出</text><text class="amount"><text class="currency">¥</text>{{ (summary.totalSpent/100).toFixed(2) }}</text><text class="caption">{{ summary.startDate }} 至 {{ summary.endDate }} · 不含今天</text>
        <view class="stats"><view class="stat"><text class="stat-label">历史日额度合计</text><text class="stat-value">¥{{ (summary.budgetTotal/100).toFixed(2) }}</text></view><view class="stat"><text class="stat-label">计日净支出</text><text class="stat-value">¥{{ (summary.countedSpent/100).toFixed(2) }}</text></view><view class="stat"><text class="stat-label">达标天数</text><text class="stat-value">{{ summary.metDays }} 天</text></view></view>
      </view>
      <view class="card"><view class="row between"><text class="section-title">{{ (summary.surplus ?? 0) < 0 ? '累计超支' : '累计预算结余' }}</text><text class="caption">已结束的 {{ summary.eligibleDays }} 天</text></view><text class="amount amount-md" :class="{'is-over': (summary.surplus ?? 0) < 0}">¥{{ (Math.abs(summary.surplus ?? 0)/100).toFixed(2) }}</text><text class="caption">日额度合计减去同口径净支出，超支日会扣减结余。</text><view class="divider" /><view class="row between"><text class="description">超支天数</text><text class="number">{{ summary.eligibleDays-summary.metDays }} 天</text></view><view class="row between"><text class="description">达标天数</text><text class="number">{{ summary.metDays }} / {{ summary.eligibleDays }} 天</text></view></view>
      <view class="section-head"><text class="section-title">分类支出</text><text class="caption">同一统计范围 · 净额</text></view>
      <view class="card"><view v-if="!summary.categories.length" class="empty"><text class="empty-title">还没有分类支出</text><text class="description">记录消费后，这里会展示分类金额。</text></view><view v-for="c in summary.categories" :key="c.category" class="category-bar"><view class="row"><CategoryIcon :category="c.category" /><text class="grow">{{ c.category }}</text><text class="number">¥{{ (c.amount/100).toFixed(2) }}</text></view><view class="meter" role="img" :aria-label="`${c.category}净支出 ${(c.amount/100).toFixed(2)} 元`"><view class="meter-fill" :style="{width: `${Math.max(0, c.amount) / Math.max(1, ...summary.categories.map(item => item.amount)) * 100}%`}" /></view><text class="caption">其中计入日额度 ¥{{ (c.countedAmount/100).toFixed(2) }}</text></view></view>
      <view class="notice notice-green"><text class="row-title">{{ (summary.surplus ?? 0) > 0 ? '每一笔记录，都在为生活留余地' : '先把真实花费记清楚，再一起调整安排' }}</text><text>不必为了达标压缩必要的生活开支。</text></view>
    </template>
    <view class="section-head"><text class="section-title">统计说明</text></view><text class="description footer-note">仅统计所选月预算生效后、上海今天以前已结束的日期，无账目日按零支出计算。退款冲回原消费日，补记、更正和删除后实时更新。漏记可能使结余偏高；预算结余不等于真实存款。</text>
  </view>
</template>
