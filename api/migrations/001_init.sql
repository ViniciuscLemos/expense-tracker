CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email));

-- only a hash of the token is kept: someone reading this table can't log in as anybody
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('expense', 'income')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  -- how much the person wants to spend at most in a month, if they set it
  budget_cents bigint CHECK (budget_cents > 0),
  archived boolean NOT NULL DEFAULT false,
  -- the entries' foreign key points here, so an entry can only use a category of the same
  -- person and of the same kind (no "Salary" on an expense)
  UNIQUE (id, user_id, kind)
);
CREATE UNIQUE INDEX categories_name ON categories (user_id, kind, lower(name));

CREATE TABLE entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL,
  category_id bigint NOT NULL,
  -- money in cents, like in the browser version: no 0.1 + 0.2 surprises
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents < 100000000000),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- the id an entry had in a backup of the browser version, so importing twice adds nothing
  source_id text,
  FOREIGN KEY (category_id, user_id, kind) REFERENCES categories (id, user_id, kind)
);
-- the list and the month totals both read "this person's entries between two days"
CREATE INDEX entries_user_day ON entries (user_id, day DESC, id DESC);
CREATE INDEX entries_category ON entries (category_id);
CREATE UNIQUE INDEX entries_source ON entries (user_id, source_id) WHERE source_id IS NOT NULL;
