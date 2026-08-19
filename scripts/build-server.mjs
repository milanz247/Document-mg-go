import { rm, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const projectRoot = resolve('.')
const outputFile = resolve('dist/server.cjs')
if (dirname(outputFile) !== resolve(projectRoot, 'dist')) {
  throw new Error('Refusing to build outside the project dist directory.')
}

await rm(dirname(outputFile), { recursive: true, force: true })
await mkdir(dirname(outputFile), { recursive: true })
await build({
  entryPoints: [resolve('src/server/index.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'info',
})
