<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { MonthlySummary } from '@bossok/contracts';
import { currentUser,sessionToken,spending } from '../../application';
const summary=ref<MonthlySummary|null>(null),month=ref(''),busy=ref(false),message=ref('');
async function refresh() {
  if(busy.value) return;
  busy.value=true;message.value='';summary.value=null;
  try {
    await currentUser();
    if(!month.value) month.value=(await spending.balances(sessionToken())).budget.date.slice(0,7);
    summary.value=await spending.summary(sessionToken(),month.value);
  } catch(e) {message.value=e instanceof Error?e.message:'加载失败';}
  finally {busy.value=false;}
}
onShow(()=>{void refresh();});
</script>
<template>
  <view class="page">
    <text class="title">月度汇总</text>
    <text role="alert" class="description">{{ message }}</text>
    <picker mode="date" fields="month" :value="month+'-01'" :disabled="busy" @change="month=String($event.detail.value).slice(0,7);refresh()"><view>月份：{{ month || '加载中' }}</view></picker>
    <text class="description">按已录入账目统计，漏记可能使结余偏高；预算结余不等于真实存款。</text>
    <view v-if="summary" class="card">
      <text v-if="!summary.eligibleDays" class="description">本月暂无预算生效后已结束的日期，暂不计算结余。尚未设置预算时，请到“我的”设置。</text>
      <template v-else>
        <text class="description">统计范围：{{ summary.startDate }} 至 {{ summary.endDate }}（上海日期，排除当天及预算生效前日期）</text>
        <text class="description">{{ (summary.surplus ?? 0) < 0 ? '累计超支' : '累计预算结余' }}：{{ (Math.abs(summary.surplus ?? 0)/100).toFixed(2) }} 元</text>
        <text class="description">达标 {{ summary.metDays }} / {{ summary.eligibleDays }} 天；无账目日按零支出计算。</text>
        <text class="description">历史日额度合计 {{ (summary.budgetTotal/100).toFixed(2) }} 元 − 同口径净支出 {{ (summary.countedSpent/100).toFixed(2) }} 元</text>
        <text class="description">{{ (summary.surplus ?? 0) > 0 ? '每一笔真实记录，都在帮你安排未来的余地。' : '先把真实花费记清楚，再一起调整安排。' }}不必为了达标压缩必要生活开支。</text>
        <text class="description">同一统计范围内全部分类净支出：{{ (summary.totalSpent/100).toFixed(2) }} 元；退款冲回原消费日，删除不计支出。</text>
        <text v-for="c in summary.categories" :key="c.category" class="description">{{ c.category }}：{{ (c.amount/100).toFixed(2) }} 元（计日额度 {{ (c.countedAmount/100).toFixed(2) }} 元）</text>
      </template>
    </view>
    <button :disabled="busy" @click="refresh">刷新汇总</button>
  </view>
</template>
