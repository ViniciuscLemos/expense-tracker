-- Things that happen every month (rent, salary, the internet bill), written down once.
CREATE TABLE recurring (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL,
  category_id bigint NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents < 100000000000),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  -- the day it falls on; in a shorter month a 31 lands on the last day
  day_of_month smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  -- the next date to write down. Moving it forward when an entry is written (and not
  -- looking for "is there an entry this month?") means deleting one doesn't bring it back
  next_day date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (category_id, user_id, kind) REFERENCES categories (id, user_id, kind)
);
CREATE INDEX recurring_due ON recurring (user_id, next_day) WHERE active;

-- the entries it wrote; stopping a recurring one keeps them, just without the link
ALTER TABLE entries ADD COLUMN recurring_id bigint REFERENCES recurring ON DELETE SET NULL;
