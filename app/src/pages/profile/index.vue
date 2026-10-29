<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { categories, yuanToCents, type BudgetSnapshot, type Category, type Identity, type NotificationPreferences } from '@bossok/contracts';
import { currentUser, identity, sessionToken, spending, notifications, enableDevicePush,refreshDevicePush,openPendingPushMessage } from '../../application';
const user = ref<Identity | null>(null), username = ref(''), password = ref(''), code = ref('');
const budget = ref<BudgetSnapshot | null>(null), daily = ref(''), monthly = ref(''), reason = ref('');
import {notificationPermission,nativePushAvailable} from '../../platform/push';
const preferences=ref<NotificationPreferences|null>(null),permission=ref('');
async function loadNotifications() {preferences.value=await notifications.preferences(sessionToken());permission.value=notificationPermission();}
async function togglePush() {preferences.value=await notifications.savePreferences(sessionToken(),!preferences.value!.pushEnabled);await refreshDevicePush().catch(()=>{});message.value='提醒偏好已保存，应用内消息始终保留';}
function openSettings() {uni.openAppAuthorizeSetting({});}
async function retryNotifications() {await notifications.retry(sessionToken());message.value='已请求重试失败通知';}
async function enablePush() {await enableDevicePush();await loadNotifications();message.value='本机已登记；系统权限、厂商通道及后台限制仍影响到达';}
const selected = ref<Category[]>([]);
async function loadBudget() { budget.value = await spending.budget(sessionToken()); selected.value = budget.value.history.filter(v => v.kind === 'daily').slice(-1)[0]?.categories ?? categories.filter(c => c !== '生活缴费'); }
async function saveBudget() {
  budget.value = await spending.saveBudget(sessionToken(), { ...(daily.value ? { daily: yuanToCents(daily.value) } : {}), ...(monthly.value ? { monthly: yuanToCents(monthly.value) } : {}), dailyCategories: selected.value, reason: reason.value });
  daily.value = ''; monthly.value = ''; reason.value = ''; message.value = '预算已保存，具体生效日期见下方历史';
}
const accepted = ref(false), busy = ref(false), message = ref('');
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; message.value = '';
  try { await action(); } catch (e) { message.value = e instanceof Error ? e.message : '操作失败'; }
  finally { busy.value = false; }
}
async function refresh() { user.value = null; budget.value = null; preferences.value=null; if (sessionToken()) { user.value = await currentUser(); if (user.value.relationshipId) {await loadBudget();await loadNotifications();} } }
onShow(() => { void run(refresh); });
async function login() {
  const result = await identity.login(username.value, password.value);
  uni.setStorageSync('session', result.token); password.value = ''; user.value = result.user; if (user.value.relationshipId) {await loadBudget();await loadNotifications();await refreshDevicePush().catch(()=>{message.value='登录成功；本机推送暂不可用，请检查提醒配置';});openPendingPushMessage();}
}
async function logout() { await identity.logout(sessionToken()); uni.removeStorageSync('session'); user.value = null; code.value = ''; }
async function invite() { const result = await identity.invite(sessionToken()); code.value = result.code; message.value = '邀请码 24 小时有效，仅可使用一次'; }
async function bind() { user.value = await identity.bind(sessionToken(), code.value); code.value = ''; await loadBudget();await loadNotifications(); }
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
      <view v-if="user.relationshipId && budget" class="card">
        <text class="description">预算历史（金额为元，首月不折算，下月沿用不结转）</text>
        <text v-for="v in budget.history" :key="v.id" class="description">{{ v.kind === 'daily' ? '日额度' : '月预算' }} {{ (v.amount/100).toFixed(2) }} · {{ v.effectiveDate }} 生效 · {{ v.reason }} {{ v.kind === 'daily' ? ' · 计日分类：' + (v.categories.join('、') || '无') : '' }} · {{ new Date(v.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }} 上海时间</text>
        <template v-if="user.role === 'approver'">
          <input v-model="daily" aria-label="日额度" placeholder="日额度（元），留空保留" type="digit" />
          <input v-model="monthly" aria-label="月预算" placeholder="月预算（元），留空保留" type="digit" />
          <text class="description">计入日额度的分类（全部分类均计月预算）</text>
          <checkbox-group @change="selected = $event.detail.value as Category[]">
            <label v-for="c in categories" :key="c"><checkbox :value="c" :checked="selected.includes(c)" />{{ c }}</label>
          </checkbox-group>
          <input v-model="reason" aria-label="修改原因" placeholder="设置/修改原因（必填）" maxlength="300" />
          <text class="description">首次当日生效；日额度/分类后续调整次日生效；月预算立即生效。</text>
          <button :disabled="busy" @click="run(saveBudget)">保存预算</button>
        </template>
      </view>
      <view v-if="user.relationshipId && preferences" class="card">
        <text class="description">消息提醒</text>
        <text class="description">日/月实际支出达到80%、100%各提醒一次；反复改单不重复，批准未消费不触发。</text>
        <text class="description">应用内消息始终保留；系统推送{{ preferences.pushEnabled ? '已开启偏好' : '已关闭偏好' }}。</text>
        <text class="description">{{ permission }}；{{ preferences.pushConfigured ? '服务端投递已配置' : '服务端投递尚未配置' }}</text>
        <button :disabled="busy" @click="run(togglePush)">{{ preferences.pushEnabled ? '关闭系统推送' : '开启系统推送偏好' }}</button>
        <template v-if="nativePushAvailable() && preferences.pushEnabled">
          <text class="description">启用本机提醒将获取推送标识并与当前登录会话关联；退出或会话失效后停止投递。系统权限由你在设置中控制。</text>
          <button :disabled="busy" @click="run(enablePush)">同意并启用本机系统提醒</button>
          <button :disabled="busy" @click="openSettings">打开系统通知设置</button>
        </template>
        <button :disabled="busy" @click="run(retryNotifications)">重试我的失败通知</button>
      </view>
      <button :disabled="busy" @click="run(logout)">退出登录</button>
    </template>
    <text role="alert" class="description">{{ message }}</text>
  </view>
</template>
