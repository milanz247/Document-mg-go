import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type PasswordRow = {
  password_salt: Uint8Array
  password_hash: Uint8Array
}

type SessionRow = {
  csrf_token: string
  expires_at: number
}

export type AuthSession = {
  token: string
  csrfToken: string
  expiresAt: Date
  user: { username: string }
}

export type StoredSession = {
  csrfToken: string
  expiresAt: Date
  user: { username: string }
}

const passwordBytes = 64

export class AuthService {
  private readonly db: DatabaseSync

  constructor(databasePath: string, initialPassword: string | undefined, private readonly sessionDurationMs: number) {
    const absolutePath = databasePath === ':memory:' ? databasePath : resolve(databasePath)
    if (absolutePath !== ':memory:') mkdirSync(dirname(absolutePath), { recursive: true })
    this.db = new DatabaseSync(absolutePath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS auth_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_salt BLOB NOT NULL,
        password_hash BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_index ON auth_sessions(expires_at);
    `)
    this.bootstrap(initialPassword)
  }

  close(): void {
    this.db.close()
  }

  unlock(password: string): AuthSession | null {
    const row = this.db.prepare('SELECT password_salt, password_hash FROM auth_config WHERE id = 1').get() as PasswordRow | undefined
    if (!row) return null
    const candidate = derivePassword(password, Buffer.from(row.password_salt))
    const expected = Buffer.from(row.password_hash)
    if (candidate.byteLength !== expected.byteLength || !timingSafeEqual(candidate, expected)) return null

    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.sessionDurationMs)
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Date.now())
    this.db.prepare('INSERT INTO auth_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), csrfToken, expiresAt.getTime())
    return { token, csrfToken, expiresAt, user: { username: 'admin' } }
  }

  authenticate(token: string): StoredSession | null {
    if (!token) return null
    const row = this.db.prepare('SELECT csrf_token, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hashToken(token), Date.now()) as SessionRow | undefined
    if (!row) return null
    return { csrfToken: row.csrf_token, expiresAt: new Date(row.expires_at), user: { username: 'admin' } }
  }

  validateCsrf(session: StoredSession, provided: string): boolean {
    if (!provided) return false
    const expected = Buffer.from(hashToken(session.csrfToken), 'hex')
    const candidate = Buffer.from(hashToken(provided), 'hex')
    return expected.byteLength === candidate.byteLength && timingSafeEqual(expected, candidate)
  }

  lock(token: string): void {
    if (token) this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token))
  }

  private bootstrap(initialPassword: string | undefined): void {
    const configured = this.db.prepare('SELECT 1 AS configured FROM auth_config WHERE id = 1').get()
    if (configured) return
    const placeholder = /^(?:change|replace)-this/iu.test(initialPassword ?? '')
    if (!initialPassword || [...initialPassword].length < 12 || placeholder) {
      throw new Error('Set ADMIN_PASSWORD in .env to a private password containing at least 12 characters before initial setup.')
    }
    const salt = randomBytes(16)
    const hash = derivePassword(initialPassword, salt)
    this.db.prepare('INSERT INTO auth_config (id, password_salt, password_hash) VALUES (1, ?, ?)').run(salt, hash)
  }
}

type Attempt = { failures: number; windowExpires: number; blockedUntil: number }

export class UnlockLimiter {
  private readonly attempts = new Map<string, Attempt>()

  constructor(private readonly maximumFailures = 5, private readonly windowMs = 15 * 60 * 1000) {}

  retryAfter(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key)
    if (!attempt) return 0
    if (attempt.windowExpires <= now) {
      this.attempts.delete(key)
      return 0
    }
    if (attempt.blockedUntil <= now) return 0
    return Math.ceil((attempt.blockedUntil - now) / 1000)
  }

  failure(key: string, now = Date.now()): void {
    const current = this.attempts.get(key)
    const active = current && current.windowExpires > now
    const failures = (active ? current.failures : 0) + 1
    const windowExpires = active ? current.windowExpires : now + this.windowMs
    this.attempts.set(key, {
      failures,
      windowExpires,
      blockedUntil: failures >= this.maximumFailures ? windowExpires : 0,
    })
  }

  success(key: string): void {
    this.attempts.delete(key)
  }
}

function derivePassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, passwordBytes)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
