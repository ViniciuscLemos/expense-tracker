-- Paying for two: the dinner, the market, the rent with a flatmate. An expense can be half
-- someone else's; it still counts whole in the month (it left this pocket), and that half
-- is what they owe.
ALTER TABLE entries ADD COLUMN split_with text CHECK (length(split_with) BETWEEN 1 AND 40);
ALTER TABLE entries ADD CONSTRAINT entries_split_expense CHECK (split_with IS NULL OR kind = 'expense');

-- Everything else between two people: they paid for both (I owe half of it), they paid me
-- back, I paid them back. Signed like the balance: positive is what they owe me going up.
CREATE TABLE shared_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  with_name text NOT NULL CHECK (length(with_name) BETWEEN 1 AND 40),
  kind text NOT NULL CHECK (kind IN ('they_paid', 'they_paid_back', 'i_paid_back')),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0 AND abs(amount_cents) < 100000000000),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_moves_user ON shared_moves (user_id, lower(with_name), day DESC);
CREATE INDEX entries_split ON entries (user_id, lower(split_with)) WHERE split_with IS NOT NULL;
