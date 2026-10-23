import Database from 'better-sqlite3';
import { isExpense } from '@bossok/contracts';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/infrastructure/database/index.js';

it('SQLite 重启后保留数据，迁移幂等并执行约束', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bossok-'));
  const path = join(directory, 'nested', 'test.sqlite');
  try {
    const first = openDatabase(path);
    try {
      first.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
        .run('test-user', 'tester', 'test-only-hash');
      expect(() => first.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
        .run('another', 'tester', 'test-only-hash')).toThrow();
    } finally {
      first.close();
    }
    expect(first.open).toBe(false);
    const second = openDatabase(path);
    try {
      expect(second.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toEqual(
        ['001_users.sql', '002_identity.sql', '003_budgets.sql', '004_ledger.sql', '005_expense_changes.sql', '006_approvals_messages.sql', '007_consumption.sql'].map((name) => ({ name })));
      expect(second.prepare('SELECT username FROM users WHERE id = ?').get('test-user'))
        .toEqual({ username: 'tester' });
      expect(second.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


it('T05 数据库升级后旧账目、请求标识和变更快照仍满足 T06 契约', () => {
  const directory=mkdtempSync(join(tmpdir(),'bossok-upgrade-')),path=join(directory,'upgrade.sqlite');
  try {
    const old=new Database(path);
    try {
      old.pragma('foreign_keys = ON');
      old.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)');
      for (const name of ['001_users.sql','002_identity.sql','003_budgets.sql','004_ledger.sql','005_expense_changes.sql','006_approvals_messages.sql']) {
        old.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
        old.prepare('INSERT INTO schema_migrations VALUES(?)').run(name);
      }
      old.exec("INSERT INTO users(id,username,password_hash,role) VALUES('boss','boss','test','approver'),('self','self','test','applicant'); INSERT INTO relationships VALUES('r','boss','self')");
      const snapshot={id:'old-expense',requestId:'old-request-001',amount:12000,category:'餐饮',spentOn:'2026-10-23',note:'历史账目',createdAt:1,budgetApplicable:true,unapproved:true,version:2,deletedAt:null,refunded:0};
      old.prepare("INSERT INTO expenses(id,relationship_id,user_id,request_id,amount,category,spent_on,note,created_at,budget_applicable,unapproved,version,original_input) VALUES('old-expense','r','self','old-request-001',12000,'餐饮','2026-10-23','历史账目',1,1,1,2,?)").run(JSON.stringify({requestId:'old-request-001',amount:10000,category:'餐饮',spentOn:'2026-10-23',note:'历史账目'}));
      old.prepare("INSERT INTO expense_changes(expense_id,user_id,request_id,kind,input,reason,before_json,after_json,created_at) VALUES('old-expense','self','old-edit-001','update','{}','更正',?,?,2)").run(JSON.stringify({...snapshot,amount:10000,version:1}),JSON.stringify(snapshot));
    } finally {old.close();}
    const upgraded=openDatabase(path);
    try {
      const row=upgraded.prepare('SELECT before_json,after_json FROM expense_changes').get() as {before_json:string;after_json:string};
      expect(isExpense(JSON.parse(row.before_json))).toBe(true);expect(isExpense(JSON.parse(row.after_json))).toBe(true);
      expect(JSON.parse(row.after_json)).toMatchObject({amount:12000,unapprovedAmount:12000,approvalId:null});
      expect(upgraded.prepare('SELECT request_id,amount,approval_id FROM expenses').get()).toEqual({request_id:'old-request-001',amount:12000,approval_id:null});
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);
    } finally {upgraded.close();}
  } finally {rmSync(directory,{recursive:true,force:true});}
});
