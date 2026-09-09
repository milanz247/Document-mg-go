export interface NavigationNode {
  name: string
  type: 'folder' | 'document'
  path: string
  tags?: string[]
  children?: NavigationNode[]
}

export interface Heading {
  level: number
  text: string
}

export interface DocumentResponse {
  path: string
  title: string
  tags: string[]
  markdown: string
  headings: Heading[]
  version: number
  updatedAt: string
}

export interface SearchResult {
  path: string
  title: string
  excerpt: string
  tags: string[]
  score: number
}

export interface FolderResponse {
  path: string
}

export interface AssetUpload {
  path: string
  markdown: string
}

export interface Backlink {
  path: string
  title: string
}

export interface BrokenLink {
  target: string
  kind: 'document' | 'asset'
}

export interface DocumentInsights {
  backlinks: Backlink[]
  brokenLinks: BrokenLink[]
}

export interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface AuthSession {
  user: AuthUser
  csrfToken: string
  expiresAt: string
}

export interface Revision {
  id: number
  version: number
  path: string
  reason: string
  createdBy: string
  createdAt: string
}

export interface TrashItem {
  path: string
  title: string
  deletedAt: string
}
