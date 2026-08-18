<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { Bold, CheckSquare, Code2, Eye, FolderPlus, Heading1, Heading2, Heading3, Image, Italic, Link, List, ListOrdered, LoaderCircle, Minus, PenLine, Quote, Save, Strikethrough, Table, Tag, Trash2, X } from '@lucide/vue'
import AppHeader from '../components/layout/AppHeader.vue'
import MarkdownRenderer from '../components/markdown/MarkdownRenderer.vue'
import { documentsApi } from '../api/client'
import { useDocumentsStore } from '../stores/documents'
import type { NavigationNode } from '../types/documents'
import { documentRoute, routeToDocumentPath } from '../utils/routes'

const route = useRoute()
const router = useRouter()
const documents = useDocumentsStore()
const textarea = ref<HTMLTextAreaElement | null>(null)
const path = ref('')
const markdown = ref('')
const originalMarkdown = ref('')
const tags = ref<string[]>([])
const originalTags = ref<string[]>([])
const tagInput = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const mobilePanel = ref<'write' | 'preview'>('write')
const showDeleteDialog = ref(false)
const allowNavigation = ref(false)

const isNew = computed(() => route.name === 'editor-new')
const requestedPath = computed(() => routeToDocumentPath(route.params.documentPath))
const dirty = computed(() => markdown.value !== originalMarkdown.value || tags.value.join('\n') !== originalTags.value.join('\n'))
const previewPath = computed(() => normalizePath(path.value || 'draft.md'))
const wordCount = computed(() => markdown.value.trim() ? markdown.value.trim().split(/\s+/u).length : 0)

function collectFolders(nodes: NavigationNode[]): string[] {
  return nodes.flatMap((node) => node.type === 'folder' ? [node.path, ...collectFolders(node.children ?? [])] : collectFolders(node.children ?? []))
}

const folderPaths = computed(() => collectFolders(documents.navigation))

function normalizePath(value: string): string {
  let normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (normalized && !normalized.toLowerCase().endsWith('.md')) normalized += '.md'
  return normalized
}

function openFolderDialog(): void {
  window.dispatchEvent(new Event('atlas:open-folder-dialog'))
}

function handleFolderCreated(event: Event): void {
  if (!isNew.value) return
  const detail = (event as CustomEvent<{ path?: string }>).detail
  if (detail?.path) path.value = `${detail.path}/`
}

async function loadEditor(): Promise<void> {
  loading.value = true
  error.value = ''
  allowNavigation.value = false
  if (isNew.value) {
    const requestedNewPath = typeof route.query.path === 'string' ? normalizePath(route.query.path) : ''
    const welcomeTemplate = route.query.template === 'welcome'
    path.value = requestedNewPath
    markdown.value = welcomeTemplate
      ? "# Welcome to Milan's Wiki\n\nUse this home page to introduce the documentation workspace, highlight important guides, and help readers find the right information.\n\n## Getting started\n\nChoose a document from **Contents** or use the search bar.\n"
      : '# Untitled document\n\nStart writing here.\n'
    originalMarkdown.value = markdown.value
    tags.value = []
    originalTags.value = []
    tagInput.value = ''
    loading.value = false
    return
  }
  try {
    const document = await documentsApi.document(requestedPath.value)
    path.value = document.path
    markdown.value = document.markdown
    originalMarkdown.value = document.markdown
    tags.value = [...document.tags]
    originalTags.value = [...document.tags]
    tagInput.value = ''
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : 'Unable to load document.'
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
	if (saving.value || loading.value) return
  error.value = ''
  const normalizedPath = normalizePath(path.value)
  if (!normalizedPath || normalizedPath.split('/').some((segment) => segment === '..' || segment === '')) {
    error.value = 'Enter a valid path such as Engineering/new-page.md.'
    return
  }
  saving.value = true
  try {
    const document = isNew.value
      ? await documentsApi.create(normalizedPath, markdown.value, tags.value)
      : await documentsApi.update(normalizedPath, markdown.value, tags.value)
    originalMarkdown.value = document.markdown
    tags.value = [...document.tags]
    originalTags.value = [...document.tags]
    path.value = document.path
    await documents.loadNavigation()
    allowNavigation.value = true
    await router.push(documentRoute(document.path))
  } catch (saveError) {
    error.value = saveError instanceof Error ? saveError.message : 'Unable to save document.'
  } finally {
    saving.value = false
  }
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function addTag(): void {
  const candidates = tagInput.value.split(',').map(normalizeTag).filter(Boolean)
  for (const candidate of candidates) {
    if (tags.value.includes(candidate)) continue
    if (tags.value.length >= 8) {
      error.value = 'A document can have at most 8 tags.'
      break
    }
    if ([...candidate].length > 32) {
      error.value = 'Each tag can contain at most 32 characters.'
      continue
    }
    tags.value.push(candidate)
  }
  tagInput.value = ''
}

function removeTag(tag: string): void {
  tags.value = tags.value.filter((existing) => existing !== tag)
}

function handleTagKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    addTag()
  } else if (event.key === 'Backspace' && !tagInput.value && tags.value.length > 0) {
    tags.value = tags.value.slice(0, -1)
  }
}

async function removeDocument(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await documentsApi.delete(path.value)
    await documents.loadNavigation()
    allowNavigation.value = true
    await router.push('/docs')
  } catch (deleteError) {
    error.value = deleteError instanceof Error ? deleteError.message : 'Unable to delete document.'
    showDeleteDialog.value = false
  } finally {
    saving.value = false
  }
}

async function wrapSelection(before: string, after: string, placeholder: string): Promise<void> {
  const element = textarea.value
  if (!element) return
  const start = element.selectionStart
  const end = element.selectionEnd
  const selected = markdown.value.slice(start, end) || placeholder
  markdown.value = `${markdown.value.slice(0, start)}${before}${selected}${after}${markdown.value.slice(end)}`
  await nextTick()
  element.focus()
  element.setSelectionRange(start + before.length, start + before.length + selected.length)
}

async function insertAtCursor(value: string): Promise<void> {
	const element = textarea.value
	if (!element) return
	const start = element.selectionStart
	const end = element.selectionEnd
	markdown.value = `${markdown.value.slice(0, start)}${value}${markdown.value.slice(end)}`
	await nextTick()
	element.focus()
	element.setSelectionRange(start + value.length, start + value.length)
}

async function insertLine(prefix: string, placeholder: string): Promise<void> {
  const element = textarea.value
  if (!element) return
  const start = element.selectionStart
	const leadingBreak = start > 0 && markdown.value[start - 1] !== '\n' ? '\n' : ''
	const insertion = `${leadingBreak}${prefix}${placeholder}`
	markdown.value = `${markdown.value.slice(0, start)}${insertion}${markdown.value.slice(start)}`
	await nextTick()
	element.focus()
	const selectionStart = start + leadingBreak.length + prefix.length
	element.setSelectionRange(selectionStart, selectionStart + placeholder.length)
}

async function insertBlock(content: string): Promise<void> {
	const element = textarea.value
	if (!element) return
	const start = element.selectionStart
	const end = element.selectionEnd
	const before = markdown.value.slice(0, start)
	const after = markdown.value.slice(end)
	const leadingBreak = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''
	const trailingBreak = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : ''
	const insertion = `${leadingBreak}${content}${trailingBreak}`
	markdown.value = `${before}${insertion}${after}`
	await nextTick()
	element.focus()
	element.setSelectionRange(start + leadingBreak.length, start + leadingBreak.length + content.length)
}

function insertTable(): Promise<void> {
	return insertBlock('| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Value 1 | Value 2 | Value 3 |\n| Value 4 | Value 5 | Value 6 |')
}

async function handleEditorKeydown(event: KeyboardEvent): Promise<void> {
	const modifier = event.ctrlKey || event.metaKey
	if (modifier && !event.altKey && event.key.toLowerCase() === 's') {
		event.preventDefault()
		await save()
	} else if (modifier && !event.altKey && event.key.toLowerCase() === 'b') {
		event.preventDefault()
		await wrapSelection('**', '**', 'bold text')
	} else if (modifier && !event.altKey && event.key.toLowerCase() === 'i') {
		event.preventDefault()
		await wrapSelection('*', '*', 'italic text')
	} else if (modifier && !event.altKey && event.key.toLowerCase() === 'k') {
		event.preventDefault()
		await wrapSelection('[', '](https://)', 'link text')
	} else if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 't') {
		event.preventDefault()
		await insertTable()
	} else if (event.key === 'Tab') {
		event.preventDefault()
		await insertAtCursor('  ')
	}
}

onMounted(() => {
  void documents.loadNavigation()
  window.addEventListener('atlas:folder-created', handleFolderCreated)
})
onBeforeUnmount(() => window.removeEventListener('atlas:folder-created', handleFolderCreated))
watch(() => route.fullPath, loadEditor, { immediate: true })
onBeforeRouteLeave(() => allowNavigation.value || !dirty.value || window.confirm('Discard your unsaved changes?'))
</script>

<template>
  <div class="min-h-screen bg-[#f8f9fa] text-[#202122] dark:bg-[#0b0d10] dark:text-slate-200">
    <AppHeader />

    <main class="mx-auto w-full max-w-[1780px] px-4 py-5 sm:px-6">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#36c] dark:text-[#6ea6ff]">{{ isNew ? 'Create document' : 'Edit document' }}</p>
          <h1 class="wiki-heading mt-1 truncate text-2xl text-slate-950 dark:text-white">{{ isNew ? 'New knowledge page' : path }}</h1>
        </div>
        <span v-if="dirty" class="text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>
        <button v-if="!isNew" class="flex h-9 items-center gap-2 border border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30" type="button" @click="showDeleteDialog = true">
          <Trash2 :size="14" /> Delete
        </button>
        <button class="flex h-9 items-center gap-2 bg-[#36c] px-4 text-xs font-semibold text-white hover:bg-[#2a4b8d] disabled:opacity-60" type="button" :disabled="saving || loading" @click="save">
          <LoaderCircle v-if="saving" :size="15" class="animate-spin" />
          <Save v-else :size="15" />
          {{ isNew ? 'Publish page' : 'Save changes' }}
        </button>
      </div>

      <p v-if="error" role="alert" class="mb-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{{ error }}</p>

      <div v-if="loading" class="grid min-h-[60vh] place-items-center border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111315]">
        <LoaderCircle :size="22" class="animate-spin text-[#36c] dark:text-[#6ea6ff]" />
      </div>

      <template v-else>
        <div class="mb-4 space-y-4 border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-[#111315]">
          <div v-if="isNew">
            <div class="flex items-center justify-between gap-3">
              <label for="document-path" class="text-xs font-semibold text-slate-700 dark:text-slate-300">Document path</label>
              <button type="button" class="flex h-7 items-center gap-1.5 border border-slate-300 px-2.5 text-[10px] font-semibold text-slate-600 hover:border-[#36c] hover:text-[#36c] dark:border-slate-700 dark:text-slate-400 dark:hover:border-[#6ea6ff] dark:hover:text-[#6ea6ff]" @click="openFolderDialog">
                <FolderPlus :size="12" /> New folder
              </button>
            </div>
            <input id="document-path" v-model="path" list="editor-folders" class="mt-1.5 h-10 w-full border border-slate-400 bg-white px-3 font-mono text-sm font-normal outline-none focus:border-[#36c] focus:ring-1 focus:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10] dark:text-white" placeholder="Team/document-name.md" />
          </div>
          <datalist id="editor-folders">
            <option v-for="folder in folderPaths" :key="folder" :value="`${folder}/`"></option>
          </datalist>
          <p v-if="isNew" class="text-xs text-slate-500">Choose an existing folder and a unique filename. The <code>.md</code> extension is added automatically.</p>

          <div>
            <div class="mb-1.5 flex items-center justify-between gap-3">
              <label for="document-tags" class="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"><Tag :size="13" /> Tags</label>
              <span class="text-[10px] text-slate-400 dark:text-slate-500">{{ tags.length }}/8</span>
            </div>
            <div class="flex min-h-10 flex-wrap items-center gap-1.5 border border-slate-400 bg-white px-2 py-1.5 focus-within:border-[#36c] focus-within:ring-1 focus-within:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10]">
              <span v-for="tag in tags" :key="tag" class="tag-label gap-1.5">
                {{ tag }}
                <button type="button" class="text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400" :aria-label="`Remove ${tag} tag`" @click="removeTag(tag)"><X :size="11" /></button>
              </span>
              <input id="document-tags" v-model="tagInput" class="h-6 min-w-32 flex-1 bg-transparent px-1 text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-600" type="text" maxlength="128" placeholder="Add tags, then press Enter" @keydown="handleTagKeydown" @blur="addTag" />
            </div>
            <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-500">Tags are saved inside the Markdown file and normalized to lowercase slugs.</p>
          </div>
        </div>

        <div class="mb-3 flex border-b border-slate-300 dark:border-slate-700 lg:hidden">
          <button class="flex h-9 items-center gap-2 border-b-2 px-4 text-xs font-semibold" :class="mobilePanel === 'write' ? 'border-[#36c] text-[#36c]' : 'border-transparent text-slate-500'" type="button" @click="mobilePanel = 'write'"><PenLine :size="14" /> Write</button>
          <button class="flex h-9 items-center gap-2 border-b-2 px-4 text-xs font-semibold" :class="mobilePanel === 'preview' ? 'border-[#36c] text-[#36c]' : 'border-transparent text-slate-500'" type="button" @click="mobilePanel = 'preview'"><Eye :size="14" /> Preview</button>
        </div>

        <div class="grid min-h-[calc(100vh-15rem)] border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111315] lg:grid-cols-2">
          <section class="flex min-h-[65vh] flex-col border-slate-300 dark:border-slate-700 lg:border-r" :class="mobilePanel === 'preview' ? 'hidden lg:flex' : 'flex'">
            <div class="flex min-h-11 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-[#f8f9fa] px-2 dark:border-slate-800 dark:bg-[#181a1d]">
              <button class="editor-tool shrink-0" title="Heading 1" type="button" @click="insertLine('# ', 'Heading 1')"><Heading1 :size="15" /></button>
              <button class="editor-tool shrink-0" title="Heading 2" type="button" @click="insertLine('## ', 'Heading 2')"><Heading2 :size="15" /></button>
              <button class="editor-tool shrink-0" title="Heading 3" type="button" @click="insertLine('### ', 'Heading 3')"><Heading3 :size="15" /></button>
              <span class="mx-1 h-5 w-px shrink-0 bg-slate-300 dark:bg-slate-700"></span>
              <button class="editor-tool shrink-0" title="Bold (Ctrl+B)" type="button" @click="wrapSelection('**', '**', 'bold text')"><Bold :size="15" /></button>
              <button class="editor-tool shrink-0" title="Italic (Ctrl+I)" type="button" @click="wrapSelection('*', '*', 'italic text')"><Italic :size="15" /></button>
              <button class="editor-tool shrink-0" title="Strikethrough" type="button" @click="wrapSelection('~~', '~~', 'struck text')"><Strikethrough :size="15" /></button>
              <span class="mx-1 h-5 w-px shrink-0 bg-slate-300 dark:bg-slate-700"></span>
              <button class="editor-tool shrink-0" title="Link (Ctrl+K)" type="button" @click="wrapSelection('[', '](https://)', 'link text')"><Link :size="15" /></button>
              <button class="editor-tool shrink-0" title="Image" type="button" @click="wrapSelection('![', '](images/example.png)', 'image description')"><Image :size="15" /></button>
              <button class="editor-tool shrink-0" title="Bulleted list" type="button" @click="insertLine('- ', 'List item')"><List :size="15" /></button>
              <button class="editor-tool shrink-0" title="Numbered list" type="button" @click="insertLine('1. ', 'List item')"><ListOrdered :size="15" /></button>
              <button class="editor-tool shrink-0" title="Task list" type="button" @click="insertLine('- [ ] ', 'Task item')"><CheckSquare :size="15" /></button>
              <button class="editor-tool shrink-0" title="Quote" type="button" @click="insertLine('> ', 'Quote')"><Quote :size="15" /></button>
              <span class="mx-1 h-5 w-px shrink-0 bg-slate-300 dark:bg-slate-700"></span>
              <button class="editor-tool shrink-0" title="Insert table (Ctrl+Alt+T)" type="button" @click="insertTable"><Table :size="15" /></button>
              <button class="editor-tool shrink-0" title="Code block" type="button" @click="wrapSelection('```\n', '\n```', 'code')"><Code2 :size="15" /></button>
              <button class="editor-tool shrink-0" title="Horizontal rule" type="button" @click="insertBlock('---')"><Minus :size="15" /></button>
            </div>
            <textarea ref="textarea" v-model="markdown" class="min-h-0 flex-1 resize-none bg-white p-5 font-mono text-[14px] leading-6 text-slate-800 outline-none dark:bg-[#0b0d10] dark:text-slate-200" spellcheck="false" aria-label="Markdown editor" @keydown="handleEditorKeydown"></textarea>
            <div class="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-slate-200 bg-[#f8f9fa] px-3 font-mono text-[10px] text-slate-400 dark:border-slate-800 dark:bg-[#181a1d] dark:text-slate-500">
              <span>Markdown</span>
              <span class="hidden truncate lg:block">Ctrl+B Bold · Ctrl+I Italic · Ctrl+K Link · Ctrl+S Save · Ctrl+Alt+T Table</span>
              <span>{{ wordCount }} words · {{ markdown.length }} characters</span>
            </div>
          </section>

          <section class="min-h-[65vh] overflow-y-auto bg-white dark:bg-[#0b0d10]" :class="mobilePanel === 'write' ? 'hidden lg:block' : 'block'">
            <div class="sticky top-0 z-10 flex h-11 items-center border-b border-slate-200 bg-[#f8f9fa]/95 px-4 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 backdrop-blur dark:border-slate-800 dark:bg-[#181a1d]/95 dark:text-slate-400">
              Live preview
            </div>
            <div class="p-6 sm:p-8">
              <MarkdownRenderer :markdown="markdown" :document-path="previewPath" />
            </div>
          </section>
        </div>
      </template>
    </main>

    <div v-if="showDeleteDialog" class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <section class="w-full max-w-md border border-slate-300 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-[#111315]">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="delete-title" class="wiki-heading text-xl text-slate-950 dark:text-white">Delete this document?</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">This permanently removes <strong>{{ path }}</strong> from the filesystem.</p>
          </div>
          <button class="p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" type="button" aria-label="Close" @click="showDeleteDialog = false"><X :size="18" /></button>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="h-9 border border-slate-300 px-4 text-xs font-semibold dark:border-slate-700" type="button" @click="showDeleteDialog = false">Cancel</button>
          <button class="flex h-9 items-center gap-2 bg-rose-700 px-4 text-xs font-semibold text-white hover:bg-rose-800" type="button" :disabled="saving" @click="removeDocument"><Trash2 :size="14" /> Delete file</button>
        </div>
      </section>
    </div>
  </div>
</template>
