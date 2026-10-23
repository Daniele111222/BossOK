ALTER TABLE approvals ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase' CHECK(kind IN ('purchase','supplement'));
ALTER TABLE approvals ADD COLUMN expense_id TEXT REFERENCES expenses(id);
ALTER TABLE approvals ADD COLUMN expense_version INTEGER;
ALTER TABLE expenses ADD COLUMN approval_id TEXT REFERENCES approvals(id);
CREATE UNIQUE INDEX expense_approval ON expenses(approval_id) WHERE approval_id IS NOT NULL;
CREATE TABLE approval_credits (
 approval_id TEXT PRIMARY KEY REFERENCES approvals(id), expense_id TEXT NOT NULL REFERENCES expenses(id),
 amount INTEGER NOT NULL CHECK(amount>=0), spent_on TEXT NOT NULL
) STRICT;
CREATE INDEX credit_expense ON approval_credits(expense_id);
CREATE UNIQUE INDEX pending_supplement ON approvals(expense_id) WHERE kind='supplement' AND status='pending';
UPDATE expense_changes SET
 before_json=json_set(before_json,'$.approvalId',NULL,'$.unapprovedAmount',CASE WHEN json_extract(before_json,'$.deletedAt') IS NULL AND json_extract(before_json,'$.unapproved')=1 THEN json_extract(before_json,'$.amount') ELSE 0 END),
 after_json=json_set(after_json,'$.approvalId',NULL,'$.unapprovedAmount',CASE WHEN json_extract(after_json,'$.deletedAt') IS NULL AND json_extract(after_json,'$.unapproved')=1 THEN json_extract(after_json,'$.amount') ELSE 0 END);
