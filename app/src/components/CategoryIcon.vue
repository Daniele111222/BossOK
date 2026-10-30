<script setup lang="ts">
import type { Category } from '@bossok/contracts';
defineProps<{ category: Category }>();
const icons: Record<Category, string> = { 餐饮: 'food', 交通: 'bus', 购物: 'bag', 娱乐: 'fun', 生活缴费: 'bill', 其他: 'other' };
</script>
<template><image class="icon" :src="`/static/icons/${icons[category]}.svg`" aria-hidden="true" /></template>
