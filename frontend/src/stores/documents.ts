import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { documentsApi } from '../api/client'
import type { NavigationNode, SearchResult } from '../types/documents'

const storageKey = 'atlas-docs-open-folders'

function savedFolders(): string[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]
  } catch {
    return []
  }
}

export const useDocumentsStore = defineStore('documents', () => {
  const navigation = ref<NavigationNode[]>([])
  const navigationLoading = ref(false)
  const navigationError = ref('')
  const searchResults = ref<SearchResult[]>([])
  const searchLoading = ref(false)
  const searchError = ref('')
  const sidebarOpen = ref(false)
  const openFolders = ref(new Set(savedFolders()))
  let searchSequence = 0

  const hasNavigation = computed(() => navigation.value.length > 0)

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

  return {
    navigation,
    navigationLoading,
    navigationError,
    searchResults,
    searchLoading,
    searchError,
    sidebarOpen,
    openFolders,
    hasNavigation,
    loadNavigation,
    search,
    toggleFolder,
    revealDocument,
  }
})
