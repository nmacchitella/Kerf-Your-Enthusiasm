import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const dbPath = process.env.DATABASE_PATH || './data/app.db';

// Ensure the database file exists
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Seed a local dev user so all project/tool inserts have a valid user_id
try {
  sqlite.exec(`
    INSERT OR IGNORE INTO users (id, email, name, email_verified, created_at, updated_at)
    VALUES ('dev-local', 'dev@localhost', 'Dev', 1, unixepoch(), unixepoch())
  `);
} catch { /* table may not exist yet on first boot */ }

// Additive schema migrations — safe to run on every startup (errors are swallowed)
const migrations = [
  'ALTER TABLE projects ADD COLUMN units TEXT DEFAULT \'in\'',
  'ALTER TABLE projects ADD COLUMN layout_overrides TEXT DEFAULT \'{}\'',
  'ALTER TABLE projects ADD COLUMN layout_excluded_keys TEXT DEFAULT \'[]\'',
  'ALTER TABLE projects ADD COLUMN layout_padding REAL DEFAULT 0.5',
  'ALTER TABLE projects ADD COLUMN layout_has_active INTEGER DEFAULT 0',
  'ALTER TABLE projects ADD COLUMN step_active_file_id TEXT',
  'ALTER TABLE stocks ADD COLUMN thickness REAL DEFAULT 0',
  'ALTER TABLE cuts ADD COLUMN thickness REAL DEFAULT 0',
  'ALTER TABLE cuts ADD COLUMN step_file_id TEXT',
  'ALTER TABLE cuts ADD COLUMN step_session_id TEXT',
  'ALTER TABLE cuts ADD COLUMN step_body_index INTEGER',
  'ALTER TABLE cuts ADD COLUMN step_face_index INTEGER',
  "ALTER TABLE cuts ADD COLUMN group_name TEXT DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN group_multipliers TEXT DEFAULT '{}'",
  'ALTER TABLE accounts ADD COLUMN access_token_expires_at INTEGER',
  'ALTER TABLE accounts ADD COLUMN refresh_token_expires_at INTEGER',
  'ALTER TABLE accounts ADD COLUMN created_at INTEGER',
  'ALTER TABLE accounts ADD COLUMN updated_at INTEGER',
  'ALTER TABLE accounts ADD COLUMN password TEXT',
  'ALTER TABLE sessions ADD COLUMN updated_at INTEGER',
];
for (const sql of migrations) {
  try { sqlite.exec(sql); } catch { /* column already exists */ }
}

try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS project_step_files (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_hash TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      body_state TEXT DEFAULT '[]',
      selected_body_index INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
} catch {
  /* table may already exist */
}

export const db = drizzle(sqlite, { schema });
