<script setup lang="ts">
import { ref, watch } from 'vue';
import CategoryIcon from '../../components/CategoryIcon.vue';
import { onShow, onHide, onBackPress } from '@dcloudio/uni-app';
import { categories, yuanToCents, type Identity, type Category, type Approval, type ApprovalInput, type ApprovalAction, type ConfirmInput, type CancelInput, type ApprovalPage, type ApprovalDetail, type ApprovalPreview, type MessagePage, type Balances } from '@bossok/contracts';
import { currentUser, sessionToken, spending, notifications } from '../../application';
import { RequestError } from '../../shared/http';
const user = ref<Identity | null>(null), busy = ref(false), message = ref(''), month = ref('');
const list = ref<ApprovalPage | null>(null), detail = ref<ApprovalDetail | null>(null), messages = ref<MessagePage | null>(null), balance = ref<Balances | null>(null), preview = ref<ApprovalPreview | null>(null);
const amount = ref(''), category = ref<Category>('餐饮'), purpose = ref(''), reason = ref(''), opinion = ref('');
type Pending = { kind: 'create'; body: ApprovalInput } | { kind: 'action'; id: string; body: ApprovalAction } | { kind: 'confirm'; id: string; body: ConfirmInput } | { kind: 'cancel'; id: string; body: CancelInput };
const actualAmount = ref(''), actualDate = ref(''), actualNote = ref(''), cancelReason = ref('');
const pending = ref<Pending | null>(null), creating = ref(false);
const statusNames = { pending: '待审批', approved: '已同意待消费', rejected: '已拒绝', withdrawn: '已撤销', expired: '已过期', consumed: '已消费', cancelled: '已取消消费' };
function statusName(a: Approval) { return a.kind === 'supplement' && a.status === 'approved' ? '差额已补批' : statusNames[a.status]; }
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
  user.value = null; list.value = null; detail.value = null; messages.value = null; preview.value = null; balance.value = null; pending.value = null; creating.value = false;
  if (!sessionToken()) return;
  user.value = await currentUser();
  if (previousId && previousId !== user.value.id) { amount.value=''; purpose.value=''; reason.value=''; opinion.value=''; month.value=''; category.value='餐饮'; }
  if (!user.value.relationshipId) return;
  pending.value = uni.getStorageSync(key()) || null;
  creating.value = !!uni.getStorageSync('new-approval'); uni.removeStorageSync('new-approval');
  balance.value = await spending.balances(sessionToken());
  if (!month.value) month.value = balance.value.budget.date.slice(0,7);
  if (pending.value?.kind === 'create') { creating.value = true; const b = pending.value.body; amount.value=(b.amount/100).toFixed(2); purpose.value=b.purpose; reason.value=b.reason; category.value=b.category; }
  await load();
  const messageId=uni.getStorageSync('open-message');
  if(messageId) {
    uni.removeStorageSync('open-message');
    try {await openMessage(String(messageId));}
    catch(error) {
      if(!(error instanceof RequestError) || error.statusCode===0 || error.statusCode===401 || error.statusCode>=500) uni.setStorageSync('open-message',messageId);
      throw error;
    }
    return;
  }
  const openId = uni.getStorageSync('open-approval');
  if (openId) { uni.removeStorageSync('open-approval'); await show(String(openId)); }
  else if (pending.value && pending.value.kind !== 'create') await show(pending.value.id);
}
function input(): ApprovalInput {
  if (!purpose.value.trim() || !reason.value.trim()) throw new Error('请填写用途和申请原因');
  return { requestId: requestId(), amount: yuanToCents(amount.value), category: category.value, spentOn: balance.value!.budget.date, purpose: purpose.value, reason: reason.value };
}
async function openMessage(id:string) {
 const m=await notifications.get(sessionToken(),id);
 await notifications.read(sessionToken(),id);
 if(m.kind==='approval' && m.approvalId) await show(m.approvalId);
 else {uni.switchTab({url:'/pages/home/index'});}
 messages.value=await notifications.list(sessionToken());
}
const deliveryNames={not_registered:'未登记设备或未开启',pending:'待投递',accepted:'推送服务已受理',failed:'投递失败，可重试',skipped:'已跳过投递'};
async function show(id: string) {
  detail.value = await spending.approval(sessionToken(),id); creating.value = false; opinion.value = ''; actualAmount.value = ''; actualDate.value = detail.value.approval.spentOn; actualNote.value = ''; cancelReason.value = '';
  const p = pending.value;
  if (p && p.kind !== 'create' && p.id === id) {
    if (p.kind === 'confirm') { actualAmount.value=(p.body.amount/100).toFixed(2); actualDate.value=p.body.spentOn; actualNote.value=p.body.note; }
    else if (p.kind === 'cancel') cancelReason.value=p.body.reason;
    else opinion.value=p.body.opinion;
  }
}
async function retry() {
  if (!pending.value) return;
  const creating = pending.value.kind === 'create';
  let result;
  try {
    const p = pending.value;
    if (p.kind === 'create') result = await spending.createApproval(sessionToken(),p.body);
    else if (p.kind === 'action') result = await spending.actApproval(sessionToken(),p.id,p.body);
    else if (p.kind === 'confirm') result = await spending.confirmApproval(sessionToken(),p.id,p.body);
    else result = await spending.cancelApproval(sessionToken(),p.id,p.body);
  }
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
async function confirm() {
  pending.value={kind:'confirm',id:detail.value!.approval.id,body:{requestId:requestId(),amount:yuanToCents(actualAmount.value),spentOn:actualDate.value,note:actualNote.value}};
  uni.setStorageSync(key(),pending.value); await retry();
}
async function cancel() {
  if (!cancelReason.value.trim()) throw new Error('请填写取消原因');
  pending.value={kind:'cancel',id:detail.value!.approval.id,body:{requestId:requestId(),reason:cancelReason.value}};
  uni.setStorageSync(key(),pending.value); await retry();
}
function openExpense(id: string) { uni.setStorageSync('open-expense',id); uni.switchTab({url:'/pages/ledger/index'}); }
onShow(() => { void run(refresh); });
watch([creating, detail], () => { if (creating.value || detail.value) uni.hideTabBar(); else uni.showTabBar(); });
onHide(() => { uni.showTabBar(); });
onBackPress(() => { if (!creating.value && !detail.value) return false; creating.value = false; detail.value = null; return true; });
function profile() { uni.switchTab({url:'/pages/profile/index'}); }
</script>
<template>
  <view class="page">
    <view class="page-header"><button role="button" v-if="detail || creating" class="btn icon-button" aria-label="返回审批列表" @click="detail=null; creating=false"><image class="icon" src="/static/icons/back.svg" /></button><view class="header-copy"><text class="title">{{ detail ? '申请详情' : creating ? '申请超支' : '审批' }}</text><text class="subtitle">{{ user?.role === 'approver' ? '小弟的超支申请，由你把关' : '提前说一声，一起做安排' }}</text></view><button role="button" v-if="!detail && !creating && user?.role === 'applicant' && user.relationshipId" class="btn icon-button" aria-label="申请超支" :disabled="busy || !!pending" @click="creating=true"><image class="icon" src="/static/icons/plus.svg" /></button></view>
    <text v-if="message" class="notice" role="alert">{{ message }}</text>
    <text v-if="busy && !user" class="description" role="status">正在同步申请与消息…</text>
    <view v-if="!busy && !user?.relationshipId" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/check.svg" /></view><text class="empty-title">超出预算前，一起商量</text><text class="description">{{ user ? '你已登录，请先在“我的”完成伙伴绑定。' : '请先在“我的”登录并完成伙伴绑定。' }}</text><button role="button" class="btn" @click="profile">{{ user ? '去绑定伙伴' : '前往我的' }}</button></view>
    <template v-if="user?.relationshipId && balance">
      <view v-if="!detail" class="notice"><text class="row-title">{{ balance.budget.date }} · 申请仅当天有效</text><text>实际支出：日 ¥{{ (balance.dailySpent/100).toFixed(2) }} / 月 ¥{{ (balance.monthlySpent/100).toFixed(2) }}</text><text class="description">待消费承诺：日 ¥{{ (balance.dailyCommitted/100).toFixed(2) }} / 月 ¥{{ (balance.monthlyCommitted/100).toFixed(2) }}</text><text class="description">可安排：日 {{ balance.dailyAvailable === null ? '未设置预算' : '¥'+(balance.dailyAvailable/100).toFixed(2) }} / 月 {{ balance.monthlyAvailable === null ? '未设置预算' : '¥'+(balance.monthlyAvailable/100).toFixed(2) }}</text></view>
      <view v-if="pending" class="card"><text class="description">提交结果待确认，保留原请求，请重试。</text><button role="button" class="btn" :disabled="busy" @click="run(retry)">重试同一操作</button></view>
      <view v-if="user.role === 'applicant' && creating && !detail" class="card">
        <text class="card-title">这笔花费，想和老板商量一下</text><text class="field-label">预计完整金额（元）<text class="required">*</text></text>
        <input class="input amount-input" v-model="amount" aria-label="预计金额" placeholder="0.00" :disabled="busy || !!pending" type="digit" />
        <text class="field-label">消费分类</text><view class="category-grid"><button role="button" v-for="c in categories" :key="c" class="btn category-option" :class="{selected: category === c}" :disabled="busy || !!pending" :aria-pressed="category === c" @click="category=c; preview=null"><CategoryIcon :category="c" />{{ c }}</button></view>
        <text class="field-label">用途<text class="required">*</text></text>
        <input class="input" v-model="purpose" aria-label="用途" placeholder="用途" maxlength="100" :disabled="busy || !!pending" />
        <text class="field-label">申请原因<text class="required">*</text></text>
        <input class="input" v-model="reason" aria-label="申请原因" placeholder="申请原因" maxlength="300" :disabled="busy || !!pending" />
        <button role="button" class="btn" :disabled="busy || !!pending" @click="run(measure)">测算超支</button>
        <text v-if="preview" class="description">本次测算：超日 {{ (preview.dailyOver/100).toFixed(2) }} 元 / 超月 {{ (preview.monthlyOver/100).toFixed(2) }} 元；提交时重新核算。</text>
        <button role="button" class="btn primary" :disabled="busy || !!pending" @click="run(submit)">提交超支申请</button>
      </view>
      <view v-if="detail" class="card">
        <view class="row between"><text class="section-title">{{ detail.approval.purpose }}</text><text class="tag" :class="`tag-${detail.approval.status}`">{{ statusName(detail.approval) }}</text></view><text class="amount">¥{{ (detail.approval.amount/100).toFixed(2) }}</text><text class="caption">{{ detail.approval.spentOn }} · {{ detail.approval.category }}</text><view class="divider" />
        <text v-if="detail.approval.kind === 'supplement'" class="description">已消费差额补批：只修正批准标记，不再新增支出或占用承诺。</text>
        <text class="description">详情：{{ detail.approval.purpose }} · {{ statusName(detail.approval) }} · {{ (detail.approval.amount/100).toFixed(2) }} 元</text>
        <text class="description">{{ detail.approval.spentOn }} · {{ detail.approval.category }} · {{ detail.approval.reason }}</text>
        <text v-if="detail.approval.kind === 'purchase'" class="description">提交时超日 {{ (detail.approval.dailyOver/100).toFixed(2) }} / 超月 {{ (detail.approval.monthlyOver/100).toFixed(2) }} 元</text>
        <text v-if="detail.approval.kind === 'purchase' && detail.approval.status === 'pending'" class="description">按当前实际支出及承诺，本次预计超日 {{ (detail.dailyOver/100).toFixed(2) }} / 超月 {{ (detail.monthlyOver/100).toFixed(2) }} 元</text>
        <text class="description">当前预算：日 {{ detail.balances.budget.daily ? (detail.balances.budget.daily.amount/100).toFixed(2) : '未设置' }} / 月 {{ detail.balances.budget.monthly ? (detail.balances.budget.monthly.amount/100).toFixed(2) : '未设置' }} 元；待消费：日 {{ (detail.balances.dailyCommitted/100).toFixed(2) }} / 月 {{ (detail.balances.monthlyCommitted/100).toFixed(2) }} 元</text>
        <text v-if="detail.approval.kind === 'purchase' && detail.approval.status === 'approved'" class="description">批准仅占用承诺，不计实际支出，不提高预算。</text>
        <template v-if="detail.expense">
          <text class="description">关联实际消费 {{ (detail.expense.amount/100).toFixed(2) }} 元；未批准差额 {{ (detail.expense.unapprovedAmount/100).toFixed(2) }} 元；已退款 {{ (detail.expense.refunded/100).toFixed(2) }} 元{{ detail.expense.deletedAt !== null ? '；账目已删除' : '' }}</text>
          <button role="button" class="btn" :disabled="busy" @click="openExpense(detail.expense.id)">查看关联账目 / 更正 / 差额补批</button>
        </template>
        <template v-if="user.role === 'applicant' && detail.approval.kind === 'purchase' && (detail.approval.status === 'approved' || (detail.approval.status === 'expired' && detail.approval.expiredFrom === 'approved'))">
          <text class="description">购买前金额增加请取消本次后按新金额重申；已发生的消费如实填实际金额，超过批准额只标记差额，之后从账目详情补批。</text>
          <text v-if="detail.approval.status === 'expired'" class="description">已过期：仅可补记原批准日已经发生的真实消费；跨日购买须重新申请。</text>
          <input class="input" v-model="actualAmount" aria-label="实际消费金额" placeholder="实际消费金额（元）" :disabled="busy || !!pending" type="digit" />
          <picker class="picker" mode="date" :value="actualDate" :disabled="busy || !!pending" @change="actualDate=String($event.detail.value)"><view>真实消费日期：{{ actualDate }}</view></picker>
          <input class="input" v-model="actualNote" aria-label="实际消费备注" placeholder="实际消费备注" maxlength="500" :disabled="busy || !!pending" />
          <button role="button" class="btn primary" :disabled="busy || !!pending" @click="run(confirm)">确认实际消费（自动记一笔）</button>
          <template v-if="detail.approval.status === 'approved'">
            <input class="input" v-model="cancelReason" aria-label="取消购买原因" placeholder="取消购买原因" maxlength="300" :disabled="busy || !!pending" />
            <button role="button" class="btn" :disabled="busy || !!pending" @click="run(cancel)">不购买，取消消费</button>
          </template>
        </template>
        <template v-if="detail.approval.status === 'pending'">
          <input class="input" v-model="opinion" aria-label="审批意见" placeholder="审批/撤销意见（可选）" maxlength="300" :disabled="busy || !!pending" />
          <template v-if="user.role === 'approver'">
            <button role="button" class="btn primary" :disabled="busy || !!pending" @click="run(() => act('approve'))">同意本次例外</button>
            <button role="button" class="btn danger" :disabled="busy || !!pending" @click="run(() => act('reject'))">拒绝申请</button>
          </template>
          <button role="button" class="btn" v-else :disabled="busy || !!pending" @click="run(() => act('withdraw'))">撤销待审申请</button>
        </template>
        <text v-for="(event,i) in detail.history" :key="i" class="description history-item">{{ actionNames[event.action] || event.action }} · {{ event.opinion }} · {{ new Date(event.createdAt).toISOString() }}</text>
        <button role="button" class="btn" :disabled="busy" @click="run(() => show(detail!.approval.id))">刷新详情</button>
      </view>
      <template v-if="!creating && !detail">
        <picker class="picker" mode="date" fields="month" :value="month+'-01'" :disabled="busy" @change="month=String($event.detail.value).slice(0,7); run(() => load())"><view>申请月份：{{ month }} ▾</view></picker>
        <template v-if="list">
          <view class="section-head"><text class="section-title">{{ user.role === 'approver' ? '等你把关' : '我的申请' }}</text><text class="caption">共 {{ list.total }} 份</text></view>
          <view v-if="!list.total" class="card empty"><view class="empty-icon"><image class="icon" src="/static/icons/check.svg" /></view><text class="empty-title">{{ user.role === 'approver' ? '暂时没有需要处理的申请' : '这里还没有申请' }}</text><text class="description">预计要超出额度时，提前提交申请，和伙伴一起安排。</text><button role="button" class="btn" v-if="user.role === 'applicant'" @click="creating=true">申请超支</button></view>
          <view v-else class="card list-card"><button role="button" v-for="a in list.records" :key="a.id" class="btn list-row" :disabled="busy" @click="run(() => show(a.id))"><view class="cat-icon"><CategoryIcon :category="a.category" /></view><view class="grow"><text class="row-title">{{ a.purpose }}</text><text class="caption">{{ a.spentOn }} · {{ a.kind === 'supplement' ? '差额补批' : a.category }}</text></view><view class="row-end"><text class="row-amount">¥{{ (a.amount/100).toFixed(2) }}</text><text class="tag" :class="`tag-${a.status}`">{{ statusName(a) }}</text></view></button></view>
          <view class="pagination"><button role="button" class="btn" :disabled="busy || list.page<=1" @click="run(() => load(list!.page-1))">申请上一页</button><text class="caption">第 {{ list.page }} 页</text><button role="button" class="btn" :disabled="busy || list.page*list.pageSize>=list.total" @click="run(() => load(list!.page+1))">申请下一页</button></view>
        </template>
      <view v-if="messages" class="card">
        <view class="row between"><text class="section-title">消息提醒</text><text class="tag tag-green">{{ messages.unread }} 条未读</text></view><text class="caption">共 {{ messages.total }} 条 · 打开详情会重新查询最新状态</text>
        <text v-if="!messages.total" class="description">暂无消息</text>
        <view v-for="m in messages.records" :key="m.id" class="history-item"><text class="description">{{ m.readAt === null ? '未读 · ' : '已读 · ' }}{{ m.title }} · {{ deliveryNames[m.deliveryStatus] }}</text><button role="button" class="btn" :disabled="busy" @click="run(() => openMessage(m.id))">打开消息详情</button></view>
        <view class="pagination"><button role="button" class="btn" :disabled="busy || messages.page<=1" @click="run(() => loadMessages(messages!.page-1))">消息上一页</button>
        <button role="button" class="btn" :disabled="busy || messages.page*messages.pageSize>=messages.total" @click="run(() => loadMessages(messages!.page+1))">消息下一页</button></view>
      </view>
      </template>
    </template>
    <button role="button" class="btn" v-if="!creating && !detail" :disabled="busy" @click="run(refresh)">刷新审批与消息</button>
  </view>
</template>
