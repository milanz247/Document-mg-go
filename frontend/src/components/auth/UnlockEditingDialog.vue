<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, X } from '@lucide/vue'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; unlocked: [] }>()
const auth = useAuthStore()
const password = ref('')
const error = ref('')
const showPassword = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)

watch(() => props.open, async (open) => {
  if (!open) return
  password.value = ''
  error.value = ''
  showPassword.value = false
  await nextTick()
  passwordInput.value?.focus()
})

function close(): void {
  if (!auth.loading) emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') close()
}

async function submit(): Promise<void> {
  error.value = ''
  try {
    await auth.unlock(password.value)
    emit('unlocked')
  } catch (unlockError) {
    error.value = unlockError instanceof Error ? unlockError.message : 'Unable to unlock editing.'
    passwordInput.value?.focus()
    passwordInput.value?.select()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 px-4 backdrop-blur-sm" @click.self="close">
        <section class="w-full max-w-[410px] border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111315]" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
          <header class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <span class="grid size-10 shrink-0 place-items-center bg-[#eef3ff] text-[#36c] dark:bg-slate-800 dark:text-[#6ea6ff]">
              <LockKeyhole :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="unlock-title" class="wiki-heading text-xl text-slate-950 dark:text-white">Unlock editing</h2>
              <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Enter the administrator password to enable editing tools for this session.</p>
            </div>
            <button class="grid size-8 shrink-0 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white" type="button" aria-label="Close" @click="close">
              <X :size="17" />
            </button>
          </header>

          <form class="p-5" @submit.prevent="submit">
            <p v-if="error" class="mb-4 border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" role="alert">{{ error }}</p>

            <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Secure password
              <span class="relative mt-1.5 block">
                <KeyRound :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref="passwordInput"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  class="h-11 w-full border border-slate-400 bg-white pl-9 pr-11 text-sm font-normal outline-none focus:border-[#36c] focus:ring-1 focus:ring-[#36c] dark:border-slate-600 dark:bg-[#0b0d10] dark:text-white"
                  autocomplete="current-password"
                  required
                />
                <button class="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-slate-400 hover:text-slate-800 dark:hover:text-white" type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                  <EyeOff v-if="showPassword" :size="16" />
                  <Eye v-else :size="16" />
                </button>
              </span>
            </label>

            <div class="mt-5 flex items-center justify-end gap-2">
              <button class="h-10 border border-slate-300 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" type="button" :disabled="auth.loading" @click="close">Cancel</button>
              <button class="flex h-10 items-center gap-2 bg-[#36c] px-4 text-xs font-semibold text-white hover:bg-[#2a4b8d] disabled:cursor-wait disabled:opacity-60" type="submit" :disabled="auth.loading || !password">
                <LoaderCircle v-if="auth.loading" :size="15" class="animate-spin" />
                <LockKeyhole v-else :size="15" />
                {{ auth.loading ? 'Checking...' : 'Unlock editing' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
