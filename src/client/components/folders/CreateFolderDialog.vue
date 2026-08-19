<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FolderPlus, LoaderCircle, X } from '@lucide/vue'
import { documentsApi } from '../../api/client'
import { useDocumentsStore } from '../../stores/documents'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; created: [path: string] }>()
const documents = useDocumentsStore()
const input = ref<HTMLInputElement | null>(null)
const folderPath = ref('')
const error = ref('')
const saving = ref(false)
let previousBodyOverflow = ''

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
}

async function createFolder(): Promise<void> {
  error.value = ''
  const normalized = normalizePath(folderPath.value)
  if (!normalized || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    error.value = 'Enter a valid path such as Engineering/Runbooks.'
    return
  }
  saving.value = true
  try {
    const created = await documentsApi.createFolder(normalized)
    await documents.loadNavigation()
    documents.revealDocument(`${created.path}/new-page.md`)
    window.dispatchEvent(new CustomEvent('atlas:folder-created', { detail: { path: created.path } }))
    emit('created', created.path)
    emit('close')
  } catch (createError) {
    error.value = createError instanceof Error ? createError.message : 'Unable to create folder.'
  } finally {
    saving.value = false
  }
}

watch(() => props.open, async (open) => {
	if (!open) {
		document.body.style.overflow = previousBodyOverflow
		return
	}
	previousBodyOverflow = document.body.style.overflow
	document.body.style.overflow = 'hidden'
  folderPath.value = ''
  error.value = ''
  await nextTick()
  input.value?.focus()
})

onBeforeUnmount(() => {
	document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[110] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-[4px] dark:bg-black/65" role="presentation" @mousedown.self="emit('close')">
        <form class="w-full max-w-md border border-slate-300 bg-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.65)] dark:border-slate-700 dark:bg-[#101214]" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" @submit.prevent="createFolder" @keydown.esc.prevent="emit('close')">
          <header class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div class="flex items-center gap-3">
              <span class="grid size-9 place-items-center border border-slate-300 bg-slate-50 text-[#36c] dark:border-slate-700 dark:bg-[#15181c] dark:text-[#6ea6ff]"><FolderPlus :size="17" /></span>
              <div>
                <h2 id="folder-dialog-title" class="text-sm font-semibold text-slate-950 dark:text-white">Create documentation folder</h2>
                <p class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">The parent folder must already exist.</p>
              </div>
            </div>
            <button type="button" class="grid size-8 place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Close" @click="emit('close')"><X :size="17" /></button>
          </header>

          <div class="p-5">
            <label for="folder-path" class="block text-xs font-semibold text-slate-700 dark:text-slate-300">Folder path</label>
            <div class="mt-2 flex h-11 items-center border border-slate-400 bg-white px-3 focus-within:border-[#36c] focus-within:ring-1 focus-within:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10]">
              <span class="mr-1 font-mono text-xs text-slate-400">docs/</span>
              <input ref="input" id="folder-path" v-model="folderPath" class="min-w-0 flex-1 bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-600" type="text" maxlength="240" placeholder="Engineering/Runbooks" />
            </div>
            <p v-if="error" class="mt-3 border-l-2 border-rose-600 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{{ error }}</p>
          </div>

          <footer class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-[#15181c]">
            <button type="button" class="h-9 border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#101214] dark:text-slate-300 dark:hover:bg-slate-800" @click="emit('close')">Cancel</button>
            <button type="submit" class="flex h-9 items-center gap-2 bg-[#36c] px-4 text-xs font-semibold text-white hover:bg-[#2a4b8d] disabled:opacity-60" :disabled="saving">
              <LoaderCircle v-if="saving" :size="14" class="animate-spin" />
              <FolderPlus v-else :size="14" /> Create folder
            </button>
          </footer>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
