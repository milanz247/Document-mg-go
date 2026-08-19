<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronRight, Copy, FileText, RefreshCw, Star } from '@lucide/vue'
import { useDocumentsStore } from '../../stores/documents'

const props = defineProps<{ path: string; refreshing?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const documents = useDocumentsStore()
const copied = ref(false)
const segments = computed(() => props.path.replace(/\.md$/i, '').split('/'))

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="flex min-h-11 flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-3 py-1.5 dark:border-slate-800 dark:bg-[#0e1116]">
    <div class="flex min-w-0 flex-1 items-center text-xs font-medium text-slate-400 dark:text-slate-500" aria-label="Document location">
      <span class="mr-1.5 grid size-6 shrink-0 place-items-center text-slate-500 dark:text-slate-400">
        <FileText :size="14" />
      </span>
      <template v-for="(segment, index) in segments" :key="`${segment}-${index}`">
        <ChevronRight v-if="index > 0" :size="12" class="mx-1 shrink-0 text-slate-300 dark:text-slate-700" />
        <span class="truncate" :class="index === segments.length - 1 ? 'font-semibold text-slate-800 dark:text-slate-200' : ''">{{ segment }}</span>
      </template>
    </div>

    <div class="ml-auto flex items-center gap-1.5">
      <button class="document-action" type="button" :aria-label="documents.isFavorite(path) ? 'Remove from favorites' : 'Add to favorites'" @click="documents.toggleFavorite(path)">
        <Star :size="14" :fill="documents.isFavorite(path) ? 'currentColor' : 'none'" :class="documents.isFavorite(path) ? 'text-amber-500' : ''" />
        <span class="hidden sm:inline">{{ documents.isFavorite(path) ? 'Favorited' : 'Favorite' }}</span>
      </button>
      <button class="document-action" type="button" :aria-label="copied ? 'Link copied' : 'Copy document link'" @click="copyLink">
        <Check v-if="copied" :size="14" class="text-emerald-600" />
        <Copy v-else :size="14" />
        <span class="hidden sm:inline">{{ copied ? 'Copied' : 'Copy link' }}</span>
      </button>
      <button class="document-action" type="button" :disabled="refreshing" aria-label="Reload document" @click="emit('refresh')">
        <RefreshCw :size="14" :class="{ 'animate-spin': refreshing }" />
        <span class="hidden sm:inline">Reload</span>
      </button>
    </div>
  </div>
</template>
