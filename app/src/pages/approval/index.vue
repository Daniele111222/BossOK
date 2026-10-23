<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { categories, yuanToCents, type Identity, type Category, type ApprovalInput, type ApprovalAction, type ApprovalPage, type ApprovalDetail, type ApprovalPreview, type MessagePage, type Balances } from '@bossok/contracts';
import { currentUser, sessionToken, spending, notifications } from '../../application';
import { RequestError } from '../../shared/http';
const user = ref<Identity | null>(null), busy = ref(false), message = ref(''), month = ref('');
const list = ref<ApprovalPage | null>(null), detail = ref<ApprovalDetail | null>(null), messages = ref<MessagePage | null>(null), balance = ref<Balances | null>(null), preview = ref<ApprovalPreview | null>(null);
const amount = ref(''), category = ref<Category>('餐饮'), purpose = ref(''), reason = ref(''), opinion = ref('');
type Pending = { kind: 'create'; body: ApprovalInput } | { kind: 'action'; id: string; body: ApprovalAction };
const pending = ref<Pending | null>(null);
const statusNames = { pending: '待审批', approved: '已同意待消费', rejected: '已拒绝', withdrawn: '已撤销', expired: '已过期', consumed: '已消费', cancelled: '已取消消费' };
const actionNames: Record<string,string> = { submit:'提交',approve:'同意',reject:'拒绝',withdraw:'撤销',expire:'过期',confirm:'确认消费',cancel:'取消消费' };
const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function key() { return `approval-pending-${user.value!.id}`; }
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; message.value = '';
  try { await action(); } catch(e) { message.value = e instanceof Error ? e.message : '操作失败'; }
  finally { busy.value = false; }
}
async function load(page = 1) {
  list.value = await spending.approvals(sessionToken(),month.value,page);
  balance.value = await spending.balances(sessionToken());
  messages.value = await notifications.list(sessionToken());
}
async function refresh() {
  const previousId = user.value?.id;
  user.value = null; list.value = null; detail.value = null; messages.value = null; preview.value = null; balance.value = null; pending.value = null;
  user.value = await currentUser();
  if (previousId && previousId !== user.value.id) { amount.value=''; purpose.value=''; reason.value=''; opinion.value=''; month.value=''; category.value='餐饮'; }
  pending.value = uni.getStorageSync(key()) || null;
  balance.value = await spending.balances(sessionToken());
  if (!month.value) month.value = balance.value.budget.date.slice(0,7);
  if (pending.value?.kind === 'create') { const b = pending.value.body; amount.value=(b.amount/100).toFixed(2); purpose.value=b.purpose; reason.value=b.reason; category.value=b.category; }
  await load();
}
function input(): ApprovalInput {
  if (!purpose.value.trim() || !reason.value.trim()) throw new Error('请填写用途和申请原因');
  return { requestId: requestId(), amount: yuanToCents(amount.value), category: category.value, spentOn: balance.value!.budget.date, purpose: purpose.value, reason: reason.value };
}
async function show(id: string) { detail.value = await spending.approval(sessionToken(),id); opinion.value = ''; }
async function retry() {
  if (!pending.value) return;
  const creating = pending.value.kind === 'create';
  let result;
  try { result = pending.value.kind === 'create' ? await spending.createApproval(sessionToken(),pending.value.body) : await spending.actApproval(sessionToken(),pending.value.id,pending.value.body); }
  catch(e) {
    if (e instanceof RequestError && e.statusCode >= 400 && e.statusCode < 500 && ![401,403].includes(e.statusCode)) { pending.value=null; uni.removeStorageSync(key()); }
    throw e;
  }
  pending.value=null; uni.removeStorageSync(key()); preview.value=null;
  if (creating) { amount.value=''; purpose.value=''; reason.value=''; }
  await load(); await show(result.id); message.value='操作成功';
}
async function measure() { preview.value = await spending.previewApproval(sessionToken(),input()); }
async function loadMessages(page: number) { messages.value = await notifications.list(sessionToken(),page); }
async function submit() { pending.value={kind:'create',body:input()}; uni.setStorageSync(key(),pending.value); await retry(); }
async function act(action: ApprovalAction['action']) {
  pending.value={kind:'action',id:detail.value!.approval.id,body:{requestId:requestId(),action,opinion:opinion.value}};
  uni.setStorageSync(key(),pending.value); await retry();
}
onShow(() => { void run(refresh); });
</script>
<template>
  <view class="page">
    <text class="title">审批</text>
    <text class="description" role="alert">{{ message }}</text>
    <template v-if="user?.relationshipId && balance">
      <text class="description">上海日期 {{ balance.budget.date }}；申请仅当天有效。金额变化请撤销后重提。</text>
      <text class="description">实际支出：日 {{ (balance.dailySpent/100).toFixed(2) }} / 月 {{ (balance.monthlySpent/100).toFixed(2) }} 元</text>
      <text class="description">待消费承诺：日 {{ (balance.dailyCommitted/100).toFixed(2) }} / 月 {{ (balance.monthlyCommitted/100).toFixed(2) }} 元</text>
      <text class="description">可安排：日 {{ balance.dailyAvailable === null ? '未设置预算' : (balance.dailyAvailable/100).toFixed(2) }} / 月 {{ balance.monthlyAvailable === null ? '未设置预算' : (balance.monthlyAvailable/100).toFixed(2) }} 元</text>
      <view v-if="pending" class="card"><text class="description">提交结果待确认，保留原请求，请重试。</text><button :disabled="busy" @click="run(retry)">重试同一操作</button></view>
      <view v-if="user.role === 'applicant'" class="card">
        <input v-model="amount" aria-label="预计金额" placeholder="预计完整消费金额（元）" :disabled="busy || !!pending" />
        <picker :range="categories" :disabled="busy || !!pending" @change="category=categories[Number($event.detail.value)]; preview=null"><view>消费分类：{{ category }}</view></picker>
        <input v-model="purpose" aria-label="用途" placeholder="用途" maxlength="100" :disabled="busy || !!pending" />
        <input v-model="reason" aria-label="申请原因" placeholder="申请原因" maxlength="300" :disabled="busy || !!pending" />
        <button :disabled="busy || !!pending" @click="run(measure)">测算超支</button>
        <text v-if="preview" class="description">本次测算：超日 {{ (preview.dailyOver/100).toFixed(2) }} 元 / 超月 {{ (preview.monthlyOver/100).toFixed(2) }} 元；提交时重新核算。</text>
        <button :disabled="busy || !!pending" @click="run(submit)">提交超支申请</button>
      </view>
      <view v-if="detail" class="card">
        <text class="description">详情：{{ detail.approval.purpose }} · {{ statusNames[detail.approval.status] }} · {{ (detail.approval.amount/100).toFixed(2) }} 元</text>
        <text class="description">{{ detail.approval.spentOn }} · {{ detail.approval.category }} · {{ detail.approval.reason }}</text>
        <text class="description">提交时超日 {{ (detail.approval.dailyOver/100).toFixed(2) }} / 超月 {{ (detail.approval.monthlyOver/100).toFixed(2) }} 元</text>
        <text v-if="detail.approval.status === 'pending'" class="description">按当前实际支出及承诺，本次预计超日 {{ (detail.dailyOver/100).toFixed(2) }} / 超月 {{ (detail.monthlyOver/100).toFixed(2) }} 元</text>
        <text class="description">当前预算：日 {{ detail.balances.budget.daily ? (detail.balances.budget.daily.amount/100).toFixed(2) : '未设置' }} / 月 {{ detail.balances.budget.monthly ? (detail.balances.budget.monthly.amount/100).toFixed(2) : '未设置' }} 元；待消费：日 {{ (detail.balances.dailyCommitted/100).toFixed(2) }} / 月 {{ (detail.balances.monthlyCommitted/100).toFixed(2) }} 元</text>
        <text v-if="detail.approval.status === 'approved'" class="description">批准仅占用承诺，不计实际支出，不提高预算。</text>
        <template v-if="detail.approval.status === 'pending'">
          <input v-model="opinion" aria-label="审批意见" placeholder="审批/撤销意见（可选）" maxlength="300" :disabled="busy || !!pending" />
          <template v-if="user.role === 'approver'">
            <button :disabled="busy || !!pending" @click="run(() => act('approve'))">同意本次例外</button>
            <button :disabled="busy || !!pending" @click="run(() => act('reject'))">拒绝申请</button>
          </template>
          <button v-else :disabled="busy || !!pending" @click="run(() => act('withdraw'))">撤销待审申请</button>
        </template>
        <text v-for="(event,i) in detail.history" :key="i" class="description">{{ actionNames[event.action] || event.action }} · {{ event.opinion }} · {{ new Date(event.createdAt).toISOString() }}</text>
        <button :disabled="busy" @click="run(() => show(detail!.approval.id))">刷新详情</button>
      </view>
      <picker mode="date" fields="month" :value="month+'-01'" :disabled="busy" @change="month=String($event.detail.value).slice(0,7); run(() => load())"><view>申请月份：{{ month }}</view></picker>
      <template v-if="list">
        <text v-if="!list.total" class="description">本月暂无申请</text>
        <view v-for="a in list.records" :key="a.id" class="card"><text class="description">{{ a.spentOn }} · {{ a.purpose }} · {{ (a.amount/100).toFixed(2) }} 元 · {{ statusNames[a.status] }}</text><button :disabled="busy" @click="run(() => show(a.id))">查看申请详情</button></view>
        <text class="description">共 {{ list.total }} 份 · 第 {{ list.page }} 页</text>
        <button :disabled="busy || list.page<=1" @click="run(() => load(list!.page-1))">申请上一页</button>
        <button :disabled="busy || list.page*list.pageSize>=list.total" @click="run(() => load(list!.page+1))">申请下一页</button>
      </template>
      <view v-if="messages" class="card">
        <text class="description">应用内消息（共 {{ messages.total }} 条）；打开详情会重新查询状态。</text>
        <text v-if="!messages.total" class="description">暂无消息</text>
        <view v-for="m in messages.records" :key="m.id"><text class="description">{{ m.title }}</text><button :disabled="busy" @click="run(() => show(m.approvalId))">打开消息详情</button></view>
        <button :disabled="busy || messages.page<=1" @click="run(() => loadMessages(messages!.page-1))">消息上一页</button>
        <button :disabled="busy || messages.page*messages.pageSize>=messages.total" @click="run(() => loadMessages(messages!.page+1))">消息下一页</button>
      </view>
    </template>
    <button :disabled="busy" @click="run(refresh)">刷新审批与消息</button>
  </view>
</template>
