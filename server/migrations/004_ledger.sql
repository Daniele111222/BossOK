CREATE TABLE expenses (
 id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES relationships(id), user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 100000000), category TEXT NOT NULL,
 spent_on TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL,
 budget_applicable INTEGER NOT NULL CHECK(budget_applicable IN (0,1)),
 unapproved INTEGER NOT NULL CHECK(unapproved IN (0,1)),
 UNIQUE(user_id,request_id)
) STRICT;
CREATE INDEX expense_month ON expenses(relationship_id,spent_on,id);
