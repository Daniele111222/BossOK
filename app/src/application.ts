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
