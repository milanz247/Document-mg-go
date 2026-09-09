import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type PasswordRow = { id: number; username: string; role: AuthRole; password_salt: Uint8Array; password_hash: Uint8Array }
type SessionRow = { user_id: number; username: string; role: AuthRole; csrf_token: string; expires_at: number }

export type AuthRole = 'admin' | 'editor' | 'viewer'
export type AuthUser = { id: number; username: string; role: AuthRole }
export type AuthSession = { token: string; csrfToken: string; expiresAt: Date; user: AuthUser }
export type StoredSession = Omit<AuthSession, 'token'>

const passwordBytes = 64

export class AuthService {
  private readonly db: DatabaseSync

  constructor(databasePath: string, initialPassword: string | undefined, private readonly sessionDurationMs: number, initialUsername = 'admin') {
    const absolutePath = databasePath === ':memory:' ? databasePath : resolve(databasePath)
    if (absolutePath !== ':memory:') mkdirSync(dirname(absolutePath), { recursive: true })
    this.db = new DatabaseSync(absolutePath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS auth_config (
        id INTEGER PRIMARY KEY CHECK (id = 1), password_salt BLOB NOT NULL,
        password_hash BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS auth_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
        password_salt BLOB NOT NULL, password_hash BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_index ON auth_sessions(expires_at);
    `)
    if (!hasColumn(this.db, 'auth_sessions', 'user_id')) {
      this.db.exec('ALTER TABLE auth_sessions ADD COLUMN user_id INTEGER')
      this.db.exec('DELETE FROM auth_sessions')
    }
    this.bootstrap(initialPassword, initialUsername)
  }

  close(): void { this.db.close() }

  unlock(usernameValue: string, password: string): AuthSession | null {
    const username = cleanUsername(usernameValue)
    if (password.length > 1024) return null
    const row = this.db.prepare('SELECT id, username, role, password_salt, password_hash FROM auth_users WHERE username = ?')
      .get(username) as PasswordRow | undefined
    if (!row) {
      derivePassword(password, Buffer.alloc(16))
      return null
    }
    const candidate = derivePassword(password, Buffer.from(row.password_salt))
    const expected = Buffer.from(row.password_hash)
    if (candidate.byteLength !== expected.byteLength || !timingSafeEqual(candidate, expected)) return null
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.sessionDurationMs)
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Date.now())
    this.db.prepare('INSERT INTO auth_sessions (token_hash, csrf_token, expires_at, user_id) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), csrfToken, expiresAt.getTime(), row.id)
    return { token, csrfToken, expiresAt, user: { id: row.id, username: row.username, role: row.role } }
  }

  authenticate(token: string): StoredSession | null {
    if (!token) return null
    const row = this.db.prepare(`SELECT s.user_id, u.username, u.role, s.csrf_token, s.expires_at
      FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), Date.now()) as SessionRow | undefined
    return row ? {
      csrfToken: row.csrf_token,
      expiresAt: new Date(row.expires_at),
      user: { id: row.user_id, username: row.username, role: row.role },
    } : null
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

  users(): AuthUser[] {
    return this.db.prepare('SELECT id, username, role FROM auth_users ORDER BY username COLLATE NOCASE').all() as AuthUser[]
  }

  createUser(usernameValue: string, password: string, roleValue: string): AuthUser {
    const username = cleanUsername(usernameValue)
    const role = cleanRole(roleValue)
    assertPassword(password)
    const salt = randomBytes(16)
    try {
      const result = this.db.prepare('INSERT INTO auth_users (username, role, password_salt, password_hash) VALUES (?, ?, ?, ?)')
        .run(username, role, salt, derivePassword(password, salt))
      return { id: Number(result.lastInsertRowid), username, role }
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AuthError(409, 'That username already exists.')
      throw error
    }
  }

  deleteUser(usernameValue: string, actorId: number): void {
    const username = cleanUsername(usernameValue)
    const row = this.db.prepare('SELECT id, role FROM auth_users WHERE username = ?').get(username) as { id: number; role: AuthRole } | undefined
    if (!row) throw new AuthError(404, 'User not found.')
    if (row.id === actorId) throw new AuthError(409, 'You cannot delete your own account.')
    if (row.role === 'admin') {
      const admins = this.db.prepare("SELECT count(*) AS count FROM auth_users WHERE role = 'admin'").get() as { count: number }
      if (admins.count <= 1) throw new AuthError(409, 'The final administrator cannot be deleted.')
    }
    this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.id)
    this.db.prepare('DELETE FROM auth_users WHERE id = ?').run(row.id)
  }

  changePassword(userId: number, currentPassword: string, newPassword: string): void {
    assertPassword(newPassword)
    const row = this.db.prepare('SELECT id, username, role, password_salt, password_hash FROM auth_users WHERE id = ?').get(userId) as PasswordRow | undefined
    if (!row) throw new AuthError(404, 'User not found.')
    const candidate = derivePassword(currentPassword, Buffer.from(row.password_salt))
    const expected = Buffer.from(row.password_hash)
    if (candidate.byteLength !== expected.byteLength || !timingSafeEqual(candidate, expected)) throw new AuthError(401, 'Current password is incorrect.')
    const salt = randomBytes(16)
    this.db.prepare('UPDATE auth_users SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(salt, derivePassword(newPassword, salt), userId)
    this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId)
  }

  private bootstrap(initialPassword: string | undefined, initialUsername: string): void {
    const users = this.db.prepare('SELECT count(*) AS count FROM auth_users').get() as { count: number }
    if (users.count > 0) return
    const legacy = this.db.prepare('SELECT password_salt, password_hash FROM auth_config WHERE id = 1').get() as { password_salt: Uint8Array; password_hash: Uint8Array } | undefined
    if (legacy) {
      this.db.prepare("INSERT INTO auth_users (username, role, password_salt, password_hash) VALUES (?, 'admin', ?, ?)")
        .run(cleanUsername(initialUsername), legacy.password_salt, legacy.password_hash)
      return
    }
    assertPassword(initialPassword ?? '')
    const salt = randomBytes(16)
    const hash = derivePassword(initialPassword!, salt)
    this.db.prepare("INSERT INTO auth_users (username, role, password_salt, password_hash) VALUES (?, 'admin', ?, ?)")
      .run(cleanUsername(initialUsername), salt, hash)
    this.db.prepare('INSERT INTO auth_config (id, password_salt, password_hash) VALUES (1, ?, ?)').run(salt, hash)
  }
}

export class AuthError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

type Attempt = { failures: number; windowExpires: number; blockedUntil: number }
export class UnlockLimiter {
  private readonly attempts = new Map<string, Attempt>()
  constructor(private readonly maximumFailures = 5, private readonly windowMs = 15 * 60 * 1000) {}
  retryAfter(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key)
    if (!attempt) return 0
    if (attempt.windowExpires <= now) { this.attempts.delete(key); return 0 }
    return attempt.blockedUntil > now ? Math.ceil((attempt.blockedUntil - now) / 1000) : 0
  }
  failure(key: string, now = Date.now()): void {
    const current = this.attempts.get(key)
    const active = current && current.windowExpires > now
    const failures = (active ? current.failures : 0) + 1
    const windowExpires = active ? current.windowExpires : now + this.windowMs
    this.attempts.set(key, { failures, windowExpires, blockedUntil: failures >= this.maximumFailures ? windowExpires : 0 })
  }
  success(key: string): void { this.attempts.delete(key) }
}

function cleanUsername(value: string): string {
  const username = value.trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,39}$/u.test(username)) {
    throw new AuthError(422, 'Username must be 3–40 characters and use letters, numbers, dots, dashes, or underscores.')
  }
  return username
}

function cleanRole(value: string): AuthRole {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value
  throw new AuthError(422, 'Role must be admin, editor, or viewer.')
}

function assertPassword(password: string): void {
  if ([...password].length < 12 || password.length > 1024 || /^(?:change|replace)-this/iu.test(password)) {
    throw new AuthError(422, 'Password must contain 12–1024 characters and must not be a placeholder.')
  }
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)
}

function derivePassword(password: string, salt: Buffer): Buffer { return scryptSync(password, salt, passwordBytes) }
function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex') }
