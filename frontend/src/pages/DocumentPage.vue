<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertCircle, ArrowLeft, FileQuestion, RefreshCw, Tag } from '@lucide/vue'
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
const requestedPath = computed(() => routeToDocumentPath(route.params.documentPath))

async function loadDocument(): Promise<void> {
  loading.value = true
  error.value = ''
  notFound.value = false
  try {
    document.value = await documentsApi.document(requestedPath.value)
    documents.revealDocument(document.value.path)
    window.document.title = `${document.value.title} - Atlas Docs`
  } catch (requestError) {
    document.value = null
    notFound.value = requestError instanceof ApiError && requestError.status === 404
    error.value = requestError instanceof Error ? requestError.message : 'Unable to load this document.'
    window.document.title = `${notFound.value ? 'Not found' : 'Error'} - Atlas Docs`
  } finally {
    loading.value = false
  }
}

watch(requestedPath, loadDocument, { immediate: true })
onMounted(() => window.addEventListener('atlas:refresh-document', loadDocument))
onBeforeUnmount(() => window.removeEventListener('atlas:refresh-document', loadDocument))
</script>

<template>
  <div class="mx-auto w-full max-w-[1120px] px-5 py-3 sm:px-9 sm:py-4 lg:px-12 lg:py-4">
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
      <div class="py-8 sm:py-10 lg:py-11">
        <MarkdownRenderer :markdown="document.markdown" :document-path="document.path" />
      </div>
    </section>
  </div>
</template>
