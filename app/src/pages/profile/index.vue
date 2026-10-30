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
    <view class="page-header"><view class="header-copy"><text class="title">我的</text><text class="subtitle">账户、伙伴与约定</text></view></view>
    <text v-if="message" role="alert" class="notice">{{ message }}</text>
    <template v-if="!user">
      <view class="login-hero"><text class="brand">老板<text class="brand-accent">批了</text></text><text class="description">一个人记账，一个人把关。
花得明白，也不互相为难。</text></view>
      <view class="card"><text class="card-title">登录你的账户</text><text class="field-label">账号</text><input class="input" v-model="username" aria-label="账号" placeholder="管理员创建的账号" maxlength="64" :disabled="busy" /><text class="field-label">密码</text><input class="input" v-model="password" aria-label="密码" placeholder="请输入密码" password maxlength="128" :disabled="busy" /><button role="button" class="btn primary" :disabled="busy" @click="run(login)">{{ busy ? '正在登录…' : '登录' }}</button><text class="caption" style="margin-top:12px">账户由管理员创建，请使用自己的账号和密码登录。</text></view>
    </template>
    <template v-else>
      <view class="card"><view class="row"><view class="cat-icon avatar"><image class="icon" src="/static/icons/user.svg" /></view><view class="grow"><view class="row"><text class="section-title">{{ user.username }}</text><text class="tag tag-green">{{ user.role === 'approver' ? '老板 · 审批人' : '小弟 · 申请人' }}</text></view><text class="caption">{{ user.relationshipId ? '已绑定 · 和伙伴一起安排预算' : '尚未绑定伙伴' }}</text></view></view></view>
      <view class="section-head"><text class="section-title">伙伴绑定</text></view>
      <view class="card"><view class="row between"><text class="row-title">{{ user.relationshipId ? '已和伙伴绑定' : '还没绑定伙伴' }}</text><text class="tag" :class="{'tag-green': user.relationshipId}">{{ user.relationshipId ? '已绑定' : '未绑定' }}</text></view><text class="description">共享预算、应用内账目、超支申请及变更记录。</text>
        <template v-if="!user.relationshipId"><button role="button" class="btn" v-if="user.role === 'approver'" :disabled="busy" @click="run(invite)">生成邀请码</button><text v-if="user.role === 'approver' && code" selectable class="notice notice-green">{{ code }}</text><template v-if="user.role === 'applicant'"><text class="field-label">伙伴的邀请码</text><input class="input" v-model="code" aria-label="邀请码" placeholder="请输入邀请码" maxlength="64" :disabled="busy" /><text class="description">绑定后审批人可查看你的全部应用内账目与变更，不能代替你修改。第一版不支持解绑或换绑。</text><checkbox-group class="checkbox-group" @change="accepted = $event.detail.value.includes('sharing')"><label class="checkbox-label"><checkbox class="checkbox" value="sharing" :checked="accepted" color="#1f5c46" :disabled="busy" />我已阅读并同意共享</label></checkbox-group><button role="button" class="btn primary" :disabled="busy || !accepted" @click="run(bind)">接受并绑定</button></template></template>
        <text v-else class="caption" style="margin-top:10px">双方共享全部应用内账目及变更。第一版不支持解绑或换绑。</text>
      </view>
      <template v-if="user.relationshipId && budget">
        <view class="section-head"><text class="section-title">预算约定</text><text v-if="user.role !== 'approver'" class="tag">只读</text></view>
        <view class="card"><view class="row"><view class="cat-icon"><image class="icon" src="/static/icons/wallet.svg" /></view><view class="grow"><text class="row-title">日额度与月预算</text><text class="caption">首月不折算，下月沿用，不结转</text></view></view><view class="stats"><view class="stat"><text class="stat-label">当前日额度</text><text class="stat-value">{{ budget.daily ? '¥'+(budget.daily.amount/100).toFixed(2) : '未设置' }}</text></view><view class="stat"><text class="stat-label">当前月预算</text><text class="stat-value">{{ budget.monthly ? '¥'+(budget.monthly.amount/100).toFixed(2) : '未设置' }}</text></view></view>
          <template v-if="user.role === 'approver'"><text class="field-label">日额度（元）</text><input class="input" v-model="daily" aria-label="日额度" placeholder="留空保留当前额度" type="digit" :disabled="busy" /><text class="field-label">月预算（元）</text><input class="input" v-model="monthly" aria-label="月预算" placeholder="留空保留当前预算" type="digit" :disabled="busy" /><text class="field-label">计入日额度的分类</text><text class="caption">全部分类均计入月预算</text><checkbox-group class="checkbox-group" @change="selected = $event.detail.value as Category[]"><label class="checkbox-label" v-for="c in categories" :key="c"><checkbox class="checkbox" :value="c" :checked="selected.includes(c)" color="#1f5c46" :disabled="busy" />{{ c }}</label></checkbox-group><text class="field-label">调整原因<text class="required">*</text></text><input class="input" v-model="reason" aria-label="修改原因" placeholder="说说这次调整的原因" maxlength="300" :disabled="busy" /><text class="caption">首次当日生效；日额度及分类后续调整次日生效；月预算立即生效。</text><button role="button" class="btn primary" :disabled="busy" @click="run(saveBudget)">保存预算</button></template>
        </view>
        <view class="section-head"><text class="section-title">预算调整记录</text></view><view class="card"><text v-if="!budget.history.length" class="description">还没有预算调整记录</text><view v-for="v in budget.history" :key="v.id" class="history-item"><view class="row between"><text class="row-title">{{ v.kind === 'daily' ? '日额度' : '月预算' }}</text><text class="number">¥{{ (v.amount/100).toFixed(2) }}</text></view><text class="caption">{{ v.effectiveDate }} 生效 · {{ v.reason }}</text><text v-if="v.kind === 'daily'" class="caption">计日分类：{{ v.categories.join('、') || '无' }}</text><text class="caption">{{ new Date(v.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }} 上海时间</text></view></view>
      </template>
      <template v-if="user.relationshipId && preferences"><view class="section-head"><text class="section-title">消息提醒</text></view><view class="card"><view class="row"><view class="cat-icon"><image class="icon" src="/static/icons/bell.svg" /></view><view class="grow"><text class="row-title">系统推送</text><text class="caption">{{ preferences.pushEnabled ? '已开启偏好' : '已关闭偏好' }} · 应用内消息始终保留</text></view></view><text class="description" style="margin-top:12px">日/月实际支出达到 80%、100% 各提醒一次；反复改单不重复，批准未消费不触发。</text><text class="caption">{{ permission }}；{{ preferences.pushConfigured ? '服务端投递已配置' : '服务端投递尚未配置' }}</text><button role="button" class="btn" :disabled="busy" @click="run(togglePush)">{{ preferences.pushEnabled ? '关闭系统推送' : '开启系统推送偏好' }}</button><template v-if="nativePushAvailable() && preferences.pushEnabled"><text class="notice">启用本机提醒将获取推送标识并与当前登录会话关联；退出或会话失效后停止投递。系统权限由你在设置中控制。</text><button role="button" class="btn" :disabled="busy" @click="run(enablePush)">同意并启用本机系统提醒</button><button role="button" class="btn" :disabled="busy" @click="openSettings">打开系统通知设置</button></template><button role="button" class="btn" :disabled="busy" @click="run(retryNotifications)">重试我的失败通知</button></view></template>
      <button role="button" class="btn danger" :disabled="busy" @click="run(logout)">退出登录</button>
    </template>
  </view>
</template>
