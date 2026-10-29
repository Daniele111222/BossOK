import {isMessagePage,isMessage,isNotificationPreferences} from '@bossok/contracts';
import { checked } from '../identity/index.js';
import type { HttpRequest } from '../../shared/http/index.js';
export function createNotificationsClient(request: HttpRequest) {
 return {
  async list(token:string,page=1){return checked(await request(`/messages?page=${page}`,{token}),isMessagePage);},
  async get(token:string,id:string){return checked(await request(`/messages/${encodeURIComponent(id)}`,{token}),isMessage);},
  async read(token:string,id:string){return checked(await request(`/messages/${encodeURIComponent(id)}/read`,{method:'POST',token,body:{}}),isMessage);},
  async preferences(token:string){return checked(await request('/notification-preferences',{token}),isNotificationPreferences);},
  async savePreferences(token:string,pushEnabled:boolean){return checked(await request('/notification-preferences',{method:'POST',token,body:{pushEnabled}}),isNotificationPreferences);},
  async device(token:string,cid:string,enabled:boolean){return checked(await request('/push-devices',{method:'POST',token,body:{cid,enabled}}),isNotificationPreferences);},
  async retry(token:string){await request('/notifications/retry',{method:'POST',token,body:{}});}
 };
}
