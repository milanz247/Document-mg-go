<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Component } from 'vue'
import { useRouter } from 'vue-router'
import { Command, FilePlus2, FileText, FolderPlus, Pencil, Search, X } from '@lucide/vue'
import { useAuthStore } from '../../stores/auth'
import { useDocumentsStore } from '../../stores/documents'
import type { NavigationNode } from '../../types/documents'
import { documentRoute } from '../../utils/routes'

type PaletteItem = { id: string; label: string; detail: string; icon: Component; run: () => void | Promise<void> }

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const auth = useAuthStore()
const documents = useDocumentsStore()
const query = ref('')
const selected = ref(0)
const input = ref<HTMLInputElement | null>(null)

function flatten(nodes: NavigationNode[]): NavigationNode[] {
  return nodes.flatMap((node) => node.type === 'document' ? [node] : flatten(node.children ?? []))
}

function finish(action: () => void | Promise<void>): void {
  emit('close')
  void action()
}

const items = computed<PaletteItem[]>(() => {
  const actions: PaletteItem[] = [
    { id: 'search', label: 'Search documentation', detail: 'Full text and tag search', icon: Search, run: () => { window.dispatchEvent(new Event('atlas:open-search')) } },
    { id: 'edit', label: auth.isAuthenticated ? 'Edit current page' : 'Unlock editing', detail: auth.isAuthenticated ? 'Open the Markdown editor' : 'Enter the editing password', icon: Pencil, run: () => { window.dispatchEvent(new Event('atlas:request-edit')) } },
  ]
  if (auth.isAuthenticated) {
    actions.push(
      { id: 'new-page', label: 'Create new page', detail: 'Start a Markdown document', icon: FilePlus2, run: async () => { await router.push('/editor/new') } },
      { id: 'new-folder', label: 'Create new folder', detail: 'Add to the document tree', icon: FolderPlus, run: () => { window.dispatchEvent(new Event('atlas:open-folder-dialog')) } },
    )
  }
  const normalized = query.value.trim().toLowerCase()
  const matchingActions = actions.filter((item) => !normalized || `${item.label} ${item.detail}`.toLowerCase().includes(normalized))
  const pages = flatten(documents.navigation)
    .filter((node) => !normalized || `${node.name} ${node.path} ${(node.tags ?? []).join(' ')}`.toLowerCase().includes(normalized))
    .slice(0, normalized ? 12 : 6)
    .map<PaletteItem>((node) => ({ id: `page:${node.path}`, label: node.name, detail: node.path, icon: FileText, run: async () => { await router.push(documentRoute(node.path)) } }))
  return [...matchingActions, ...pages]
})

function choose(item: PaletteItem | undefined): void {
  if (item) finish(item.run)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowDown') { event.preventDefault(); selected.value = Math.min(selected.value + 1, items.value.length - 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); selected.value = Math.max(selected.value - 1, 0) }
  else if (event.key === 'Enter') { event.preventDefault(); choose(items.value[selected.value]) }
}

watch(() => props.open, async (open) => {
  if (!open) return
  query.value = ''
  selected.value = 0
  await nextTick()
  input.value?.focus()
})
watch(query, () => { selected.value = 0 })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[110] flex justify-center bg-slate-950/65 px-4 pt-[10vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Command palette" @click.self="emit('close')">
      <section class="h-fit w-full max-w-2xl overflow-hidden border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111315]">
        <div class="flex h-14 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
          <Command :size="18" class="text-[#36c] dark:text-[#6ea6ff]" />
          <input ref="input" v-model="query" class="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" placeholder="Type a command or page name..." @keydown="handleKeydown" />
          <kbd class="border border-slate-300 px-1.5 py-0.5 text-[9px] text-slate-400 dark:border-slate-700">Esc</kbd>
          <button class="grid size-8 place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" type="button" aria-label="Close" @click="emit('close')"><X :size="16" /></button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-2">
          <button v-for="(item, index) in items" :key="item.id" class="flex w-full items-center gap-3 px-3 py-2.5 text-left" :class="index === selected ? 'bg-[#eef3ff] text-[#202122] dark:bg-[#182235] dark:text-white' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#181a1d]'" type="button" @mouseenter="selected = index" @click="choose(item)">
            <span class="grid size-8 shrink-0 place-items-center border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-[#0b0d10] dark:text-slate-400"><component :is="item.icon" :size="15" /></span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">{{ item.label }}</span><span class="block truncate text-[11px] text-slate-400 dark:text-slate-500">{{ item.detail }}</span></span>
          </button>
          <p v-if="!items.length" class="px-4 py-10 text-center text-sm text-slate-500">No matching command or document.</p>
        </div>
        <footer class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-[#0e1116] dark:text-slate-500"><span>Navigate with ↑ ↓ and Enter</span><span>Ctrl+K</span></footer>
      </section>
    </div>
  </Teleport>
</template>
