<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import type { Identity } from '@bossok/contracts';
import { currentUser, identity, sessionToken } from '../../application';
const user = ref<Identity | null>(null), username = ref(''), password = ref(''), code = ref('');
const accepted = ref(false), busy = ref(false), message = ref('');
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; message.value = '';
  try { await action(); } catch (e) { message.value = e instanceof Error ? e.message : '操作失败'; }
  finally { busy.value = false; }
}
async function refresh() { user.value = null; if (sessionToken()) user.value = await currentUser(); }
onShow(() => { void run(refresh); });
async function login() {
  const result = await identity.login(username.value, password.value);
  uni.setStorageSync('session', result.token); password.value = ''; user.value = result.user;
}
async function logout() { await identity.logout(sessionToken()); uni.removeStorageSync('session'); user.value = null; code.value = ''; }
async function invite() { const result = await identity.invite(sessionToken()); code.value = result.code; message.value = '邀请码 24 小时有效，仅可使用一次'; }
async function bind() { user.value = await identity.bind(sessionToken(), code.value); code.value = ''; }
</script>
<template>
  <view class="page">
    <text class="title">我的</text>
    <template v-if="!user">
      <input v-model="username" aria-label="账号" placeholder="管理员创建的账号" maxlength="64" />
      <input v-model="password" aria-label="密码" placeholder="密码" password maxlength="128" />
      <button :disabled="busy" @click="run(login)">登录</button>
    </template>
    <template v-else>
      <text class="description">{{ user.username }} · {{ user.role === 'approver' ? '审批人' : '申请人' }}</text>
      <text class="description">{{ user.relationshipId ? '已绑定，共享预算与全部应用内账目及变更' : '尚未绑定' }}</text>
      <template v-if="!user.relationshipId">
        <button v-if="user.role === 'approver'" :disabled="busy" @click="run(invite)">生成邀请码</button>
        <text v-if="user.role === 'approver'" selectable class="description">{{ code }}</text>
        <input v-else v-model="code" aria-label="邀请码" placeholder="邀请码" maxlength="64" />
        <template v-if="user.role === 'applicant'">
          <text class="description">绑定后审批人可查看你的全部应用内账目与变更，不能代替你修改。第一版不支持解绑或换绑。</text>
          <checkbox-group @change="accepted = $event.detail.value.includes('sharing')"><label><checkbox value="sharing" :checked="accepted" />我已阅读并同意共享</label></checkbox-group>
          <button :disabled="busy || !accepted" @click="run(bind)">接受并绑定</button>
        </template>
      </template>
      <button :disabled="busy" @click="run(logout)">退出登录</button>
    </template>
    <text role="alert" class="description">{{ message }}</text>
  </view>
</template>
