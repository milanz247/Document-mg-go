import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { loadEnvFile } from 'node:process'
import { gunzipSync } from 'node:zlib'
import { embeddedAssets, type EmbeddedAsset } from '../generated/assets.js'
import { AuthError, AuthService, UnlockLimiter, type AuthRole, type StoredSession } from './auth.js'
import { WikiError, WikiRepository } from './wiki.js'

type ServerOptions = {
  databasePath: string
  adminPassword?: string
  adminUsername?: string
  sessionDurationMs?: number
  cookieSecure?: boolean
  logger?: boolean | { level: string }
}

const sessionCookieName = 'atlas_session'
const safeInlineMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const protectedMutations = new Set([
  'POST /api/auth/lock',
  'POST /api/documents',
  'PUT /api/document',
  'DELETE /api/document',
  'POST /api/folders',
  'DELETE /api/folder',
  'POST /api/move',
  'POST /api/assets/upload',
])

export function createServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 10 * 1024 * 1024 + 1024 })
  const wiki = new WikiRepository(options.databasePath)
  const auth = new AuthService(options.databasePath, options.adminPassword, options.sessionDurationMs ?? 12 * 60 * 60 * 1000, options.adminUsername)
  const unlockLimiter = new UnlockLimiter()
  const cookieSecure = options.cookieSecure ?? false

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
  app.addHook('onClose', (_instance, done) => {
    auth.close()
    wiki.close()
    done()
  })
  app.addHook('preHandler', async (request, reply) => {
    const routeKey = `${request.method} ${safePathname(request.url)}`
    if (!protectedMutations.has(routeKey)) return
    requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
  })
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
    return payload
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WikiError || error instanceof AuthError) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
    const validationError = error && typeof error === 'object' && 'validation' in error
    if (validationError || (statusCode !== undefined && statusCode >= 400 && statusCode < 500) || error instanceof URIError) {
      return reply.code(statusCode ?? 400).send({ error: error instanceof Error ? error.message : 'The request is invalid.' })
    }
    app.log.error(error)
    return reply.code(500).send({ error: 'The request could not be completed.' })
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.post('/api/auth/unlock', async (request, reply) => {
    const body = objectBody(request.body)
    const username = stringBody(body.username ?? 'admin')
    const limitKey = `${request.ip}:${username.toLocaleLowerCase()}`
    const retryAfter = unlockLimiter.retryAfter(limitKey)
    if (retryAfter > 0) {
      reply.header('Retry-After', retryAfter)
      throw new WikiError(429, 'Too many unlock attempts. Try again later.')
    }
    const password = stringBody(body.password, true)
    const session = auth.unlock(username, password)
    if (!session) {
      unlockLimiter.failure(limitKey)
      throw new WikiError(401, 'Invalid username or password.')
    }
    unlockLimiter.success(limitKey)
    setSessionCookie(reply, session.token, session.expiresAt, cookieSecure)
    return { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() }
  })
  app.get('/api/auth/me', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, undefined, reply, auth, cookieSecure, false)
    return { user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() }
  })
  app.post('/api/auth/lock', async (request, reply) => {
    auth.lock(cookieValue(request.headers.cookie, sessionCookieName))
    clearSessionCookie(reply, cookieSecure)
    return reply.code(204).send()
  })
  app.post('/api/auth/password', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure)
    const body = objectBody(request.body)
    auth.changePassword(session.user.id, stringBody(body.currentPassword, true), stringBody(body.newPassword, true))
    clearSessionCookie(reply, cookieSecure)
    return reply.code(204).send()
  })
  app.get('/api/users', async (request, reply) => {
    requireEditingSession(request.headers.cookie, undefined, reply, auth, cookieSecure, false, ['admin'])
    return auth.users()
  })
  app.post('/api/users', async (request, reply) => {
    requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin'])
    const body = objectBody(request.body)
    return reply.code(201).send(auth.createUser(stringBody(body.username), stringBody(body.password, true), stringBody(body.role)))
  })
  app.delete('/api/users', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin'])
    auth.deleteUser(stringQuery((request.query as { username?: string }).username), session.user.id)
    return reply.code(204).send()
  })
  app.get('/api/navigation', async () => wiki.navigation())
  app.get('/api/search', async (request) => {
    const query = request.query as { q?: string; tag?: string | string[] }
    return wiki.search(query.q ?? '', arrayQuery(query.tag))
  })
  app.get('/api/document', async (request) => wiki.document(stringQuery((request.query as { path?: string }).path)))
  app.get('/api/insights', async (request) => wiki.insights(stringQuery((request.query as { path?: string }).path)))
  app.get('/api/assets', async (request, reply) => {
    const asset = wiki.asset(stringQuery((request.query as { path?: string }).path))
    reply.type(asset.mime_type || contentTypeFor(asset.original_name))
    reply.header('Content-Disposition', `${safeInlineMimeTypes.has(asset.mime_type ?? '') ? 'inline' : 'attachment'}; filename="${asset.original_name.replaceAll('"', '')}"`)
    reply.header('Cache-Control', 'public, max-age=3600')
    return reply.send(Buffer.from(asset.data))
  })

  app.post('/api/documents', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    const body = objectBody(request.body)
    const document = wiki.createDocument({ path: stringBody(body.path), markdown: stringBody(body.markdown, true), tags: stringArray(body.tags) }, session.user.username)
    return reply.code(201).send(document)
  })
  app.put('/api/document', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    const body = objectBody(request.body)
    return wiki.updateDocument({ path: stringBody(body.path), markdown: stringBody(body.markdown, true), tags: stringArray(body.tags), version: optionalInteger(body.version) }, session.user.username)
  })
  app.delete('/api/document', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    wiki.deleteDocument(stringQuery((request.query as { path?: string }).path), session.user.username)
    return reply.code(204).send()
  })
  app.get('/api/revisions', async (request, reply) => {
    requireEditingSession(request.headers.cookie, undefined, reply, auth, cookieSecure, false, ['admin', 'editor'])
    return wiki.revisions(stringQuery((request.query as { path?: string }).path))
  })
  app.post('/api/revisions/restore', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    const body = objectBody(request.body)
    return wiki.restoreRevision(stringBody(body.path), requiredInteger(body.revisionId), session.user.username)
  })
  app.get('/api/trash', async (request, reply) => {
    requireEditingSession(request.headers.cookie, undefined, reply, auth, cookieSecure, false, ['admin', 'editor'])
    return wiki.trash()
  })
  app.post('/api/trash/restore', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    return wiki.restoreDeleted(stringBody(objectBody(request.body).path), session.user.username)
  })
  app.delete('/api/trash', async (request, reply) => {
    requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin'])
    wiki.purgeDeleted(stringQuery((request.query as { path?: string }).path))
    return reply.code(204).send()
  })
  app.post('/api/folders', async (request, reply) => {
    const folder = wiki.createFolder(stringBody(objectBody(request.body).path))
    return reply.code(201).send(folder)
  })
  app.delete('/api/folder', async (request, reply) => {
    wiki.deleteFolder(stringQuery((request.query as { path?: string }).path))
    return reply.code(204).send()
  })
  app.post('/api/move', async (request, reply) => {
    const session = requireEditingSession(request.headers.cookie, request.headers['x-csrf-token'], reply, auth, cookieSecure, true, ['admin', 'editor'])
    const body = objectBody(request.body)
    const type = body.type === 'document' || body.type === 'folder' ? body.type : null
    if (!type) throw new WikiError(422, 'Move type must be document or folder.')
    return wiki.move(stringBody(body.source), stringBody(body.target), type, session.user.username)
  })
  app.post('/api/assets/upload', async (request, reply) => {
    const query = request.query as { document?: string; filename?: string; mime?: string }
    if (!Buffer.isBuffer(request.body)) throw new WikiError(422, 'The upload body is invalid.')
    const uploaded = wiki.uploadAsset(stringQuery(query.document), stringQuery(query.filename), query.mime, request.body)
    return reply.code(201).send(uploaded)
  })

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'API route not found.' })
    const pathname = safePathname(request.url)
    const asset = embeddedAssets[pathname] ?? embeddedAssets['/index.html']
    if (!asset) return reply.code(503).send('Frontend assets have not been built.')
    return sendEmbeddedAsset(
      reply,
      pathname in embeddedAssets ? pathname : '/index.html',
      asset,
      request.headers['accept-encoding'],
    )
  })

  return app
}

function sendEmbeddedAsset(reply: FastifyReply, path: string, asset: EmbeddedAsset, acceptEncoding?: string) {
  reply.type(asset.contentType)
  const body = Buffer.from(asset.body, 'base64')
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:;|,|$)/iu.test(acceptEncoding ?? '')
  if (asset.contentEncoding) reply.header('Vary', 'Accept-Encoding')
  if (asset.contentEncoding && acceptsGzip) reply.header('Content-Encoding', asset.contentEncoding)
  reply.header('Cache-Control', path === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
  return reply.send(asset.contentEncoding && !acceptsGzip ? gunzipSync(body) : body)
}

function safePathname(url: string): string {
  try { return new URL(url, 'http://localhost').pathname } catch { return '/' }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WikiError(422, 'A JSON object is required.')
  return value as Record<string, unknown>
}

function stringBody(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new WikiError(422, 'A required text value is missing.')
  return value
}

function stringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new WikiError(422, 'Tags must be a list of text values.')
  return value
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined
  return requiredInteger(value)
}

function requiredInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new WikiError(422, 'A positive integer is required.')
  return value
}

function stringQuery(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new WikiError(422, 'A required query value is missing.')
  return value
}

function arrayQuery(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function contentTypeFor(filename: string): string {
  const extension = filename.split('.').pop()?.toLocaleLowerCase()
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json',
    yaml: 'application/yaml', yml: 'application/yaml', zip: 'application/zip',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
}

async function start(): Promise<void> {
  try { loadEnvFile() } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const host = process.env.HOST || '127.0.0.1'
  const port = Number.parseInt(process.env.PORT || '8000', 10)
  const databasePath = process.env.DATABASE_PATH || './data/atlas.sqlite'
  const logLevel = process.env.LOG_LEVEL || 'warn'
  const sessionHours = Number.parseFloat(process.env.SESSION_DURATION_HOURS || '12')
  const app = createServer({
    databasePath,
    adminPassword: process.env.ADMIN_PASSWORD,
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    sessionDurationMs: Number.isFinite(sessionHours) && sessionHours > 0 ? sessionHours * 60 * 60 * 1000 : 12 * 60 * 60 * 1000,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    logger: { level: logLevel },
  })
  await app.listen({ host, port })

  let closing = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'Shutting down Atlas Wiki')
    void app.close().catch((error) => {
      app.log.error(error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

function requireEditingSession(
  cookieHeader: string | undefined,
  csrfHeader: string | string[] | undefined,
  reply: FastifyReply,
  auth: AuthService,
  cookieSecure: boolean,
  requireCsrf = true,
  roles: AuthRole[] = ['admin', 'editor', 'viewer'],
): StoredSession {
  const token = cookieValue(cookieHeader, sessionCookieName)
  const session = auth.authenticate(token)
  if (!session) {
    clearSessionCookie(reply, cookieSecure)
    throw new WikiError(401, 'Authentication required.')
  }
  if (!roles.includes(session.user.role)) throw new WikiError(403, 'Your account does not have permission to perform this action.')
  const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] ?? '' : csrfHeader ?? ''
  if (requireCsrf && !auth.validateCsrf(session, csrfToken)) throw new WikiError(403, 'Invalid security token.')
  return session
}

function cookieValue(header: string | undefined, name: string): string {
  if (!header) return ''
  for (const cookie of header.split(';')) {
    const separator = cookie.indexOf('=')
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue
    return cookie.slice(separator + 1).trim()
  }
  return ''
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean): void {
  const maximumAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  reply.header('Set-Cookie', `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maximumAge}; Expires=${expiresAt.toUTCString()}${secure ? '; Secure' : ''}`)
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.header('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`)
}

const entry = (process.argv[1] ?? '').replaceAll('\\', '/')
if (entry.endsWith('/src/server/index.ts') || entry.endsWith('/dist/server.cjs')) {
  start().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
