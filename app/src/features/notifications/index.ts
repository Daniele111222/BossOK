import { isMessagePage } from '@bossok/contracts';
import { checked } from '../identity/index.js';
import type { HttpRequest } from '../../shared/http/index.js';
export function createNotificationsClient(request: HttpRequest) {
  return { async list(token: string, page = 1) { return checked(await request(`/messages?page=${page}`, { token }), isMessagePage); } };
}
