import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, authApi, setCSRFToken } from '../api/client'
import type { AuthUser } from '../types/documents'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const initialized = ref(false)
  const loading = ref(false)
  const isAuthenticated = computed(() => user.value !== null)

  async function initialize(): Promise<void> {
    if (initialized.value) return
    try {
      const session = await authApi.me()
      user.value = session.user
      setCSRFToken(session.csrfToken)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error
      user.value = null
      setCSRFToken('')
    } finally {
      initialized.value = true
    }
  }

  async function unlock(username: string, password: string): Promise<void> {
    loading.value = true
    try {
      const session = await authApi.unlock(username, password)
      user.value = session.user
      setCSRFToken(session.csrfToken)
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  async function lock(): Promise<void> {
    try {
      await authApi.lock()
    } finally {
      user.value = null
      setCSRFToken('')
      initialized.value = true
    }
  }

  function clear(): void {
    user.value = null
    setCSRFToken('')
    initialized.value = true
  }

  return { user, initialized, loading, isAuthenticated, initialize, unlock, lock, clear }
})
