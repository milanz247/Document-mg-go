<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { AlertTriangle, ChevronRight, FileText, Folder, FolderOpen, LoaderCircle, Trash2, X } from '@lucide/vue'
import { documentsApi } from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import { useDocumentsStore } from '../../stores/documents'
import type { NavigationNode } from '../../types/documents'
import { documentRoute } from '../../utils/routes'

const props = defineProps<{ node: NavigationNode }>()
const documents = useDocumentsStore()
const auth = useAuthStore()
const route = useRoute()
const showDeleteDialog = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const expanded = computed(() => documents.openFolders.has(props.node.path))
const target = computed(() => documentRoute(props.node.path))
const active = computed(() => decodeURI(route.path).toLowerCase() === decodeURI(target.value).toLowerCase())

async function deleteFolder(): Promise<void> {
  deleting.value = true
  deleteError.value = ''
  try {
    await documentsApi.deleteFolder(props.node.path)
    documents.forgetFolder(props.node.path)
    await documents.loadNavigation()
    showDeleteDialog.value = false
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : 'Unable to delete this folder.'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <li>
    <div v-if="node.type === 'folder'" class="group/folder flex min-w-0 items-center">
      <button
        class="tree-row group min-w-0 flex-1 text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-[#12161b] dark:hover:text-slate-100"
        type="button"
        :title="node.name"
        :aria-expanded="expanded"
        @click="documents.toggleFolder(node.path)"
      >
        <ChevronRight :size="13" class="shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-600" :class="{ 'rotate-90': expanded }" />
        <FolderOpen v-if="expanded" :size="15" class="shrink-0 text-[#36c] dark:text-[#6ea6ff]" />
        <Folder v-else :size="15" class="shrink-0 text-slate-400 group-hover:text-[#36c] dark:text-slate-600 dark:group-hover:text-[#6ea6ff]" />
        <span class="truncate font-semibold">{{ node.name }}</span>
      </button>
      <button
        v-if="auth.isAuthenticated"
        class="grid size-8 shrink-0 place-items-center text-slate-400 opacity-100 transition hover:bg-rose-50 hover:text-rose-700 focus:opacity-100 dark:text-slate-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400 sm:opacity-0 sm:group-hover/folder:opacity-100"
        type="button"
        :aria-label="`Delete ${node.name} folder`"
        title="Delete empty folder"
        @click="deleteError = ''; showDeleteDialog = true"
      >
        <Trash2 :size="13" />
      </button>
    </div>

    <RouterLink
      v-else
      class="tree-row group border-l-2"
      :class="active ? 'border-[#36c] bg-[#eef3ff] font-semibold text-[#202122] dark:border-[#6ea6ff] dark:bg-[#182235] dark:text-white' : 'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-[#36c] dark:text-slate-500 dark:hover:border-slate-700 dark:hover:bg-[#12161b] dark:hover:text-[#6ea6ff]'"
      :to="target"
      :title="node.path"
      :aria-current="active ? 'page' : undefined"
      @click="documents.sidebarOpen = false"
    >
      <span class="w-[13px] shrink-0"></span>
      <FileText :size="14" class="shrink-0 text-slate-400 group-hover:text-current dark:text-slate-600" :class="active ? '!text-[#36c] dark:!text-[#6ea6ff]' : ''" />
      <span class="truncate">{{ node.name }}</span>
    </RouterLink>

    <Transition name="folder">
      <ul v-if="node.type === 'folder' && expanded" class="ml-[18px] border-l border-slate-200 pl-1.5 dark:border-slate-800">
        <SidebarNode v-for="child in node.children" :key="child.path" :node="child" />
      </ul>
    </Transition>

    <Teleport to="body">
      <div v-if="showDeleteDialog" class="fixed inset-0 z-[95] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="folder-delete-title" @click.self="!deleting && (showDeleteDialog = false)">
        <section class="w-full max-w-md border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111315]">
          <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <span class="grid size-10 shrink-0 place-items-center bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><AlertTriangle :size="18" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="folder-delete-title" class="wiki-heading text-xl text-slate-950 dark:text-white">Delete empty folder?</h2>
              <p class="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{{ node.path }}</p>
            </div>
            <button class="grid size-8 place-items-center text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800" type="button" aria-label="Close" :disabled="deleting" @click="showDeleteDialog = false"><X :size="17" /></button>
          </header>
          <div class="p-5">
            <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">Only a completely empty folder can be deleted. A folder containing Markdown files, other files, or nested folders will be protected.</p>
            <p v-if="deleteError" class="mt-4 border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">{{ deleteError }}</p>
            <div class="mt-5 flex justify-end gap-2">
              <button class="h-9 border border-slate-300 px-4 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300" type="button" :disabled="deleting" @click="showDeleteDialog = false">Cancel</button>
              <button class="flex h-9 items-center gap-2 bg-rose-700 px-4 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60" type="button" :disabled="deleting" @click="deleteFolder">
                <LoaderCircle v-if="deleting" :size="14" class="animate-spin" />
                <Trash2 v-else :size="14" />
                {{ deleting ? 'Deleting...' : 'Delete folder' }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </li>
</template>
