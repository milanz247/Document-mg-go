import assert from 'node:assert/strict'
import { scryptSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../src/server/index.js'

const testPassword = 'correct-horse-battery-staple'

async function editingHeaders(app: FastifyInstance, username = 'admin', password = testPassword): Promise<Record<string, string>> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { username, password } })
  assert.equal(response.statusCode, 200)
  const setCookie = response.headers['set-cookie']
  assert.equal(typeof setCookie, 'string')
  return {
    cookie: (setCookie as string).split(';', 1)[0],
    'x-csrf-token': response.json().csrfToken,
  }
}

test('document, folder, navigation and search APIs use SQLite', async (context) => {
  const app = createServer({ databasePath: ':memory:', adminPassword: testPassword })
  context.after(() => app.close())

  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/folders', payload: { path: 'Engineering' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { password: 'incorrect-password' } })).statusCode, 401)
  const headers = await editingHeaders(app)
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { path: 'Engineering' } })).statusCode, 201)

  const created = await app.inject({
    method: 'POST',
    url: '/api/documents',
    headers,
    payload: { path: 'Engineering/overview.md', markdown: '# Engineering Overview\n\nFastify runbook.', tags: ['platform', 'runbook'] },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().title, 'Engineering Overview')

  const navigation = (await app.inject({ method: 'GET', url: '/api/navigation' })).json()
  assert.equal(navigation[0].path, 'Engineering')
  assert.equal(navigation[0].children[0].path, 'Engineering/overview.md')

  const search = (await app.inject({ method: 'GET', url: '/api/search?q=fastify&tag=runbook' })).json()
  assert.equal(search[0].path, 'Engineering/overview.md')
})

test('documents, folders and assets support the full editing lifecycle', async (context) => {
  const app = createServer({ databasePath: ':memory:', adminPassword: testPassword })
  context.after(() => app.close())
  const headers = await editingHeaders(app)

  await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { path: 'Guides' } })
  await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { path: 'Archive' } })
  await app.inject({ method: 'POST', url: '/api/documents', headers, payload: { path: 'Guides/start.md', markdown: '# Start', tags: [] } })

  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/assets/upload?document=Guides%2Fstart.md&filename=diagram.png&mime=image%2Fpng',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x66, 0x61, 0x6b, 0x65]),
  })
  assert.equal(uploaded.statusCode, 201)
  assert.equal(uploaded.json().markdown, '![diagram](assets/diagram.png)')

  const spoofed = await app.inject({
    method: 'POST',
    url: '/api/assets/upload?document=Guides%2Fstart.md&filename=spoofed.png&mime=image%2Fpng',
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: Buffer.from('not-a-png'),
  })
  assert.equal(spoofed.statusCode, 422)

  const asset = await app.inject({ method: 'GET', url: '/api/assets?path=Guides%2Fassets%2Fdiagram.png' })
  assert.equal(asset.statusCode, 200)
  assert.equal(Buffer.from(asset.rawPayload).subarray(8).toString(), 'fake')

  const moved = await app.inject({
    method: 'POST',
    url: '/api/move',
    headers,
    payload: { source: 'Guides/start.md', target: 'Archive/getting-started.md', type: 'document' },
  })
  assert.equal(moved.statusCode, 200)
  assert.equal(moved.json().path, 'Archive/getting-started.md')

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/document?path=Archive%2Fgetting-started.md', headers })).statusCode, 204)
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/folder?path=Archive', headers })).statusCode, 204)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/lock', headers })).statusCode, 204)
  assert.equal((await app.inject({ method: 'POST', url: '/api/folders', headers, payload: { path: 'Locked' } })).statusCode, 401)
})

test('backlinks and broken links are calculated without N+1 database queries', async (context) => {
  const app = createServer({ databasePath: ':memory:', adminPassword: testPassword })
  context.after(() => app.close())
  const headers = await editingHeaders(app)

  await app.inject({ method: 'POST', url: '/api/documents', headers, payload: { path: 'index.md', markdown: '# Home\n\n[Guide](guide.md)\n[Missing](missing.md)', tags: [] } })
  await app.inject({ method: 'POST', url: '/api/documents', headers, payload: { path: 'guide.md', markdown: '# Guide\n\n[Home](index.md)', tags: [] } })

  const insights = (await app.inject({ method: 'GET', url: '/api/insights?path=index.md' })).json()
  assert.equal(insights.backlinks[0].path, 'guide.md')
  assert.deepEqual(insights.brokenLinks, [{ target: 'missing.md', kind: 'document' }])
})

test('frontend routes return the embedded Vue shell', async (context) => {
  const app = createServer({ databasePath: ':memory:', adminPassword: testPassword })
  context.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/docs' })
  assert.equal(response.statusCode, 200)
  assert.match(response.body, /Atlas Wiki/u)
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/u)
})

test('accounts, roles, conflicts, revisions and trash protect collaborative editing', async (context) => {
  const app = createServer({ databasePath: ':memory:', adminPassword: testPassword })
  context.after(() => app.close())
  const admin = await editingHeaders(app)

  assert.equal((await app.inject({ method: 'POST', url: '/api/users', headers: admin, payload: { username: 'writer', password: 'writer-password-123', role: 'editor' } })).statusCode, 201)
  assert.equal((await app.inject({ method: 'POST', url: '/api/users', headers: admin, payload: { username: 'reader', password: 'reader-password-123', role: 'viewer' } })).statusCode, 201)
  const viewer = await editingHeaders(app, 'reader', 'reader-password-123')
  assert.equal((await app.inject({ method: 'POST', url: '/api/documents', headers: viewer, payload: { path: 'private.md', markdown: '# No', tags: [] } })).statusCode, 403)

  const editor = await editingHeaders(app, 'writer', 'writer-password-123')
  const created = await app.inject({ method: 'POST', url: '/api/documents', headers: editor, payload: { path: 'shared.md', markdown: '# First', tags: [] } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.json().version, 1)
  const updated = await app.inject({ method: 'PUT', url: '/api/document', headers: editor, payload: { path: 'shared.md', markdown: '# Second', tags: [], version: 1 } })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().version, 2)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/document', headers: editor, payload: { path: 'shared.md', markdown: '# Stale', tags: [], version: 1 } })).statusCode, 409)

  const revisions = await app.inject({ method: 'GET', url: '/api/revisions?path=shared.md', headers: editor })
  assert.deepEqual(revisions.json().map((item: { version: number }) => item.version), [2, 1])
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/document?path=shared.md', headers: editor })).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: '/api/document?path=shared.md' })).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: '/api/trash', headers: editor })).json()[0].path, 'shared.md')
  assert.equal((await app.inject({ method: 'POST', url: '/api/trash/restore', headers: editor, payload: { path: 'shared.md' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: '/api/document?path=shared.md' })).json().title, 'Second')
})

test('existing single-password databases migrate without losing access or pages', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-migration-'))
  const databasePath = join(directory, 'legacy.sqlite')
  const database = new DatabaseSync(databasePath)
  const salt = Buffer.alloc(16, 7)
  database.exec(`
    CREATE TABLE auth_config (id INTEGER PRIMARY KEY, password_salt BLOB NOT NULL, password_hash BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL COLLATE NOCASE UNIQUE, title TEXT NOT NULL, markdown TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `)
  database.prepare('INSERT INTO auth_config (id, password_salt, password_hash) VALUES (1, ?, ?)').run(salt, scryptSync(testPassword, salt, 64))
  database.prepare('INSERT INTO documents (path, title, markdown, tags) VALUES (?, ?, ?, ?)').run('legacy.md', 'Legacy', '# Legacy', '[]')
  database.close()

  const app = createServer({ databasePath })
  context.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }) })
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { username: 'admin', password: testPassword } })).statusCode, 200)
  const document = (await app.inject({ method: 'GET', url: '/api/document?path=legacy.md' })).json()
  assert.equal(document.title, 'Legacy')
  assert.equal(document.version, 1)
})
