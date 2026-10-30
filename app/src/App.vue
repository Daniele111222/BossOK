<script setup lang="ts">
import {refreshDevicePush,listenForPush} from './application';
import { onLaunch,onShow } from '@dcloudio/uni-app';

onLaunch(() => { listenForPush(); });
onShow(() => { void refreshDevicePush().catch(()=>{}); });
</script>

<style>
page {
  --bg: #f4f0e6; --surface: #fffdf7; --surface-2: #efe9db; --line: #e1d9c7;
  --ink: #1e2a24; --muted: #657168; --green: #1f5c46; --green-tint: #e4ede5;
  --orange: #a85a0e; --red: #a93b32;
  min-height: calc(100vh - var(--window-bottom, 0px));
  background: var(--bg); color: var(--ink); font-size: 15px;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  line-height: 1.6; -webkit-font-smoothing: antialiased;
}
.page, .card, .picker, .btn, .input { box-sizing: border-box; }
.page { max-width: 560px; margin: 0 auto; padding: calc(20px + max(var(--status-bar-height, 0px), env(safe-area-inset-top))) 16px 24px; }
.page-header { display: flex; align-items: center; gap: 10px; min-height: 52px; margin-bottom: 18px; }
.header-copy { flex: 1; min-width: 0; }
.title { display: block; font-size: 22px; font-weight: 600; line-height: 1.4; }
.subtitle, .caption { display: block; color: var(--muted); font-size: 12px; line-height: 1.6; }
.subtitle { margin-top: 3px; }
.brand { font-family: 'Songti SC', 'STSong', serif; font-size: 28px; font-weight: 700; letter-spacing: -1px; }
.brand-accent { color: var(--green); }
.description { display: block; color: var(--muted); font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(30,42,36,.04); }
.card-title { display: block; font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 20px 0 10px; }
.section-title { font-size: 16px; font-weight: 600; }
.row { display: flex; align-items: center; gap: 10px; }
.between { justify-content: space-between; }
.grow { flex: 1; min-width: 0; }
.icon { width: 22px; height: 22px; flex-shrink: 0; }
.cat-icon { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px; background: var(--surface-2); flex-shrink: 0; }
.avatar { width: 48px; height: 48px; background: var(--green-tint); border-radius: 16px; }
.amount { display: block; font-size: 36px; line-height: 1.2; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.5px; color: var(--green); margin: 6px 0; overflow-wrap: anywhere; }
.currency { font-size: .65em; margin-right: 3px; }
.amount-md { font-size: 25px; }
.number { font-variant-numeric: tabular-nums; font-weight: 600; }
.is-over { color: var(--orange); }
.budget-label { color: var(--muted); font-size: 13px; }
.budget-hero { padding-top: 10px; }
.stats { display: flex; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; margin-top: 14px; }
.stat { flex: 1; min-width: 0; }
.stat-label { display: block; color: var(--muted); font-size: 11px; }
.stat-value { display: block; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.meter { height: 6px; border-radius: 10px; background: #e7e0cf; overflow: hidden; margin-top: 12px; }
.meter-fill { height: 100%; background: var(--green); border-radius: 10px; }
.meter-fill.is-over { background: var(--orange); }
.commitment { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--line); }
.btn { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 46px; margin: 10px 0 0; padding: 10px 14px; border: 1px solid #cfc4ac; border-radius: 12px; background: var(--surface); color: var(--green); font-size: 14px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
.btn::after { border: 0; }
.btn:active { background: var(--surface-2); }
.btn:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.btn[disabled] { color: var(--muted); background: var(--surface-2); opacity: .65; }
.primary, .action { background: var(--green); border-color: var(--green); color: #fffdf7; }
.primary:active { background: #174737; }
.danger { color: var(--red); border-color: #e4bdb6; }
.danger-fill { color: #fffdf7; background: var(--red); border-color: var(--red); }
.icon-button { width: 44px; height: 44px; min-height: 44px; padding: 10px; margin: 0; border-color: transparent; background: transparent; flex-shrink: 0; }
.text-button { min-height: 44px; margin: 0; padding: 6px 0; border: 0; background: transparent; font-size: 13px; }
.actions { display: flex; gap: 8px; margin-bottom: 12px; }
.actions > .btn { flex: 1; min-width: 0; margin-top: 0; }
.actions > .primary { flex: 1.4; }
.notice { display: block; padding: 12px; margin: 12px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); color: var(--muted); font-size: 13px; line-height: 1.7; }
.notice.row { display: flex; text-align: left; }
.notice:empty { display: none; }
.notice-warm { color: #6e3c08; background: #faebd9; border-color: #efd6b8; }
.notice-green { color: #174737; background: var(--green-tint); border-color: #cfded2; }
.tag { display: inline-block; padding: 2px 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 11px; line-height: 1.6; }
.tag-green, .tag-approved, .tag-consumed { color: #174737; background: var(--green-tint); border-color: #cfded2; }
.tag-pending, .tag-warm { color: var(--orange); background: #faebd9; border-color: #efd6b8; }
.tag-rejected { color: var(--red); background: #f8e5e1; border-color: #edcbc5; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
.list-card { padding: 0; overflow: hidden; }
.list-row { display: flex; align-items: center; width: 100%; gap: 12px; padding: 14px; margin: 0; border: 0; border-radius: 0; background: transparent; text-align: left; color: var(--ink); font-weight: 400; }
.list-row + .list-row { border-top: 1px solid var(--line); }
.row-title { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; max-width: 45%; }
.row-amount { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.empty { padding: 30px 16px; text-align: center; }
.empty-icon { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 18px; background: var(--surface-2); margin: 0 auto 12px; }
.empty-title { display: block; font-size: 16px; font-weight: 600; margin-bottom: 6px; }
.empty .description { max-width: 280px; margin: auto; }
.empty .btn { margin-top: 18px; }
.input, .textarea { display: block; width: 100%; min-height: 48px; height: 48px; padding: 12px 14px; margin: 8px 0 14px; border: 1px solid #cfc4ac; border-radius: 12px; background: var(--surface); color: var(--ink); font-size: 15px; }
.input:focus-within, .textarea:focus-within { border-color: var(--green); outline: 1px solid var(--green); }
.textarea { height: 100px; }
.input[disabled] { background: var(--surface-2); }
.field-label { display: block; color: #4c5a52; font-size: 13px; font-weight: 600; margin-top: 14px; }
.required { color: var(--red); margin-left: 3px; }
.amount-input { height: 76px; font-size: 32px; font-weight: 600; color: var(--green); }
.picker { display: block; min-height: 48px; padding: 12px 14px; margin: 8px 0 14px; border: 1px solid #cfc4ac; border-radius: 12px; background: var(--surface); font-size: 14px; }
.filter-row { display: flex; gap: 8px; }
.filter-row > .picker { flex: 1; min-width: 0; }
.category-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; }
.category-option { flex: 0 0 calc((100% - 16px) / 3); flex-direction: column; margin: 0; min-height: 70px; border-color: var(--line); font-size: 13px; }
.category-option.selected { background: var(--green-tint); border-color: var(--green); color: #174737; }
.pagination { display: flex; align-items: center; gap: 8px; margin: 16px 0; }
.pagination > .btn { flex: 1; margin: 0; min-height: 44px; padding: 8px; font-size: 13px; }
.pagination .caption { text-align: center; }
.divider { border-top: 1px solid var(--line); margin: 16px 0; }
.history-item { padding: 12px 0; border-top: 1px solid var(--line); }
.checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.checkbox-group .checkbox-label { display: flex; align-items: center; min-height: 44px; font-size: 13px; }
.checkbox { transform: scale(.8); }
.login-hero { padding: 28px 10px 24px; }
.login-hero .brand { font-size: 36px; }
.login-hero .description { margin-top: 12px; }
.summary-hero { background: var(--green-tint); border-color: #cfded2; }
.category-bar { margin: 16px 0; }
.category-bar:first-child { margin-top: 0; }
.category-bar:last-child { margin-bottom: 0; }
.footer-note { padding: 4px 2px 12px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; transition: none !important; } }
</style>
