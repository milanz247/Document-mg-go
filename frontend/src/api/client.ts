import type { AssetUpload, AuthSession, DocumentInsights, DocumentResponse, FolderResponse, NavigationNode, SearchResult } from '../types/documents'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

let csrfToken = ''

export function setCSRFToken(token: string): void {
  csrfToken = token
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' })
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('atlas:unauthorized'))
    }
    let message = 'The request could not be completed.'
    try {
      const body = (await response.json()) as { error?: string }
      message = body.error ?? message
    } catch {
      // The fallback message is intentionally generic.
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const authApi = {
  me: () => request<AuthSession>('/api/auth/me'),
  unlock: (password: string) => request<AuthSession>('/api/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
  lock: () => request<void>('/api/auth/lock', { method: 'POST' }),
}

export const documentsApi = {
  navigation: () => request<NavigationNode[]>('/api/navigation'),
  search: (query: string, tags: string[] = []) => {
    const parameters = new URLSearchParams()
    if (query.trim()) parameters.set('q', query.trim())
    tags.forEach((tag) => parameters.append('tag', tag))
    return request<SearchResult[]>(`/api/search?${parameters.toString()}`)
  },
  document: (path: string) => request<DocumentResponse>(`/api/document?path=${encodeURIComponent(path)}`),
  insights: (path: string) => request<DocumentInsights>(`/api/insights?path=${encodeURIComponent(path)}`),
  create: (path: string, markdown: string, tags: string[]) => request<DocumentResponse>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ path, markdown, tags }),
  }),
  update: (path: string, markdown: string, tags: string[]) => request<DocumentResponse>('/api/document', {
    method: 'PUT',
    body: JSON.stringify({ path, markdown, tags }),
  }),
  createFolder: (path: string) => request<FolderResponse>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ path }),
  }),
  deleteFolder: (path: string) => request<void>(`/api/folder?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  delete: (path: string) => request<void>(`/api/document?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  move: (source: string, target: string, type: 'document' | 'folder') => request<DocumentResponse | FolderResponse>('/api/move', {
    method: 'POST',
    body: JSON.stringify({ source, target, type }),
  }),
  upload: (document: string, file: File) => {
    const parameters = new URLSearchParams({ document, filename: file.name })
    return request<AssetUpload>(`/api/assets/upload?${parameters.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
  },
}
