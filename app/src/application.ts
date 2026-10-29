import {getPushClientId,listenPush,nativePushAvailable,notificationAllowed} from './platform/push';
import { createNotificationsClient } from './features/notifications/index';
import { createSpendingClient } from "./features/spending/index";

import { createIdentityClient } from "./features/identity/index";
import { RequestError } from "./shared/http";

import { getApiBaseUrl } from './config';
import { createHealthClient } from './features/health/index';
import { uniTransport } from './platform/uni-request';
import { createHttpClient } from './shared/http';

const request = createHttpClient({ baseUrl: getApiBaseUrl(), transport: uniTransport });
export const health = createHealthClient(request);

export const identity = createIdentityClient(request);
export function sessionToken(): string { return uni.getStorageSync('session') || ''; }
export async function currentUser() {
  try { return await identity.me(sessionToken()); }
  catch (error) {
    if (error instanceof RequestError && error.statusCode === 401) uni.removeStorageSync('session');
    throw error;
  }
}
export const spending = createSpendingClient(request);

export const notifications = createNotificationsClient(request);

export async function enableDevicePush() {
 const token=sessionToken();await currentUser();
 const cid=await getPushClientId();
 await notifications.device(token,cid,notificationAllowed());
 uni.setStorageSync('push-consent',true);
 listenForPush();
}
let listening=false;
export function listenForPush() {
 if(listening || !nativePushAvailable() || !uni.getStorageSync('push-consent')) return;
 listening=true;
 listenPush(id=>{
  if(id) uni.setStorageSync('open-message',id);
  uni.switchTab({url:'/pages/approval/index'});
 });
}
export async function refreshDevicePush() {
 if(!nativePushAvailable() || !sessionToken() || !uni.getStorageSync('push-consent')) return;
 await currentUser();
 const prefs=await notifications.preferences(sessionToken());
 if(prefs.pushEnabled) {
  await notifications.device(sessionToken(),await getPushClientId(),notificationAllowed());
  listenForPush();
 }
}

export function openPendingPushMessage() {
 if(!uni.getStorageSync('open-message')) return false;
 uni.switchTab({url:'/pages/approval/index',fail:()=>uni.showToast({title:'打开提醒失败，请从审批页重试',icon:'none'})});return true;
}
