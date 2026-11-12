-- Money put aside for something: a trip, a laptop, a cushion for bad months.
CREATE TABLE goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  target_cents bigint NOT NULL CHECK (target_cents > 0 AND target_cents < 100000000000),
  -- the month it should be there by (its first day), or no date at all
  by_month date CHECK (by_month IS NULL OR extract(day FROM by_month) = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX goals_user ON goals (user_id);

-- every time money goes in or comes out of a goal. What's saved is the sum, so the
-- history is there to read and nothing can drift away from it
CREATE TABLE goal_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  goal_id bigint NOT NULL,
  user_id bigint NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0 AND abs(amount_cents) < 100000000000),
  day date NOT NULL,
  FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id) ON DELETE CASCADE
);
CREATE INDEX goal_moves_goal ON goal_moves (goal_id, day);
