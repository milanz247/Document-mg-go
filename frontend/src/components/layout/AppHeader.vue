<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LockKeyhole, Menu, Moon, RefreshCw, Search, ShieldCheck, Sun } from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import UnlockEditingDialog from '../auth/UnlockEditingDialog.vue'
import CreateFolderDialog from '../folders/CreateFolderDialog.vue'
import SearchOverlay from '../search/SearchOverlay.vue'
import { useAuthStore } from '../../stores/auth'
import { useDocumentsStore } from '../../stores/documents'
import { useThemeStore } from '../../stores/theme'
import { editorRoute, routeToDocumentPath } from '../../utils/routes'

const documents = useDocumentsStore()
const theme = useThemeStore()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const searchOpen = ref(false)
const folderDialogOpen = ref(false)
const unlockOpen = ref(false)
const pendingEditorRoute = ref('')
const currentEditorRoute = computed(() => documents.homeFallback && route.path === '/docs'
  ? '/editor/new?path=index.md&template=welcome'
  : editorRoute(routeToDocumentPath(route.params.documentPath)))

function safeInternalPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

async function requestEdit(): Promise<void> {
  if (auth.isAuthenticated) {
    await router.push(currentEditorRoute.value)
    return
  }
  pendingEditorRoute.value = currentEditorRoute.value
  unlockOpen.value = true
}

async function editingUnlocked(): Promise<void> {
  const target = safeInternalPath(pendingEditorRoute.value) ? pendingEditorRoute.value : currentEditorRoute.value
  unlockOpen.value = false
  pendingEditorRoute.value = ''
  await router.push(target)
}

async function closeUnlock(): Promise<void> {
  unlockOpen.value = false
  pendingEditorRoute.value = ''
  if (route.query.unlock !== undefined) {
    const query = { ...route.query }
    delete query.unlock
    await router.replace({ path: route.path, query, hash: route.hash })
  }
}

async function lockEditing(): Promise<void> {
  await auth.lock()
  await router.push('/docs')
}

async function refreshDocumentation(): Promise<void> {
  await documents.loadNavigation()
  window.dispatchEvent(new Event('atlas:refresh-document'))
}

function handleSearchShortcut(event: KeyboardEvent): void {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    searchOpen.value = true
  }
}

function openFolderDialog(): void {
  if (auth.isAuthenticated) {
    folderDialogOpen.value = true
  }
}

watch(() => route.query.unlock, (target) => {
  if (!safeInternalPath(target)) return
  pendingEditorRoute.value = target
  if (auth.isAuthenticated) {
    void router.replace(target)
  } else {
    unlockOpen.value = true
  }
}, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', handleSearchShortcut)
  window.addEventListener('atlas:request-edit', requestEdit)
  window.addEventListener('atlas:open-folder-dialog', openFolderDialog)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSearchShortcut)
  window.removeEventListener('atlas:request-edit', requestEdit)
  window.removeEventListener('atlas:open-folder-dialog', openFolderDialog)
})
</script>

<template>
  <header class="sticky top-0 z-40 h-16 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-[#0b0d10]/95">
    <div class="grid h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 sm:px-4 lg:px-6">
      <div class="flex min-w-0 items-center">
        <button
          class="mr-2 grid size-10 shrink-0 place-items-center text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
          type="button"
          aria-label="Open documentation navigation"
          @click="documents.sidebarOpen = true"
        >
          <Menu :size="21" />
        </button>

        <RouterLink class="group flex min-w-0 items-center gap-3" to="/docs">
          <span class="wiki-mark grid size-9 shrink-0 place-items-center border border-slate-900 bg-white text-xl text-slate-950 dark:border-slate-300 dark:bg-[#0b0d10] dark:text-white sm:size-10 sm:text-2xl">
            M
          </span>
          <span class="hidden min-w-0 sm:block">
            <span class="wiki-wordmark block truncate text-[17px] leading-5 tracking-wide text-slate-950 dark:text-white">Milan's Wiki</span>
            <!-- <span class="hidden truncate text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-500 md:block">Technical knowledge base</span> -->
          </span>
        </RouterLink>
      </div>

      <button
        class="group flex h-9 w-10 items-center justify-center border border-slate-300 bg-[#f8f9fa] text-slate-500 transition hover:border-slate-400 hover:bg-white hover:text-slate-800 dark:border-slate-700 dark:bg-[#15181c] dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-[#1a1e23] dark:hover:text-white sm:w-[min(40vw,31rem)] sm:justify-start sm:px-3"
        type="button"
        aria-label="Open document search"
        title="Search documentation (Ctrl+Alt+S)"
        @click="searchOpen = true"
      >
        <Search :size="16" class="shrink-0 text-slate-400 group-hover:text-[#36c] dark:text-slate-500 dark:group-hover:text-[#6ea6ff]" />
        <span class="ml-2 hidden flex-1 text-left text-[12px] sm:block">Search documentation</span>
        <span class="ml-3 hidden items-center gap-1 lg:flex">
          <kbd class="border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[9px] text-slate-400 dark:border-slate-600 dark:bg-[#101214] dark:text-slate-500">Ctrl</kbd>
          <kbd class="border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[9px] text-slate-400 dark:border-slate-600 dark:bg-[#101214] dark:text-slate-500">Alt</kbd>
          <kbd class="border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[9px] text-slate-400 dark:border-slate-600 dark:bg-[#101214] dark:text-slate-500">S</kbd>
        </span>
      </button>

      <div class="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
        <button
          class="grid size-9 shrink-0 place-items-center border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-[#36c] disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-[#15181c] dark:hover:text-[#6ea6ff]"
          type="button"
          :disabled="documents.navigationLoading"
          :aria-label="documents.navigationLoading ? 'Refreshing documentation' : 'Refresh documentation'"
          :title="documents.navigationLoading ? 'Refreshing documentation...' : 'Refresh documentation'"
          @click="refreshDocumentation"
        >
          <RefreshCw :size="15" :class="{ 'animate-spin': documents.navigationLoading }" />
        </button>
        <span v-if="auth.isAuthenticated" class="hidden items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 2xl:flex">
          <ShieldCheck :size="14" /> Editing unlocked
        </span>
        <span v-if="auth.isAuthenticated" class="hidden h-5 w-px bg-slate-300 dark:bg-slate-700 xl:block"></span>
        <button
          class="grid size-9 shrink-0 place-items-center border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          type="button"
          :aria-label="theme.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          :title="theme.theme === 'dark' ? 'Light theme' : 'Dark theme'"
          @click="theme.toggle"
        >
          <Sun v-if="theme.theme === 'dark'" :size="17" />
          <Moon v-else :size="17" />
        </button>
        <button v-if="auth.isAuthenticated" class="grid size-9 shrink-0 place-items-center border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" type="button" title="Lock editing" aria-label="Lock editing" @click="lockEditing">
          <LockKeyhole :size="16" />
        </button>
      </div>
    </div>
  </header>

  <SearchOverlay :open="searchOpen" @close="searchOpen = false" />
  <UnlockEditingDialog :open="unlockOpen" @close="closeUnlock" @unlocked="editingUnlocked" />
  <CreateFolderDialog :open="folderDialogOpen && auth.isAuthenticated" @close="folderDialogOpen = false" />
</template>
