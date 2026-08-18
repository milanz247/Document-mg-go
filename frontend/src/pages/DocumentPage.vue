<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, BookOpen, FileQuestion, Files, FolderTree, PenLine, RefreshCw, Tag } from '@lucide/vue'
import { ApiError, documentsApi } from '../api/client'
import DocumentToolbar from '../components/document/DocumentToolbar.vue'
import MarkdownRenderer from '../components/markdown/MarkdownRenderer.vue'
import { useDocumentsStore } from '../stores/documents'
import type { DocumentResponse } from '../types/documents'
import { routeToDocumentPath } from '../utils/routes'

const route = useRoute()
const router = useRouter()
const documents = useDocumentsStore()
const document = ref<DocumentResponse | null>(null)
const loading = ref(true)
const error = ref('')
const notFound = ref(false)
const showWelcome = ref(false)
const requestedPath = computed(() => routeToDocumentPath(route.params.documentPath))

function reportHomeFallback(active: boolean): void {
  documents.homeFallback = active
}

function editWelcome(): void {
  window.dispatchEvent(new Event('atlas:request-edit'))
}

const libraryStats = computed(() => {
  let folders = 0
  let pages = 0
  const visit = (nodes: typeof documents.navigation): void => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        folders += 1
        visit(node.children ?? [])
      } else {
        pages += 1
      }
    }
  }
  visit(documents.navigation)
  return { folders, pages }
})

async function loadDocument(): Promise<void> {
  loading.value = true
  error.value = ''
  notFound.value = false
  showWelcome.value = false
  reportHomeFallback(false)
  try {
    document.value = await documentsApi.document(requestedPath.value)
    documents.revealDocument(document.value.path)
    window.document.title = `${document.value.title} - Atlas Docs`
  } catch (requestError) {
    document.value = null
    if (requestedPath.value.toLowerCase() === 'index.md' && requestError instanceof ApiError && requestError.status === 404) {
      showWelcome.value = true
      reportHomeFallback(true)
      window.document.title = "Welcome - Milan's Wiki"
      return
    }
    notFound.value = requestError instanceof ApiError && requestError.status === 404
    error.value = requestError instanceof Error ? requestError.message : 'Unable to load this document.'
    window.document.title = `${notFound.value ? 'Not found' : 'Error'} - Atlas Docs`
  } finally {
    loading.value = false
  }
}

watch(requestedPath, loadDocument, { immediate: true })
onMounted(() => window.addEventListener('atlas:refresh-document', loadDocument))
onBeforeUnmount(() => {
  reportHomeFallback(false)
  window.removeEventListener('atlas:refresh-document', loadDocument)
})
</script>

<template>
  <div class="mx-auto w-full max-w-[1040px] px-4 py-3 sm:px-8 sm:py-4 lg:px-10">
    <div v-if="loading" class="overflow-hidden bg-white dark:bg-[#0b0d10]">
      <div class="h-12 border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-[#0e1116]"></div>
      <div class="px-6 py-10 sm:px-12 sm:py-14 lg:px-16">
        <div class="h-3 w-28 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800"></div>
        <div class="mt-7 h-11 w-3/4 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800"></div>
        <div class="mt-10 space-y-3">
          <div class="h-3 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800"></div>
          <div class="h-3 w-[92%] animate-pulse rounded-full bg-slate-100 dark:bg-slate-800"></div>
          <div class="h-3 w-[78%] animate-pulse rounded-full bg-slate-100 dark:bg-slate-800"></div>
        </div>
        <div class="mt-10 h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"></div>
      </div>
    </div>

    <section v-else-if="showWelcome" class="mx-auto mt-8 max-w-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0e1116] sm:mt-12">
      <div class="border-b border-slate-200 px-6 py-7 dark:border-slate-800 sm:px-9 sm:py-9">
        <span class="grid size-11 place-items-center bg-[#eef3ff] text-[#36c] dark:bg-slate-800 dark:text-[#6ea6ff]"><BookOpen :size="20" /></span>
        <p class="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-[#36c] dark:text-[#6ea6ff]">Documentation workspace</p>
        <h1 class="wiki-heading mt-2 text-3xl text-slate-950 dark:text-white sm:text-4xl">Welcome to Milan's Wiki</h1>
        <p class="mt-3 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">Choose a document from Contents, or use the search bar to quickly find a technical note.</p>
      </div>
      <div class="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800">
        <div class="flex items-center gap-3 px-6 py-4 sm:px-9">
          <Files :size="17" class="text-slate-400" />
          <p><span class="block text-lg font-semibold text-slate-900 dark:text-white">{{ libraryStats.pages }}</span><span class="text-[10px] uppercase tracking-wider text-slate-400">Pages</span></p>
        </div>
        <div class="flex items-center gap-3 px-6 py-4 sm:px-9">
          <FolderTree :size="17" class="text-slate-400" />
          <p><span class="block text-lg font-semibold text-slate-900 dark:text-white">{{ libraryStats.folders }}</span><span class="text-[10px] uppercase tracking-wider text-slate-400">Folders</span></p>
        </div>
      </div>
      <div class="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/60 px-6 py-4 dark:border-slate-800 dark:bg-[#101214] sm:flex-row sm:items-center sm:justify-between sm:px-9">
        <p class="text-xs leading-5 text-slate-500 dark:text-slate-400">Create a home document to replace this default welcome screen with your own content.</p>
        <button class="flex h-9 shrink-0 items-center justify-center gap-2 border border-[#36c] px-3 text-xs font-semibold text-[#36c] hover:bg-[#eef3ff] dark:border-[#6ea6ff] dark:text-[#6ea6ff] dark:hover:bg-slate-800" type="button" @click="editWelcome">
          <PenLine :size="14" /> Customize welcome
        </button>
      </div>
    </section>

    <section v-else-if="error" class="mx-auto mt-12 max-w-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-[#0e1116] sm:p-10">
      <div class="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <FileQuestion v-if="notFound" :size="25" />
        <AlertCircle v-else :size="25" />
      </div>
      <p class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{{ notFound ? '404' : 'Could not load' }}</p>
      <h1 class="mt-2 text-2xl font-semibold tracking-tight text-ink dark:text-white">
        {{ notFound ? 'Document not found' : 'Something went wrong' }}
      </h1>
      <p class="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{{ error }}</p>
      <div class="mt-7 flex justify-center gap-3">
        <button class="button-secondary" type="button" @click="router.push('/docs')">
          <ArrowLeft :size="16" /> Home
        </button>
        <button class="button-primary" type="button" @click="loadDocument">
          <RefreshCw :size="16" /> Retry
        </button>
      </div>
    </section>

    <section v-else-if="document" class="bg-white dark:bg-[#0b0d10]">
      <DocumentToolbar :path="document.path" :refreshing="loading" @refresh="loadDocument" />
      <div v-if="document.tags.length" class="flex flex-wrap items-center gap-2 border-b border-slate-200 px-1 py-3 dark:border-slate-800">
        <Tag :size="14" class="text-slate-400 dark:text-slate-500" />
        <span v-for="tag in document.tags" :key="tag" class="tag-label">
          {{ tag }}
        </span>
      </div>
      <div class="px-1 py-8 sm:px-3 sm:py-10 lg:px-5 lg:py-12">
        <MarkdownRenderer :markdown="document.markdown" :document-path="document.path" />
      </div>
    </section>

    <footer v-if="document || showWelcome" class="mt-8 border-t border-slate-200 py-5 text-center text-[11px] tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
      Developed by <span class="font-semibold text-slate-600 dark:text-slate-300">Milan Madusanka</span>
    </footer>
  </div>
</template>
