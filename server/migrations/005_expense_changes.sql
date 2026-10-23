ALTER TABLE expenses ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN deleted_at INTEGER;
ALTER TABLE expenses ADD COLUMN original_input TEXT;
UPDATE expenses SET original_input=json_object('requestId',request_id,'amount',amount,'category',category,'spentOn',spent_on,'note',note);
CREATE TABLE expense_changes (
 id INTEGER PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id), user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('update','delete','refund')), input TEXT NOT NULL,
 reason TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 refund_amount INTEGER NOT NULL DEFAULT 0 CHECK(refund_amount>=0), refunded_on TEXT, created_at INTEGER NOT NULL,
 UNIQUE(user_id,request_id)
) STRICT;
CREATE INDEX expense_change_history ON expense_changes(expense_id,id);
