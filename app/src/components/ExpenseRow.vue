<script setup lang="ts">
import type { Expense } from '@bossok/contracts';
import CategoryIcon from './CategoryIcon.vue';
defineProps<{ expense: Expense; disabled?: boolean }>();
defineEmits<{ select: [id: string] }>();
</script>
<template>
  <button role="button" class="btn list-row" :disabled="disabled" @click="$emit('select', expense.id)">
    <view class="cat-icon"><CategoryIcon :category="expense.category" /></view>
    <view class="grow">
      <text class="row-title">{{ expense.note || expense.category }}</text>
      <text class="caption">{{ expense.category }} · {{ expense.spentOn }}</text>
      <view class="tags">
        <text v-if="expense.approvalId" class="tag tag-green">关联审批</text>
        <text v-if="expense.deletedAt !== null" class="tag">已删除，不计支出</text>
        <text v-else-if="!expense.budgetApplicable" class="tag">预算生效前</text>
        <text v-if="expense.unapproved" class="tag tag-warm">{{ expense.approvalId ? `未批准差额 ¥${(expense.unapprovedAmount/100).toFixed(2)}` : '未审批超支' }}</text>
        <text v-if="expense.refunded" class="tag">已退款 ¥{{ (expense.refunded/100).toFixed(2) }}</text>
      </view>
    </view>
    <view class="row-end">
      <text class="row-amount">¥{{ (expense.amount/100).toFixed(2) }}</text>
      <text v-if="expense.refunded || expense.deletedAt !== null" class="caption">净 ¥{{ ((expense.deletedAt !== null ? 0 : expense.amount-expense.refunded)/100).toFixed(2) }}</text>
    </view>
  </button>
</template>
