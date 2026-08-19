<script setup lang="ts">
import { FolderPlus, Pencil, Plus, ShieldCheck, Star, X } from '@lucide/vue'
import { useAuthStore } from '../../stores/auth'
import { useDocumentsStore } from '../../stores/documents'
import SidebarNode from './SidebarNode.vue'

const documents = useDocumentsStore()
const auth = useAuthStore()

function requestEdit(): void {
  documents.sidebarOpen = false
  window.dispatchEvent(new Event('atlas:request-edit'))
}

function requestFolder(): void {
  documents.sidebarOpen = false
  window.dispatchEvent(new Event('atlas:open-folder-dialog'))
}

function closeSidebar(): void {
  documents.sidebarOpen = false
}
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
      <template v-else>
        <section v-if="documents.favoriteDocuments.length" class="mb-4 border-b border-slate-200 pb-3 dark:border-slate-800">
          <p class="mb-1 flex items-center gap-1.5 px-2 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-600"><Star :size="11" /> Favorites</p>
          <ul class="space-y-0.5"><SidebarNode v-for="node in documents.favoriteDocuments" :key="`favorite-${node.path}`" :node="node" /></ul>
        </section>
        <ul class="space-y-0.5">
          <SidebarNode v-for="node in documents.displayNavigation" :key="node.path" :node="node" />
        </ul>
      </template>
    </nav>

    <footer class="border-t border-slate-200 px-3 py-3 dark:border-slate-800" aria-label="Document actions">
      <div class="mb-2 flex items-center justify-between px-1">
        <p class="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-600">Page actions</p>
        <span v-if="auth.isAuthenticated" class="flex items-center gap-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400"><ShieldCheck :size="11" /> Unlocked</span>
      </div>
      <button class="flex h-10 w-full items-center gap-2.5 border border-[#36c] px-3 text-left text-xs font-semibold text-[#36c] transition hover:bg-[#eef3ff] dark:border-[#6ea6ff] dark:text-[#6ea6ff] dark:hover:bg-slate-800" type="button" @click="requestEdit">
        <Pencil :size="15" />
        <span>Edit current page</span>
      </button>

      <div v-if="auth.isAuthenticated" class="mt-2 grid grid-cols-2 gap-2">
        <RouterLink class="flex h-9 items-center justify-center gap-2 bg-[#36c] px-2 text-[11px] font-semibold text-white hover:bg-[#2a4b8d]" to="/editor/new" @click="closeSidebar">
          <Plus :size="14" /> New page
        </RouterLink>
        <button class="flex h-9 items-center justify-center gap-2 border border-slate-300 px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" type="button" @click="requestFolder">
          <FolderPlus :size="14" /> New folder
        </button>
      </div>
    </footer>
  </aside>
</template>
