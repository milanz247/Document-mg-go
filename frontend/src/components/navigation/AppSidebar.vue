<script setup lang="ts">
import { X } from '@lucide/vue'
import { useDocumentsStore } from '../../stores/documents'
import SidebarNode from './SidebarNode.vue'

const documents = useDocumentsStore()
</script>

<template>
  <Transition name="fade">
    <button
      v-if="documents.sidebarOpen"
      class="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] lg:hidden"
      type="button"
      aria-label="Close documentation navigation"
      @click="documents.sidebarOpen = false"
    ></button>
  </Transition>

  <aside
    class="fixed bottom-0 left-0 top-0 z-50 flex w-[min(88vw,19rem)] flex-col border-r border-slate-200 bg-white pt-4 shadow-2xl transition-colors duration-300 dark:border-slate-800 dark:bg-[#0b0d10] lg:sticky lg:top-[64px] lg:z-20 lg:h-[calc(100vh-64px)] lg:w-[18rem] lg:shrink-0 lg:translate-x-0 lg:pt-0 lg:shadow-none"
    :class="documents.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="flex h-12 items-center justify-between px-5 lg:hidden">
      <span class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Contents</span>
      <button class="p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" type="button" @click="documents.sidebarOpen = false">
        <X :size="19" />
      </button>
    </div>

    <div class="hidden h-10 items-center border-b border-slate-200 px-4 dark:border-slate-800 lg:flex">
      <span class="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-600">Contents</span>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Documentation">
      <div v-if="documents.navigationLoading && !documents.hasNavigation" class="space-y-2 px-2 py-2">
        <div v-for="index in 6" :key="index" class="h-9 animate-pulse border-l-2 border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-[#101214]"></div>
      </div>
      <p v-else-if="documents.navigationError" class="m-2 border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        {{ documents.navigationError }}
      </p>
      <p v-else-if="!documents.hasNavigation" class="px-3 py-6 text-sm leading-6 text-slate-500 dark:text-slate-400">
        No Markdown files found. Add a <code>.md</code> file to the docs folder, then refresh.
      </p>
      <ul v-else class="space-y-0.5">
        <SidebarNode v-for="node in documents.navigation" :key="node.path" :node="node" />
      </ul>
    </nav>
  </aside>
</template>
