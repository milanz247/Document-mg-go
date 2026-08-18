<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronRight, FileText, Folder, FolderOpen } from '@lucide/vue'
import { useDocumentsStore } from '../../stores/documents'
import type { NavigationNode } from '../../types/documents'
import { documentRoute } from '../../utils/routes'

const props = defineProps<{ node: NavigationNode }>()
const documents = useDocumentsStore()
const route = useRoute()
const expanded = computed(() => documents.openFolders.has(props.node.path))
const target = computed(() => documentRoute(props.node.path))
const active = computed(() => decodeURI(route.path).toLowerCase() === decodeURI(target.value).toLowerCase())
</script>

<template>
  <li>
    <button
      v-if="node.type === 'folder'"
      class="tree-row group text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-[#12161b] dark:hover:text-slate-100"
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
  </li>
</template>
