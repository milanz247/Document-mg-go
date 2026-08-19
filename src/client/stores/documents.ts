import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { documentsApi } from '../api/client'
import type { NavigationNode, SearchResult } from '../types/documents'

const storageKey = 'atlas-docs-open-folders'
const favoritesKey = 'atlas-docs-favorites'
const pinnedKey = 'atlas-docs-pinned'

function savedList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function flattenDocuments(nodes: NavigationNode[]): NavigationNode[] {
  return nodes.flatMap((node) => node.type === 'document' ? [node] : flattenDocuments(node.children ?? []))
}

export const useDocumentsStore = defineStore('documents', () => {
  const navigation = ref<NavigationNode[]>([])
  const navigationLoading = ref(false)
  const navigationError = ref('')
  const searchResults = ref<SearchResult[]>([])
  const searchLoading = ref(false)
  const searchError = ref('')
  const sidebarOpen = ref(false)
  const homeFallback = ref(false)
  const openFolders = ref(new Set(savedList(storageKey)))
  const favorites = ref(savedList(favoritesKey))
  const pinned = ref(savedList(pinnedKey))
  let searchSequence = 0

  const hasNavigation = computed(() => navigation.value.length > 0)
  const allDocuments = computed(() => flattenDocuments(navigation.value))
  const favoriteDocuments = computed(() => favorites.value
    .map((path) => allDocuments.value.find((node) => node.path === path))
    .filter((node): node is NavigationNode => Boolean(node)))
  const displayNavigation = computed(() => {
    const pinOrder = new Map(pinned.value.map((path, index) => [path, index]))
    const order = (nodes: NavigationNode[]): NavigationNode[] => [...nodes]
      .map((node) => ({ ...node, children: node.children ? order(node.children) : undefined }))
      .sort((left, right) => {
        const leftPin = pinOrder.get(left.path)
        const rightPin = pinOrder.get(right.path)
        if (leftPin !== undefined || rightPin !== undefined) {
          if (leftPin === undefined) return 1
          if (rightPin === undefined) return -1
          return leftPin - rightPin
        }
        return left.name.localeCompare(right.name)
      })
    return order(navigation.value)
  })

  async function loadNavigation(): Promise<void> {
    navigationLoading.value = true
    navigationError.value = ''
    try {
      navigation.value = await documentsApi.navigation()
    } catch (error) {
      navigationError.value = error instanceof Error ? error.message : 'Unable to load navigation.'
    } finally {
      navigationLoading.value = false
    }
  }

  async function search(query: string, tags: string[] = []): Promise<void> {
    const sequence = ++searchSequence
    if (!query.trim() && tags.length === 0) {
      searchResults.value = []
      searchError.value = ''
      searchLoading.value = false
      return
    }
    searchLoading.value = true
    searchError.value = ''
    try {
      const results = await documentsApi.search(query, tags)
      if (sequence === searchSequence) searchResults.value = results
    } catch (error) {
      if (sequence === searchSequence) {
        searchResults.value = []
        searchError.value = error instanceof Error ? error.message : 'Unable to search documents.'
      }
    } finally {
      if (sequence === searchSequence) searchLoading.value = false
    }
  }

  function toggleFolder(path: string): void {
    const next = new Set(openFolders.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    openFolders.value = next
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  }

  function revealDocument(path: string): void {
    const parts = path.split('/')
    const next = new Set(openFolders.value)
    for (let index = 1; index < parts.length; index += 1) {
      next.add(parts.slice(0, index).join('/'))
    }
    openFolders.value = next
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  }

  function forgetFolder(path: string): void {
    const next = new Set([...openFolders.value].filter((folder) => folder !== path && !folder.startsWith(`${path}/`)))
    openFolders.value = next
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  }

  function toggleFavorite(path: string): void {
    favorites.value = favorites.value.includes(path)
      ? favorites.value.filter((item) => item !== path)
      : [path, ...favorites.value]
    localStorage.setItem(favoritesKey, JSON.stringify(favorites.value))
  }

  function togglePinned(path: string): void {
    pinned.value = pinned.value.includes(path)
      ? pinned.value.filter((item) => item !== path)
      : [...pinned.value, path]
    localStorage.setItem(pinnedKey, JSON.stringify(pinned.value))
  }

  function remapPath(source: string, target: string): void {
    const remap = (path: string) => path === source ? target : path.startsWith(`${source}/`) ? `${target}${path.slice(source.length)}` : path
    favorites.value = favorites.value.map(remap)
    pinned.value = pinned.value.map(remap)
    openFolders.value = new Set([...openFolders.value].map(remap))
    localStorage.setItem(favoritesKey, JSON.stringify(favorites.value))
    localStorage.setItem(pinnedKey, JSON.stringify(pinned.value))
    localStorage.setItem(storageKey, JSON.stringify([...openFolders.value]))
  }

  return {
    navigation,
    navigationLoading,
    navigationError,
    searchResults,
    searchLoading,
    searchError,
    sidebarOpen,
    homeFallback,
    openFolders,
    hasNavigation,
    displayNavigation,
    favoriteDocuments,
    loadNavigation,
    search,
    toggleFolder,
    revealDocument,
    forgetFolder,
    toggleFavorite,
    isFavorite: (path: string) => favorites.value.includes(path),
    togglePinned,
    isPinned: (path: string) => pinned.value.includes(path),
    remapPath,
  }
})
