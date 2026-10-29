ALTER TABLE messages RENAME TO messages_legacy;
CREATE TABLE messages (
 id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(id), approval_id TEXT REFERENCES approvals(id),
 kind TEXT NOT NULL CHECK(kind IN ('approval','budget')), title TEXT NOT NULL, created_at INTEGER NOT NULL,
 scope TEXT CHECK(scope IN ('daily','monthly')), period TEXT, threshold INTEGER CHECK(threshold IN (80,100)), read_at INTEGER
) STRICT;
INSERT INTO messages(id,recipient_id,approval_id,kind,title,created_at) SELECT id,recipient_id,approval_id,'approval',title,created_at FROM messages_legacy;
DROP TABLE messages_legacy;
CREATE INDEX message_recipient ON messages(recipient_id,created_at,id);
CREATE TABLE notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),push_enabled INTEGER NOT NULL CHECK(push_enabled IN (0,1))) STRICT;
CREATE TABLE notification_thresholds(user_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,period TEXT NOT NULL,level INTEGER NOT NULL,PRIMARY KEY(user_id,scope,period)) STRICT;
CREATE TABLE push_devices (
 cid TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
) STRICT;
CREATE TABLE push_deliveries (
 id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id),cid TEXT NOT NULL REFERENCES push_devices(cid) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','failed','skipped')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,last_error TEXT,
 UNIQUE(message_id,cid)
) STRICT;
CREATE INDEX push_pending ON push_deliveries(status,next_attempt_at);
