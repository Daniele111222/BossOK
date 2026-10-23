<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { health } from '../../application';

const message = ref('尚未检查服务连接');
const loading = ref(false);

async function connect() {
  if (loading.value) return;
  loading.value = true;
  message.value = '正在连接服务…';
  try {
    await health.check();
    message.value = '服务与数据库连接正常';
  } catch (error) {
    message.value = error instanceof Error ? error.message : '连接失败，请重试';
  } finally {
    loading.value = false;
  }
}

onLoad(() => { void connect(); });
</script>

<template>
  <view class="page">
    <text class="title">老板批了</text>
    <text class="description">每天花钱有上限，省下的钱看得见。</text>
    <view class="card">
      <text class="description">工程初始化 · 服务连接</text>
      <text class="description">{{ message }}</text>
      <button class="action" :loading="loading" :disabled="loading" @click="connect">检查连接</button>
    </view>
    <view class="card">
      <text class="description">预算与账目功能将在后续开发中接入。</text>
    </view>
  </view>
</template>
