CREATE TABLE budget_versions (
 id INTEGER PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES relationships(id),
 kind TEXT NOT NULL CHECK(kind IN ('daily','monthly')), amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000),
 categories TEXT NOT NULL, effective_date TEXT NOT NULL, reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX budget_lookup ON budget_versions(relationship_id,kind,effective_date,id);
