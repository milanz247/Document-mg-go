import { gzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

const sourceRoot = resolve('.tmp/client')
const outputFile = resolve('src/generated/assets.ts')
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function filesInside(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesInside(path))
    else files.push(path)
  }
  return files
}

const assets = {}
for (const file of await filesInside(sourceRoot)) {
  const url = `/${relative(sourceRoot, file).split(sep).join('/')}`
  const extension = extname(file).toLocaleLowerCase()
  const raw = await readFile(file)
  const compressed = /^(?:text\/|application\/(?:json|javascript))/u.test(contentTypes[extension] ?? '') ? gzipSync(raw, { level: 9 }) : raw
  const useGzip = compressed.byteLength < raw.byteLength
  assets[url] = {
    body: (useGzip ? compressed : raw).toString('base64'),
    contentType: contentTypes[extension] ?? 'application/octet-stream',
    ...(useGzip ? { contentEncoding: 'gzip' } : {}),
  }
}

const output = `export type EmbeddedAsset = {\n  body: string\n  contentType: string\n  contentEncoding?: 'gzip'\n}\n\nexport const embeddedAssets: Record<string, EmbeddedAsset> = ${JSON.stringify(assets)}\n`
await mkdir(resolve('src/generated'), { recursive: true })
await writeFile(outputFile, output)
console.log(`Embedded ${Object.keys(assets).length} frontend assets.`)
