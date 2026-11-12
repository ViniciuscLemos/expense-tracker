-- Suggestions of "this looks like it comes every month" that the person said no to, so the
-- same one doesn't keep coming back. The key is the description, normalized, and the kind.
CREATE TABLE recurring_dismissed (
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 160),
  PRIMARY KEY (user_id, key)
);
