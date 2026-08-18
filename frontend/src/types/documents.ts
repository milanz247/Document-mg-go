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

export interface AuthUser {
  username: string
}

export interface AuthSession {
  user: AuthUser
  csrfToken: string
  expiresAt: string
}
