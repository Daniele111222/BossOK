CREATE TABLE approvals (
 id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES relationships(id), user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, input TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 category TEXT NOT NULL, spent_on TEXT NOT NULL, purpose TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL, opinion TEXT NOT NULL DEFAULT '', daily_over INTEGER NOT NULL, monthly_over INTEGER NOT NULL,
 created_at INTEGER NOT NULL, approved_at INTEGER, expired_from TEXT,
 UNIQUE(user_id,request_id)
) STRICT;
CREATE INDEX approval_month ON approvals(relationship_id,spent_on,created_at);
CREATE TABLE approval_events (
 id INTEGER PRIMARY KEY, approval_id TEXT NOT NULL REFERENCES approvals(id), actor_id TEXT REFERENCES users(id),
 request_id TEXT, input TEXT, action TEXT NOT NULL, opinion TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(actor_id,request_id)
) STRICT;
CREATE TABLE messages (
 id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(id), approval_id TEXT NOT NULL REFERENCES approvals(id),
 title TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX message_recipient ON messages(recipient_id,created_at,id);
