import { readFileSync } from 'node:fs';
import { readConfig } from './config.js';
import { openDatabase } from './infrastructure/database/index.js';
import { createAccount, resetPassword } from './modules/identity/index.js';

const [operation, username, role] = process.argv.slice(2);
if (!username || !['create', 'reset-password'].includes(operation) || (operation === 'create' && role !== 'approver' && role !== 'applicant')) {
  throw new Error('用法：admin create 用户名 approver|applicant 或 admin reset-password 用户名；密码从标准输入读取');
}
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const db = openDatabase(readConfig(process.env).databasePath);
try {
  if (operation === 'create') await createAccount(db, username, role as 'approver' | 'applicant', password);
  else await resetPassword(db, username, password);
  console.log('账户操作成功');
} catch {
  console.error('操作失败：检查账号、角色是否已存在，密码需 10–128 字符');
  process.exitCode = 1;
} finally { db.close(); }
