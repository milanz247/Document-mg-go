<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/navigation/AppSidebar.vue'
import { useDocumentsStore } from '../stores/documents'

const documents = useDocumentsStore()
onMounted(() => documents.loadNavigation())
</script>

<template>
  <div class="min-h-screen bg-white text-slate-700 transition-colors dark:bg-[#0b0d10] dark:text-slate-300">
    <AppHeader />
    <div class="flex w-full items-start">
      <AppSidebar />
      <main class="document-canvas min-w-0 flex-1 self-stretch">
        <RouterView />
      </main>
    </div>
  </div>
</template>
