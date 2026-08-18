<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRightLeft, LoaderCircle, X } from '@lucide/vue'
import { documentsApi } from '../../api/client'
import { useDocumentsStore } from '../../stores/documents'
import type { NavigationNode } from '../../types/documents'
import { documentRoute, routeToDocumentPath } from '../../utils/routes'

const props = defineProps<{ open: boolean; node: NavigationNode }>()
const emit = defineEmits<{ close: []; moved: [] }>()
const documents = useDocumentsStore()
const route = useRoute()
const router = useRouter()
const target = ref('')
const moving = ref(false)
const error = ref('')
const label = computed(() => props.node.type === 'folder' ? 'Folder path' : 'Markdown file path')

watch(() => props.open, (open) => {
  if (!open) return
  target.value = props.node.path
  error.value = ''
})

function normalizedTarget(): string {
  let value = target.value.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (props.node.type === 'document' && value && !value.toLowerCase().endsWith('.md')) value += '.md'
  return value
}

async function move(): Promise<void> {
  const destination = normalizedTarget()
  if (!destination) {
    error.value = 'Enter a destination path.'
    return
  }
  moving.value = true
  error.value = ''
  try {
    await documentsApi.move(props.node.path, destination, props.node.type)
    const current = routeToDocumentPath(route.params.documentPath)
    const affected = current === props.node.path || (props.node.type === 'folder' && current.startsWith(`${props.node.path}/`))
    const nextDocument = current === props.node.path
      ? destination
      : `${destination}${current.slice(props.node.path.length)}`
    documents.remapPath(props.node.path, destination)
    await documents.loadNavigation()
    emit('moved')
    emit('close')
    if (affected) await router.replace(documentRoute(nextDocument))
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : 'Unable to move this item.'
  } finally {
    moving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[96] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="move-title" @click.self="!moving && emit('close')">
      <section class="w-full max-w-lg border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111315]">
        <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span class="grid size-10 shrink-0 place-items-center bg-[#eef3ff] text-[#36c] dark:bg-slate-800 dark:text-[#6ea6ff]"><ArrowRightLeft :size="18" /></span>
          <div class="min-w-0 flex-1">
            <h2 id="move-title" class="wiki-heading text-xl text-slate-950 dark:text-white">Move or rename {{ node.type }}</h2>
            <p class="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{{ node.path }}</p>
          </div>
          <button class="grid size-8 place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" type="button" aria-label="Close" :disabled="moving" @click="emit('close')"><X :size="17" /></button>
        </header>
        <form class="p-5" @submit.prevent="move">
          <label for="move-target" class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ label }}</label>
          <input id="move-target" v-model="target" class="mt-2 h-11 w-full border border-slate-400 bg-white px-3 font-mono text-sm outline-none focus:border-[#36c] focus:ring-1 focus:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10] dark:text-white" autocomplete="off" />
          <p class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Change only the name to rename it, or change the parent path to move it into another folder.</p>
          <p v-if="error" class="mt-4 border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">{{ error }}</p>
          <div class="mt-5 flex justify-end gap-2">
            <button class="h-9 border border-slate-300 px-4 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300" type="button" :disabled="moving" @click="emit('close')">Cancel</button>
            <button class="flex h-9 items-center gap-2 bg-[#36c] px-4 text-xs font-semibold text-white hover:bg-[#2a4b8d] disabled:cursor-wait disabled:opacity-60" type="submit" :disabled="moving">
              <LoaderCircle v-if="moving" :size="14" class="animate-spin" />
              <ArrowRightLeft v-else :size="14" />
              {{ moving ? 'Moving...' : 'Save path' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
