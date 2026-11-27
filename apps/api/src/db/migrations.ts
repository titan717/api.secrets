import type { Db } from "./index.js";

/** Plain SQL migrations. Append only; each runs once, in order, at boot. */
export const migrations: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  about text NOT NULL DEFAULT '',
  avatar_url text,
  accent text,
  is_bot boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  device_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS docks (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  icon_url text,
  visibility text NOT NULL DEFAULT 'public',
  owner_id uuid NOT NULL REFERENCES users(id),
  invite_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dock_members (
  dock_id uuid NOT NULL REFERENCES docks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dock_id, user_id)
);
CREATE INDEX IF NOT EXISTS dock_members_user_idx ON dock_members(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  title text,
  avatar_url text,
  dock_id uuid REFERENCES docks(id) ON DELETE CASCADE,
  dm_key text UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz
);
CREATE INDEX IF NOT EXISTS conversations_dock_idx ON conversations(dock_id);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  dock_id uuid NOT NULL REFERENCES docks(id) ON DELETE CASCADE,
  name text NOT NULL,
  topic text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_dock_name_idx ON channels(dock_id, name);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  seq bigserial UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  ciphertext text NOT NULL,
  nonce text,
  client_msg_id text NOT NULL,
  reply_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX IF NOT EXISTS messages_conv_seq_idx ON messages(conversation_id, seq DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at);
CREATE INDEX IF NOT EXISTS messages_updated_idx ON messages(updated_at);

CREATE TABLE IF NOT EXISTS reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS read_state (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id uuid,
  last_read_seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime text NOT NULL,
  size integer NOT NULL,
  width integer,
  height integer,
  name text,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: "002_pins",
    sql: `
CREATE TABLE IF NOT EXISTS pins (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
`,
  },
];

export async function migrate(db: Db, log: (m: string) => void): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  await db.tx(async (q) => {
    // Guard against concurrent boots on shared Postgres (released at COMMIT).
    if (db.kind === "postgres") await q.query("SELECT pg_advisory_xact_lock(717001)");
    const done = new Set((await q.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      for (const stmt of splitSql(m.sql)) await q.query(stmt);
      await q.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
      log(`migration applied: ${m.id}`);
    }
  });
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
