import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let dbInstance: Database.Database | null = null;

// Resolve database path relative to project root
// This ensures the correct database is used even when running from .next/standalone
const projectRoot = process.env.PROJECT_ROOT || (process.cwd().includes('.next/standalone')
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd());
const defaultDbPath = process.env.DATABASE_PATH || path.join(projectRoot, 'data', 'database', 'openmaic.db');

export interface DatabaseConfig {
  path?: string;
  enableWAL?: boolean;
  verbose?: boolean;
}

export function createDatabase(config: DatabaseConfig = {}): Database.Database {
  const dbPath = config.path || defaultDbPath;

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const options: Database.Options = {};
  if (config.verbose) {
    options.verbose = console.log;
  }

  const db = new Database(dbPath, options);

  if (config.enableWAL !== false) {
    db.pragma('journal_mode = WAL');
  }

  db.pragma('foreign_keys = ON');

  return db;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    dbInstance = createDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function initializeSchema(db?: Database.Database): void {
  const database = db || getDatabase();
  const schemaPath = path.join(projectRoot, 'server', 'database', 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schema);
}

export function resetDatabase(): void {
  closeDatabase();
  if (fs.existsSync(defaultDbPath)) {
    fs.unlinkSync(defaultDbPath);
  }
  initializeSchema();
}

export function withTransaction<T>(fn: () => T): T {
  const db = getDatabase();
  return db.transaction(fn)();
}
