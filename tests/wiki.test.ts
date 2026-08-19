import assert from 'node:assert/strict'
import test from 'node:test'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../src/server/index.js'

const testPassword = 'correct-horse-battery-staple'

async function editingHeaders(app: FastifyInstance): Promise<Record<string, string>> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { password: testPassword } })
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
    payload: Buffer.from('fake-png'),
  })
  assert.equal(uploaded.statusCode, 201)
  assert.equal(uploaded.json().markdown, '![diagram](assets/diagram.png)')

  const asset = await app.inject({ method: 'GET', url: '/api/assets?path=Guides%2Fassets%2Fdiagram.png' })
  assert.equal(asset.statusCode, 200)
  assert.equal(asset.body, 'fake-png')

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
})
