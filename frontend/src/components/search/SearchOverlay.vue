<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FileText, LoaderCircle, Search, Tag, X } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { useDocumentsStore } from '../../stores/documents'
import type { NavigationNode, SearchResult } from '../../types/documents'
import { documentRoute } from '../../utils/routes'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const documents = useDocumentsStore()
const router = useRouter()
const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const selectedTags = ref<string[]>([])
const activeResult = ref(0)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let previousBodyOverflow = ''

const hasSearch = computed(() => Boolean(query.value.trim() || selectedTags.value.length))

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

const availableTags = computed(() => {
  const counts = new Map<string, number>()
  function collect(nodes: NavigationNode[]): void {
    for (const node of nodes) {
      if (node.type === 'document') {
        for (const tag of node.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      } else {
        collect(node.children ?? [])
      }
    }
  }
  collect(documents.navigation)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
})

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void documents.search(query.value, selectedTags.value)
  }, 180)
}

function toggleTag(tag: string): void {
  selectedTags.value = selectedTags.value.includes(tag)
    ? selectedTags.value.filter((selected) => selected !== tag)
    : [...selectedTags.value, tag]
}

function moveSelection(direction: number): void {
  const total = documents.searchResults.length
  if (!total) return
  activeResult.value = (activeResult.value + direction + total) % total
  nextTick(() => {
    document.querySelector<HTMLElement>(`[data-search-result="${activeResult.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

async function openResult(result?: SearchResult): Promise<void> {
  const target = result ?? documents.searchResults[activeResult.value]
  if (!target) return
  emit('close')
  await router.push(documentRoute(target.path))
}

function close(): void {
  emit('close')
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

watch([query, () => selectedTags.value.join('\u0000')], () => {
  activeResult.value = 0
  scheduleSearch()
})

watch(() => documents.searchResults, () => {
  activeResult.value = 0
})

watch(() => props.open, async (open) => {
  if (open) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!documents.hasNavigation) await documents.loadNavigation()
    await nextTick()
    input.value?.focus()
    input.value?.select()
  } else {
    document.body.style.overflow = previousBodyOverflow
  }
})

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  if (searchTimer) clearTimeout(searchTimer)
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <Transition name="search-overlay">
      <div
        v-if="open"
        class="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/35 px-3 pb-10 pt-[9vh] backdrop-blur-[5px] dark:bg-black/60"
        role="presentation"
        @mousedown.self="close"
      >
        <section class="w-full max-w-[660px] overflow-hidden border border-slate-300 bg-white shadow-[0_28px_90px_-24px_rgba(15,23,42,0.6)] dark:border-slate-700 dark:bg-[#101214]" role="dialog" aria-modal="true" aria-label="Search documentation">
          <div class="flex h-16 items-center border-b border-slate-200 px-5 dark:border-slate-800">
            <Search :size="21" class="mr-3 shrink-0 text-[#36c] dark:text-[#6ea6ff]" />
            <input
              ref="input"
              v-model="query"
              class="min-w-0 flex-1 bg-transparent text-[17px] text-slate-950 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-600"
              type="search"
              maxlength="200"
              autocomplete="off"
              placeholder="Search files and tags..."
              aria-label="Search documentation"
              @keydown.down.prevent="moveSelection(1)"
              @keydown.up.prevent="moveSelection(-1)"
              @keydown.enter.prevent="openResult()"
            />
            <span v-if="documents.searchLoading" class="ml-3 grid size-8 place-items-center text-slate-400"><LoaderCircle :size="18" class="animate-spin" /></span>
            <button v-else class="ml-3 grid size-8 place-items-center border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800" type="button" aria-label="Close search" @click="close"><X :size="17" /></button>
          </div>

          <div v-if="availableTags.length" class="border-b border-slate-200 bg-slate-50/80 px-5 py-3 dark:border-slate-800 dark:bg-[#15181c]">
            <div class="flex items-start gap-3">
              <span class="mt-1 flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500"><Tag :size="12" /> Filter</span>
              <div class="flex max-h-12 flex-wrap gap-1.5 overflow-y-auto">
                <button
                  v-for="tag in availableTags"
                  :key="tag.name"
                  type="button"
                  class="tag-filter"
                  :class="selectedTags.includes(tag.name) ? 'tag-filter-active' : ''"
                  @click="toggleTag(tag.name)"
                >
                  {{ tag.name }} <span class="opacity-55">{{ tag.count }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="max-h-[min(54vh,460px)] min-h-44 overflow-y-auto p-2">
            <div v-if="!hasSearch" class="grid min-h-40 place-items-center px-6 text-center">
              <div>
                <div class="mx-auto grid size-11 place-items-center border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-[#15181c] dark:text-slate-500"><Search :size="19" /></div>
                <p class="mt-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Find a documentation file</p>
                <p class="mt-1 text-xs leading-5 text-slate-400 dark:text-slate-500">Type a filename or select a tag.</p>
              </div>
            </div>
            <div v-else-if="documents.searchError" class="m-2 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
              {{ documents.searchError }}
            </div>
            <div v-else-if="!documents.searchLoading && documents.searchResults.length === 0" class="grid min-h-40 place-items-center px-6 text-center">
              <div>
                <FileText :size="24" class="mx-auto text-slate-300 dark:text-slate-700" />
                <p class="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No matching documents</p>
                <p class="mt-1 text-xs text-slate-400 dark:text-slate-500">Try fewer words or remove a tag filter.</p>
              </div>
            </div>
            <ul v-else class="space-y-1">
              <li v-for="(result, index) in documents.searchResults" :key="result.path">
                <button
                  :data-search-result="index"
                  type="button"
                  class="group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition"
                  :class="activeResult === index ? 'border-[#36c] bg-[#eef3ff] dark:border-[#6ea6ff] dark:bg-[#182235]' : 'border-transparent hover:bg-slate-50 dark:hover:bg-[#15181c]'"
                  @mouseenter="activeResult = index"
                  @click="openResult(result)"
                >
                  <span class="grid size-8 shrink-0 place-items-center border border-slate-200 bg-white text-slate-400 group-hover:text-[#36c] dark:border-slate-700 dark:bg-[#101214] dark:text-slate-500 dark:group-hover:text-[#6ea6ff]"><FileText :size="15" /></span>
                  <span class="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <span class="truncate font-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100">{{ fileName(result.path) }}</span>
                    <span v-if="result.tags.length" class="flex shrink-0 flex-wrap gap-1">
                      <span v-for="tag in result.tags" :key="tag" class="tag-label">{{ tag }}</span>
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <footer class="flex h-10 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-[#15181c] dark:text-slate-500">
            <span>{{ documents.searchResults.length }} result{{ documents.searchResults.length === 1 ? '' : 's' }}</span>
            <span class="hidden items-center gap-3 sm:flex"><span>↑↓ Navigate</span><span>Enter Open</span><span>Esc Close</span></span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
