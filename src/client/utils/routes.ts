function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function documentRoute(path: string): string {
  const withoutExtension = path.replace(/\.md$/i, '')
  return withoutExtension.toLowerCase() === 'index' ? '/docs' : `/docs/${encodePath(withoutExtension)}`
}

export function editorRoute(path: string): string {
  const withoutExtension = path.replace(/\.md$/i, '')
  return `/editor/${encodePath(withoutExtension)}`
}

export function routeToDocumentPath(routePath: unknown): string {
  if (typeof routePath !== 'string' || routePath === '') return 'index.md'
  return routePath.toLowerCase().endsWith('.md') ? routePath : `${routePath}.md`
}

export function resolveDocumentationPath(currentDocument: string, target: string): string | null {
  const [pathAndQuery, hash = ''] = target.split('#', 2)
  const [targetPath] = pathAndQuery.split('?', 1)
  if (!targetPath.toLowerCase().endsWith('.md')) return null

  const base = targetPath.startsWith('/') ? [] : currentDocument.split('/').slice(0, -1)
  const parts = [...base, ...targetPath.replace(/^\//, '').split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }

  const route = documentRoute(resolved.join('/'))
  return hash ? `${route}#${encodeURIComponent(hash)}` : route
}

export function resolveAssetPath(currentDocument: string, target: string): string | null {
  if (/^(?:https?:)?\/\//i.test(target) || target.startsWith('data:')) return target
  const targetPath = target.split(/[?#]/, 1)[0]
  let decodedTarget: string
  try {
    decodedTarget = decodeURIComponent(targetPath)
  } catch {
    return null
  }
  const base = decodedTarget.startsWith('/') ? [] : currentDocument.split('/').slice(0, -1)
  const parts = [...base, ...decodedTarget.replace(/^\//, '').split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  return `/api/assets?path=${encodeURIComponent(resolved.join('/'))}`
}
