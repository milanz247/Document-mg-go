<script setup lang="ts">
import { ArrowLeft, Compass } from '@lucide/vue'
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-slate-50 px-6 dark:bg-[#0b0d10]">
    <section class="max-w-md text-center">
      <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-50 text-accent-600 dark:bg-slate-800 dark:text-white">
        <Compass :size="27" />
      </div>
      <p class="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-accent-600 dark:text-slate-400">404</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-ink dark:text-white">This route doesn’t exist</h1>
      <p class="mt-3 leading-7 text-slate-500 dark:text-slate-400">The page may have moved, or the address may be incorrect.</p>
      <RouterLink class="button-primary mt-7 inline-flex" to="/docs">
        <ArrowLeft :size="16" /> Return to documentation
      </RouterLink>
    </section>
  </main>
</template>
