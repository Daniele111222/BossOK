ALTER TABLE users ADD COLUMN role TEXT CHECK (role IN ('approver', 'applicant'));
CREATE UNIQUE INDEX users_role ON users(role) WHERE role IS NOT NULL;
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL) STRICT;
CREATE TABLE relationships (id TEXT PRIMARY KEY, approver_id TEXT NOT NULL UNIQUE REFERENCES users(id), applicant_id TEXT NOT NULL UNIQUE REFERENCES users(id)) STRICT;
CREATE TABLE invitations (token_hash TEXT PRIMARY KEY, approver_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1))) STRICT;
