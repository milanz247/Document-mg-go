<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { KeyRound, LoaderCircle, LockKeyhole, Moon, Sun } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const theme = useThemeStore()
const username = ref('')
const password = ref('')
const error = ref('')
const redirectPath = computed(() => typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/docs')

async function submit(): Promise<void> {
  error.value = ''
  try {
    await auth.login(username.value, password.value)
    await router.replace(redirectPath.value)
  } catch (loginError) {
    error.value = loginError instanceof Error ? loginError.message : 'Unable to sign in.'
  }
}
</script>

<template>
  <main class="relative grid min-h-screen place-items-center bg-[#f8f9fa] px-5 py-12 text-[#202122] dark:bg-[#0b0d10] dark:text-slate-200">
    <button
      class="absolute right-5 top-5 grid size-9 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#111315] dark:text-slate-300 dark:hover:bg-slate-800"
      type="button"
      :aria-label="theme.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      @click="theme.toggle"
    >
      <Sun v-if="theme.theme === 'dark'" :size="17" />
      <Moon v-else :size="17" />
    </button>

    <section class="w-full max-w-[420px]">
      <div class="mb-8 text-center">
        <div class="wiki-mark mx-auto grid size-14 place-items-center border border-slate-900 bg-white text-3xl dark:border-slate-300 dark:bg-[#0b0d10]">A</div>
        <h1 class="wiki-wordmark mt-4 text-3xl text-slate-950 dark:text-white">Atlas Wiki</h1>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Private engineering knowledge base</p>
      </div>

      <form class="border border-slate-300 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-[#111315] sm:p-8" @submit.prevent="submit">
        <div class="mb-6 flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <span class="grid size-9 place-items-center bg-[#eaecf0] text-slate-700 dark:bg-slate-800 dark:text-slate-200"><LockKeyhole :size="17" /></span>
          <div>
            <h2 class="text-sm font-semibold text-slate-900 dark:text-white">Administrator sign in</h2>
            <p class="mt-0.5 text-xs text-slate-500">Your documentation is private.</p>
          </div>
        </div>

        <p v-if="error" role="alert" class="mb-4 border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {{ error }}
        </p>

        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Username
          <input v-model="username" class="mt-1.5 h-10 w-full border border-slate-400 bg-white px-3 text-sm font-normal outline-none focus:border-[#36c] focus:ring-1 focus:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10] dark:text-white" autocomplete="username" required autofocus />
        </label>
        <label class="mt-4 block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Password
          <input v-model="password" type="password" class="mt-1.5 h-10 w-full border border-slate-400 bg-white px-3 text-sm font-normal outline-none focus:border-[#36c] focus:ring-1 focus:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10] dark:text-white" autocomplete="current-password" required />
        </label>

        <button class="mt-6 flex h-10 w-full items-center justify-center gap-2 bg-[#36c] px-4 text-sm font-semibold text-white hover:bg-[#2a4b8d] disabled:cursor-not-allowed disabled:opacity-60" type="submit" :disabled="auth.loading">
          <LoaderCircle v-if="auth.loading" :size="16" class="animate-spin" />
          <KeyRound v-else :size="16" />
          {{ auth.loading ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>
    </section>
  </main>
</template>

