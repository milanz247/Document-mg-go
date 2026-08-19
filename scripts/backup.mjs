import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { DatabaseSync } from 'node:sqlite'

try {
  loadEnvFile()
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const databasePath = resolve(process.env.DATABASE_PATH || './data/atlas.sqlite')
const backupDirectory = resolve(process.env.BACKUP_DIR || './backups')

if (!existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`)
}

mkdirSync(backupDirectory, { recursive: true })
const timestamp = new Date().toISOString().replaceAll(':', '-').replace('T', '_').replace('Z', '')
const backupPath = resolve(join(backupDirectory, `atlas_${timestamp}.sqlite`))
const relativeTarget = relative(backupDirectory, backupPath)
if (relativeTarget.startsWith('..') || relativeTarget === '' || basename(backupPath) !== basename(relativeTarget)) {
  throw new Error('Refusing to write the backup outside BACKUP_DIR.')
}

const source = new DatabaseSync(databasePath)
try {
  source.exec('PRAGMA busy_timeout = 10000; PRAGMA synchronous = FULL;')
  const quotedPath = backupPath.replaceAll("'", "''")
  source.exec(`VACUUM INTO '${quotedPath}'`)
} finally {
  source.close()
}

const backup = new DatabaseSync(backupPath, { readOnly: true })
let integrity
try {
  const result = backup.prepare('PRAGMA integrity_check').get()
  integrity = result ? String(Object.values(result)[0]) : 'missing result'
} finally {
  backup.close()
}

if (integrity !== 'ok') {
  throw new Error(`Backup integrity check failed: ${integrity}`)
}

console.log(JSON.stringify({
  source: databasePath,
  backup: backupPath,
  bytes: statSync(backupPath).size,
  integrity,
}, null, 2))
