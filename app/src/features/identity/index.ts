import { isIdentity, isInvitation, isLoginResponse } from '@bossok/contracts';
import type { HttpRequest } from '../../shared/http';
import { RequestError } from '../../shared/http';

export function checked<T>(value: unknown, guard: (v: unknown) => v is T): T {
  if (!guard(value)) throw new RequestError('INVALID_RESPONSE', '服务返回格式不正确');
  return value;
}
export function createIdentityClient(request: HttpRequest) {
  return {
    async login(username: string, password: string) { return checked(await request('/login', { method: 'POST', body: { username, password } }), isLoginResponse); },
    async me(token: string) { return checked(await request('/me', { token }), isIdentity); },
    async invite(token: string) { return checked(await request('/invitations', { method: 'POST', token }), isInvitation); },
    async bind(token: string, code: string) { return checked(await request('/bind', { method: 'POST', token, body: { code, acceptSharing: true } }), isIdentity); },
    async logout(token: string) { await request('/logout', { method: 'POST', token }); }
  };
}
