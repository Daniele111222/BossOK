-- 初始化身份表；注册、密码哈希与会话将在身份模块中实现。
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
