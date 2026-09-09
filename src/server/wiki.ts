import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type NavigationNode = {
  name: string
  type: 'folder' | 'document'
  path: string
  tags?: string[]
  children?: NavigationNode[]
}

export type DocumentPayload = {
  path: string
  title: string
  tags: string[]
  markdown: string
  headings: Array<{ level: number; text: string }>
  version: number
  updatedAt: string
}

export type RevisionPayload = {
  id: number
  version: number
  path: string
  reason: string
  createdBy: string
  createdAt: string
}

type DocumentRow = { id: number; path: string; title: string; markdown: string; tags: string; version: number; updated_at: string; deleted_at: string | null }
type AssetRow = { id: number; document_id: number; path: string; original_name: string; mime_type: string | null; size: number; data: Uint8Array }

const assetExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'csv', 'json', 'yaml', 'yml', 'zip'])
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export class WikiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
  }
}

export class WikiRepository {
  private readonly db: DatabaseSync

  constructor(databasePath: string) {
    const absolutePath = databasePath === ':memory:' ? databasePath : resolve(databasePath)
    if (absolutePath !== ':memory:') mkdirSync(dirname(absolutePath), { recursive: true })
    this.db = new DatabaseSync(absolutePath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS documents_title_index ON documents(title COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        path TEXT NOT NULL COLLATE NOCASE UNIQUE,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS document_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        tags TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, version)
      );

      CREATE INDEX IF NOT EXISTS document_revisions_document_index
        ON document_revisions(document_id, version DESC);
    `)
    if (!hasColumn(this.db, 'documents', 'version')) this.db.exec('ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
    if (!hasColumn(this.db, 'documents', 'deleted_at')) this.db.exec('ALTER TABLE documents ADD COLUMN deleted_at TEXT')
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        path, title, markdown, tags, content='documents', content_rowid='id', tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, path, title, markdown, tags) VALUES (new.id, new.path, new.title, new.markdown, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, path, title, markdown, tags) VALUES ('delete', old.id, old.path, old.title, old.markdown, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE OF path, title, markdown, tags ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, path, title, markdown, tags) VALUES ('delete', old.id, old.path, old.title, old.markdown, old.tags);
        INSERT INTO documents_fts(rowid, path, title, markdown, tags) VALUES (new.id, new.path, new.title, new.markdown, new.tags);
      END;
    `)
    const indexed = this.db.prepare('SELECT count(*) AS count FROM documents_fts').get() as { count: number }
    const documents = this.db.prepare('SELECT count(*) AS count FROM documents').get() as { count: number }
    if (indexed.count !== documents.count) this.db.exec("INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')")
    this.seedMissingRevisions()
  }

  close(): void {
    this.db.close()
  }

  navigation(): NavigationNode[] {
    const folders = this.db.prepare('SELECT path FROM folders ORDER BY path COLLATE NOCASE').all() as Array<{ path: string }>
    const documents = this.db.prepare('SELECT id, path, title, markdown, tags, version, updated_at, deleted_at FROM documents WHERE deleted_at IS NULL ORDER BY path COLLATE NOCASE').all() as unknown as DocumentRow[]
    const roots: NavigationNode[] = []
    const folderNodes = new Map<string, NavigationNode>()
    const ensureFolder = (path: string): NavigationNode => {
      const key = path.toLocaleLowerCase()
      const existing = folderNodes.get(key)
      if (existing) return existing
      const node: NavigationNode = { name: path.split('/').pop() ?? path, type: 'folder', path, children: [] }
      folderNodes.set(key, node)
      const parent = parentPath(path)
      if (parent) ensureFolder(parent).children?.push(node)
      else roots.push(node)
      return node
    }
    for (const folder of folders) ensureFolder(folder.path)
    for (const document of documents) {
      const node: NavigationNode = {
        name: (document.path.split('/').pop() ?? document.path).replace(/\.md$/i, ''),
        type: 'document',
        path: document.path,
        tags: parseTags(document.tags),
      }
      const parent = parentPath(document.path)
      if (parent) ensureFolder(parent).children?.push(node)
      else roots.push(node)
    }
    return this.sortNodes(roots)
  }

  search(termValue: string, tagValues: string[]): Array<{ path: string; title: string; excerpt: string; tags: string[]; score: number }> {
    const term = termValue.trim().toLocaleLowerCase()
    const tags = cleanTags(tagValues)
    const ftsQuery = ftsSearchQuery(term)
    const rows = (ftsQuery
      ? this.db.prepare(`SELECT d.id, d.path, d.title, d.markdown, d.tags, d.version, d.updated_at, d.deleted_at
          FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
          WHERE documents_fts MATCH ? AND d.deleted_at IS NULL
          ORDER BY bm25(documents_fts, 2.0, 4.0, 1.0, 1.0) LIMIT 200`).all(ftsQuery)
      : this.db.prepare('SELECT id, path, title, markdown, tags, version, updated_at, deleted_at FROM documents WHERE deleted_at IS NULL LIMIT 200').all()) as unknown as DocumentRow[]

    return rows.map((row) => ({ row, tags: parseTags(row.tags) }))
      .filter((item) => tags.every((tag) => item.tags.some((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase())))
      .map(({ row, tags: rowTags }) => {
        const haystack = `${row.path} ${row.title} ${row.markdown}`.toLocaleLowerCase()
        return {
          path: row.path,
          title: row.title,
          excerpt: excerpt(row.markdown, term),
          tags: rowTags,
          score: term ? Math.max(1, haystack.split(term).length - 1) : 1,
        }
      })
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 50)
  }

  document(pathValue: string): DocumentPayload {
    const path = documentPath(pathValue)
    const row = this.findDocument(path)
    if (!row) throw new WikiError(404, 'Document not found.')
    return documentPayload(row)
  }

  createDocument(input: { path: string; markdown: string; tags?: string[] }, actor = 'system'): DocumentPayload {
    const path = documentPath(input.path)
    assertMarkdown(input.markdown)
    this.ensureParent(path)
    if (this.findDocument(path, true)) throw new WikiError(409, 'A document already exists at that path or is waiting in Trash.')
    this.db.prepare(`INSERT INTO documents (path, title, markdown, tags) VALUES (?, ?, ?, ?)`)
      .run(path, titleFromMarkdown(input.markdown, path), input.markdown, JSON.stringify(cleanTags(input.tags ?? [])))
    const document = this.findDocument(path)!
    this.saveRevision(document, 'created', actor)
    return documentPayload(document)
  }

  updateDocument(input: { path: string; markdown: string; tags?: string[]; version?: number }, actor = 'system'): DocumentPayload {
    const path = documentPath(input.path)
    assertMarkdown(input.markdown)
    const current = this.findDocument(path)
    if (!current) throw new WikiError(404, 'Document not found.')
    if (input.version !== undefined && input.version !== current.version) {
      throw new WikiError(409, 'This page was changed by another editor. Reload it before saving your changes.')
    }
    this.db.prepare(`UPDATE documents SET title = ?, markdown = ?, tags = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(titleFromMarkdown(input.markdown, path), input.markdown, JSON.stringify(cleanTags(input.tags ?? [])), current.id)
    const document = this.findDocument(path)!
    this.saveRevision(document, 'updated', actor)
    return documentPayload(document)
  }

  deleteDocument(pathValue: string, actor = 'system'): void {
    const path = documentPath(pathValue)
    const result = this.db.prepare("UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE path = ? AND deleted_at IS NULL").run(path)
    if (result.changes === 0) throw new WikiError(404, 'Document not found.')
    this.saveRevision(this.findDocument(path, true)!, 'deleted', actor)
  }

  trash(): Array<{ path: string; title: string; deletedAt: string }> {
    const rows = this.db.prepare('SELECT path, title, deleted_at FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as Array<{ path: string; title: string; deleted_at: string }>
    return rows.map((row) => ({ path: row.path, title: row.title, deletedAt: row.deleted_at }))
  }

  restoreDeleted(pathValue: string, actor = 'system'): DocumentPayload {
    const path = documentPath(pathValue)
    const current = this.findDocument(path, true)
    if (!current || !current.deleted_at) throw new WikiError(404, 'Deleted document not found.')
    this.db.prepare('UPDATE documents SET deleted_at = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(current.id)
    const restored = this.findDocument(path)!
    this.saveRevision(restored, 'restored from trash', actor)
    return documentPayload(restored)
  }

  purgeDeleted(pathValue: string): void {
    const path = documentPath(pathValue)
    const result = this.db.prepare('DELETE FROM documents WHERE path = ? AND deleted_at IS NOT NULL').run(path)
    if (result.changes === 0) throw new WikiError(404, 'Deleted document not found.')
  }

  revisions(pathValue: string): RevisionPayload[] {
    const document = this.findDocument(documentPath(pathValue), true)
    if (!document) throw new WikiError(404, 'Document not found.')
    const rows = this.db.prepare(`SELECT id, version, path, reason, created_by, created_at
      FROM document_revisions WHERE document_id = ? ORDER BY version DESC`).all(document.id) as Array<{ id: number; version: number; path: string; reason: string; created_by: string; created_at: string }>
    return rows.map((row) => ({ id: row.id, version: row.version, path: row.path, reason: row.reason, createdBy: row.created_by, createdAt: row.created_at }))
  }

  restoreRevision(pathValue: string, revisionId: number, actor = 'system'): DocumentPayload {
    const document = this.findDocument(documentPath(pathValue))
    if (!document) throw new WikiError(404, 'Document not found.')
    const revision = this.db.prepare('SELECT path, title, markdown, tags FROM document_revisions WHERE id = ? AND document_id = ?')
      .get(revisionId, document.id) as Pick<DocumentRow, 'path' | 'title' | 'markdown' | 'tags'> | undefined
    if (!revision) throw new WikiError(404, 'Revision not found.')
    this.db.prepare(`UPDATE documents SET title = ?, markdown = ?, tags = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(revision.title, revision.markdown, revision.tags, document.id)
    const restored = this.findDocument(document.path)!
    this.saveRevision(restored, `restored revision ${revisionId}`, actor)
    return documentPayload(restored)
  }

  createFolder(pathValue: string): { path: string } {
    const path = folderPath(pathValue)
    const parent = parentPath(path)
    if (parent && !this.folderExists(parent)) throw new WikiError(422, 'The parent folder does not exist.')
    if (this.folderExists(path)) throw new WikiError(409, 'That folder already exists.')
    this.db.prepare('INSERT INTO folders (path) VALUES (?)').run(path)
    return { path }
  }

  deleteFolder(pathValue: string): void {
    const path = folderPath(pathValue)
    if (!this.folderExists(path)) throw new WikiError(404, 'Folder not found.')
    const prefix = `${path}/`
    const nestedFolder = this.db.prepare('SELECT 1 FROM folders WHERE substr(path, 1, ?) = ? LIMIT 1').get(prefix.length, prefix)
    const nestedDocument = this.db.prepare('SELECT 1 FROM documents WHERE deleted_at IS NULL AND substr(path, 1, ?) = ? LIMIT 1').get(prefix.length, prefix)
    if (nestedFolder || nestedDocument) throw new WikiError(409, 'Only empty folders can be deleted.')
    this.db.prepare('DELETE FROM folders WHERE path = ?').run(path)
  }

  move(sourceValue: string, targetValue: string, type: 'document' | 'folder', actor = 'system'): DocumentPayload | { path: string } {
    return type === 'document' ? this.moveDocument(sourceValue, targetValue, actor) : this.moveFolder(sourceValue, targetValue, actor)
  }

  uploadAsset(documentValue: string, filenameValue: string, _contentType: string | undefined, body: Buffer): { path: string; markdown: string } {
    const document = this.findDocument(documentPath(documentValue))
    if (!document) throw new WikiError(404, 'Save the document before uploading assets.')
    const filename = filenameValue.trim()
    const extension = filename.split('.').pop()?.toLocaleLowerCase() ?? ''
    if (!filename || filename.length > 120 || filename.includes('/') || filename.includes('\\') || !assetExtensions.has(extension)) {
      throw new WikiError(422, 'Unsupported or invalid asset filename.')
    }
    if (body.byteLength > 10 * 1024 * 1024) throw new WikiError(422, 'Upload exceeds 10 MiB.')
    if (body.byteLength === 0 || !validFileContent(extension, body)) throw new WikiError(422, 'The file content does not match its filename or is not supported.')
    const parent = parentPath(document.path)
    const path = `${parent ? `${parent}/` : ''}assets/${filename}`
    if (this.db.prepare('SELECT 1 FROM assets WHERE path = ?').get(path)) throw new WikiError(409, 'An asset with that name already exists.')
    this.db.prepare(`INSERT INTO assets (document_id, path, original_name, mime_type, size, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(document.id, path, filename, mimeTypeFor(extension), body.byteLength, body)
    const encoded = encodeURIComponent(filename)
    const label = filename.slice(0, -(extension.length + 1)).replaceAll(']', '\\]')
    const markdown = imageExtensions.has(extension) ? `![${label}](assets/${encoded})` : `[${filename}](assets/${encoded})`
    return { path, markdown }
  }

  asset(pathValue: string): AssetRow {
    const path = decodeURIComponent(pathValue)
    const row = this.db.prepare('SELECT id, document_id, path, original_name, mime_type, size, data FROM assets WHERE path = ?').get(path) as unknown as AssetRow | undefined
    if (!row) throw new WikiError(404, 'Asset not found.')
    return row
  }

  insights(pathValue: string): { backlinks: Array<{ path: string; title: string }>; brokenLinks: Array<{ target: string; kind: 'document' | 'asset' }> } {
    const current = this.findDocument(documentPath(pathValue))
    if (!current) throw new WikiError(404, 'Document not found.')
    const documents = this.db.prepare('SELECT id, path, title, markdown, tags, version, updated_at, deleted_at FROM documents WHERE deleted_at IS NULL').all() as unknown as DocumentRow[]
    const assets = this.db.prepare('SELECT path FROM assets').all() as Array<{ path: string }>
    const documentPaths = new Set(documents.map((document) => document.path.toLocaleLowerCase()))
    const assetPaths = new Set(assets.map((asset) => asset.path.toLocaleLowerCase()))
    const brokenLinks: Array<{ target: string; kind: 'document' | 'asset' }> = []
    for (const target of markdownTargets(current.markdown)) {
      const resolved = resolveWikiPath(current.path, target)
      if (!resolved) continue
      const extension = resolved.split('.').pop()?.toLocaleLowerCase() ?? ''
      if (extension === 'md' && !documentPaths.has(resolved.toLocaleLowerCase())) brokenLinks.push({ target, kind: 'document' })
      else if (assetExtensions.has(extension) && !assetPaths.has(resolved.toLocaleLowerCase())) brokenLinks.push({ target, kind: 'asset' })
    }
    const backlinks = documents.filter((document) => document.id !== current.id && markdownTargets(document.markdown)
      .some((target) => resolveWikiPath(document.path, target)?.toLocaleLowerCase() === current.path.toLocaleLowerCase()))
      .map((document) => ({ path: document.path, title: document.title }))
    return { backlinks, brokenLinks }
  }

  private moveDocument(sourceValue: string, targetValue: string, actor: string): DocumentPayload {
    const source = documentPath(sourceValue)
    const target = documentPath(targetValue)
    const document = this.findDocument(source)
    if (!document) throw new WikiError(404, 'Document not found.')
    this.ensureParent(target)
    if (source.toLocaleLowerCase() !== target.toLocaleLowerCase() && this.findDocument(target, true)) {
      throw new WikiError(409, 'A document already exists at the destination.')
    }
    const oldParent = parentPath(source)
    const newParent = parentPath(target)
    this.transaction(() => {
      this.db.prepare('UPDATE documents SET path = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target, document.id)
      const assets = this.db.prepare('SELECT id, path FROM assets WHERE document_id = ?').all(document.id) as Array<{ id: number; path: string }>
      for (const asset of assets) {
        const marker = `${oldParent ? `${oldParent}/` : ''}assets/`
        const suffix = asset.path.slice(marker.length)
        this.db.prepare('UPDATE assets SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(`${newParent ? `${newParent}/` : ''}assets/${suffix}`, asset.id)
      }
    })
    const moved = this.findDocument(target)!
    this.saveRevision(moved, 'moved', actor)
    return documentPayload(moved)
  }

  private moveFolder(sourceValue: string, targetValue: string, actor: string): { path: string } {
    const source = folderPath(sourceValue)
    const target = folderPath(targetValue)
    if (!this.folderExists(source)) throw new WikiError(404, 'Folder not found.')
    if (target.toLocaleLowerCase() === source.toLocaleLowerCase() || target.toLocaleLowerCase().startsWith(`${source.toLocaleLowerCase()}/`)) {
      throw new WikiError(422, 'A folder cannot be moved inside itself.')
    }
    const parent = parentPath(target)
    if (parent && !this.folderExists(parent)) throw new WikiError(422, 'The destination parent folder does not exist.')
    if (this.folderExists(target)) throw new WikiError(409, 'The destination folder already exists.')
    const sourcePrefix = `${source}/`
    const targetPrefix = `${target}/`
    const existingDestination = this.db.prepare(`
      SELECT 1 FROM folders WHERE path = ? OR substr(path, 1, ?) = ?
      UNION ALL SELECT 1 FROM documents WHERE substr(path, 1, ?) = ? LIMIT 1
    `).get(target, targetPrefix.length, targetPrefix, targetPrefix.length, targetPrefix)
    if (existingDestination) throw new WikiError(409, 'A path already exists inside the destination.')

    this.transaction(() => {
      const folders = this.db.prepare('SELECT id, path FROM folders WHERE path = ? OR substr(path, 1, ?) = ? ORDER BY length(path) DESC')
        .all(source, sourcePrefix.length, sourcePrefix) as Array<{ id: number; path: string }>
      const documents = this.db.prepare('SELECT id, path FROM documents WHERE substr(path, 1, ?) = ?').all(sourcePrefix.length, sourcePrefix) as Array<{ id: number; path: string }>
      const assets = this.db.prepare('SELECT id, path FROM assets WHERE substr(path, 1, ?) = ?').all(sourcePrefix.length, sourcePrefix) as Array<{ id: number; path: string }>
      for (const item of folders) this.db.prepare('UPDATE folders SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target + item.path.slice(source.length), item.id)
      for (const item of documents) this.db.prepare('UPDATE documents SET path = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target + item.path.slice(source.length), item.id)
      for (const item of assets) this.db.prepare('UPDATE assets SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target + item.path.slice(source.length), item.id)
    })
    const movedDocuments = this.db.prepare(`SELECT id, path, title, markdown, tags, version, updated_at, deleted_at
      FROM documents WHERE substr(path, 1, ?) = ?`).all(targetPrefix.length, targetPrefix) as unknown as DocumentRow[]
    for (const moved of movedDocuments) this.saveRevision(moved, 'folder moved', actor)
    return { path: target }
  }

  private findDocument(path: string, includeDeleted = false): DocumentRow | undefined {
    return this.db.prepare(`SELECT id, path, title, markdown, tags, version, updated_at, deleted_at FROM documents
      WHERE path = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).get(path) as unknown as DocumentRow | undefined
  }

  private folderExists(path: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM folders WHERE path = ?').get(path))
  }

  private ensureParent(path: string): void {
    const parent = parentPath(path)
    if (parent && !this.folderExists(parent)) throw new WikiError(422, 'The destination folder does not exist.')
  }

  private transaction(action: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      action()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private saveRevision(document: DocumentRow, reason: string, actor: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO document_revisions
      (document_id, version, path, title, markdown, tags, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(document.id, document.version, document.path, document.title, document.markdown, document.tags, reason, actor)
  }

  private seedMissingRevisions(): void {
    this.db.exec(`INSERT OR IGNORE INTO document_revisions
      (document_id, version, path, title, markdown, tags, reason, created_by, created_at)
      SELECT id, version, path, title, markdown, tags, 'imported', 'system', updated_at FROM documents`)
  }

  private sortNodes(nodes: NavigationNode[]): NavigationNode[] {
    return nodes.map((node) => ({ ...node, children: node.children ? this.sortNodes(node.children) : undefined }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }
}

function cleanPath(value: string): string {
  if (typeof value !== 'string') throw new WikiError(422, 'Enter a valid wiki path.')
  const path = value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const segments = path.split('/')
  if (!path || path.length > 500 || /[\u0000-\u001f\u007f]/u.test(path) || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new WikiError(422, 'Enter a valid wiki path.')
  }
  return segments.join('/')
}

function documentPath(value: string): string {
  const path = cleanPath(value)
  return path.toLocaleLowerCase().endsWith('.md') ? path : `${path}.md`
}

function folderPath(value: string): string {
  return cleanPath(value)
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index < 0 ? null : path.slice(0, index)
}

function cleanTags(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 30) throw new WikiError(422, 'Enter no more than 30 tags.')
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].map((tag) => {
    if (tag.length > 50) throw new WikiError(422, 'Tags must be 50 characters or fewer.')
    return tag
  })
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function assertMarkdown(value: string): void {
  if (typeof value !== 'string') throw new WikiError(422, 'Markdown content is required.')
}

function titleFromMarkdown(markdown: string, path: string): string {
  const heading = markdown.match(/^#\s+(.+?)\s*$/mu)?.[1]
  if (heading) return heading.replace(/[*_`~\[\]]/gu, '').trim().slice(0, 255)
  const filename = path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled'
  return filename.replace(/[-_]+/gu, ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
}

function documentPayload(row: DocumentRow): DocumentPayload {
  const matches = [...row.markdown.matchAll(/^(#{1,6})\s+(.+?)\s*$/gmu)]
  return {
    path: row.path,
    title: row.title,
    tags: parseTags(row.tags),
    markdown: row.markdown,
    headings: matches.map((match) => ({ level: match[1].length, text: match[2].replace(/[*_`~\[\]]/gu, '').trim() })),
    version: row.version,
    updatedAt: row.updated_at,
  }
}

function ftsSearchQuery(term: string): string {
  return (term.match(/[\p{L}\p{N}_-]+/gu) ?? []).slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
}

function excerpt(markdown: string, term: string): string {
  const plain = markdown.replace(/[`#>*_\[\]()~-]/gu, ' ').replace(/\s+/gu, ' ').trim()
  const position = term ? plain.toLocaleLowerCase().indexOf(term) : 0
  const start = position < 0 ? 0 : Math.max(0, position - 60)
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + 180)}${plain.length > start + 180 ? '…' : ''}`
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)
}

function mimeTypeFor(extension: string): string {
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
    json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', zip: 'application/zip',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function validFileContent(extension: string, body: Buffer): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => body[index] === byte)
  if (extension === 'png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  if (extension === 'jpg' || extension === 'jpeg') return startsWith(0xff, 0xd8, 0xff)
  if (extension === 'gif') return body.subarray(0, 6).toString('ascii') === 'GIF87a' || body.subarray(0, 6).toString('ascii') === 'GIF89a'
  if (extension === 'webp') return body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP'
  if (extension === 'pdf') return body.subarray(0, 5).toString('ascii') === '%PDF-'
  if (extension === 'zip') return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06) || startsWith(0x50, 0x4b, 0x07, 0x08)
  const text = body.toString('utf8')
  if (text.includes('\uFFFD') || text.includes('\0')) return false
  if (extension === 'json') {
    try { JSON.parse(text); return true } catch { return false }
  }
  return true
}

function markdownTargets(markdown: string): string[] {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) => match[1].replace(/^<|>$/gu, ''))
}

function resolveWikiPath(document: string, target: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) return null
  const rawPath = target.split('#', 1)[0].split('?', 1)[0]
  if (!rawPath) return null
  let decoded: string
  try { decoded = decodeURIComponent(rawPath) } catch { return null }
  const resolved: string[] = decoded.startsWith('/') ? [] : (parentPath(document)?.split('/') ?? [])
  for (const part of decoded.replace(/^\//u, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
    } else resolved.push(part)
  }
  return resolved.length ? resolved.join('/') : null
}
