<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArchiveRestore, LoaderCircle, Shield, Trash2, UserPlus, Users } from '@lucide/vue'
import AppHeader from '../components/layout/AppHeader.vue'
import { authApi, documentsApi } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { AuthUser, TrashItem } from '../types/documents'

const auth = useAuthStore()
const users = ref<AuthUser[]>([])
const trash = ref<TrashItem[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const username = ref('')
const password = ref('')
const role = ref<AuthUser['role']>('editor')
const currentPassword = ref('')
const newPassword = ref('')
const isAdmin = computed(() => auth.user?.role === 'admin')
const canEdit = computed(() => auth.user?.role === 'admin' || auth.user?.role === 'editor')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    trash.value = canEdit.value ? await documentsApi.trash() : []
    users.value = isAdmin.value ? await authApi.users() : []
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : 'Unable to load workspace settings.'
  } finally { loading.value = false }
}

async function createUser(): Promise<void> {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await authApi.createUser(username.value, password.value, role.value)
    username.value = ''
    password.value = ''
    notice.value = 'Account created.'
    users.value = await authApi.users()
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : 'Unable to create account.'
  } finally { saving.value = false }
}

async function deleteUser(user: AuthUser): Promise<void> {
  if (!window.confirm(`Delete ${user.username}? Their active sessions will be revoked.`)) return
  try { await authApi.deleteUser(user.username); users.value = await authApi.users() }
  catch (requestError) { error.value = requestError instanceof Error ? requestError.message : 'Unable to delete account.' }
}

async function restore(item: TrashItem): Promise<void> {
  try { await documentsApi.restoreDeleted(item.path); trash.value = await documentsApi.trash(); notice.value = `${item.title} was restored.` }
  catch (requestError) { error.value = requestError instanceof Error ? requestError.message : 'Unable to restore page.' }
}

async function purge(item: TrashItem): Promise<void> {
  if (!window.confirm(`Permanently delete ${item.path}? This cannot be undone.`)) return
  try { await documentsApi.purgeDeleted(item.path); trash.value = await documentsApi.trash() }
  catch (requestError) { error.value = requestError instanceof Error ? requestError.message : 'Unable to permanently delete page.' }
}

async function changePassword(): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await authApi.changePassword(currentPassword.value, newPassword.value)
    auth.clear()
    window.location.assign('/docs')
  } catch (requestError) {
    error.value = requestError instanceof Error ? requestError.message : 'Unable to change password.'
  } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-[#f8f9fa] text-slate-800 dark:bg-[#0b0d10] dark:text-slate-200">
    <AppHeader />
    <main class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div class="mb-7"><p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#36c] dark:text-[#6ea6ff]">Workspace administration</p><h1 class="wiki-heading mt-1 text-3xl text-slate-950 dark:text-white">Settings</h1><p class="mt-2 text-sm text-slate-500">Manage access and recover deleted pages.</p></div>
      <p v-if="error" class="mb-5 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300" role="alert">{{ error }}</p>
      <p v-if="notice" class="mb-5 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{{ notice }}</p>
      <div v-if="loading" class="grid min-h-64 place-items-center"><LoaderCircle :size="24" class="animate-spin" /></div>
      <div v-else class="space-y-7">
        <section v-if="isAdmin" class="border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111315]">
          <header class="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><Users :size="18" /><div><h2 class="font-semibold">Team accounts</h2><p class="text-xs text-slate-500">Admins manage accounts; editors write; viewers have read-only access.</p></div></header>
          <form class="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-[#0e1116] sm:grid-cols-[1fr_1fr_140px_auto]" @submit.prevent="createUser">
            <input v-model="username" class="h-10 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-[#0b0d10]" placeholder="Username" minlength="3" maxlength="40" required />
            <input v-model="password" class="h-10 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-[#0b0d10]" placeholder="Temporary password (12+ characters)" type="password" minlength="12" required />
            <select v-model="role" class="h-10 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-[#0b0d10]"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
            <button class="flex h-10 items-center justify-center gap-2 bg-[#36c] px-4 text-xs font-semibold text-white disabled:opacity-60" :disabled="saving" type="submit"><UserPlus :size="15" /> Add</button>
          </form>
          <ul class="divide-y divide-slate-200 dark:divide-slate-800"><li v-for="user in users" :key="user.id" class="flex items-center gap-3 px-5 py-3"><Shield :size="15" class="text-slate-400" /><span class="min-w-0 flex-1 truncate text-sm font-medium">{{ user.username }}</span><span class="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{{ user.role }}</span><button v-if="user.id !== auth.user?.id" class="grid size-8 place-items-center text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30" type="button" aria-label="Delete account" @click="deleteUser(user)"><Trash2 :size="14" /></button></li></ul>
        </section>
        <section class="border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111315]">
          <header class="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><Shield :size="18" /><div><h2 class="font-semibold">Your password</h2><p class="text-xs text-slate-500">Changing it signs out all of your active sessions.</p></div></header>
          <form class="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="changePassword">
            <input v-model="currentPassword" class="h-10 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-[#0b0d10]" type="password" autocomplete="current-password" placeholder="Current password" required />
            <input v-model="newPassword" class="h-10 border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-[#0b0d10]" type="password" autocomplete="new-password" minlength="12" placeholder="New password (12+ characters)" required />
            <button class="h-10 bg-slate-800 px-4 text-xs font-semibold text-white disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900" :disabled="saving" type="submit">Change password</button>
          </form>
        </section>
        <section v-if="canEdit" class="border border-slate-300 bg-white dark:border-slate-700 dark:bg-[#111315]">
          <header class="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><ArchiveRestore :size="18" /><div><h2 class="font-semibold">Trash</h2><p class="text-xs text-slate-500">Deleted pages remain recoverable until an administrator removes them permanently.</p></div></header>
          <p v-if="trash.length === 0" class="px-5 py-8 text-center text-sm text-slate-500">Trash is empty.</p>
          <ul v-else class="divide-y divide-slate-200 dark:divide-slate-800"><li v-for="item in trash" :key="item.path" class="flex flex-wrap items-center gap-3 px-5 py-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ item.title }}</p><p class="truncate font-mono text-[10px] text-slate-400">{{ item.path }} · {{ new Date(item.deletedAt).toLocaleString() }}</p></div><button class="flex h-8 items-center gap-1.5 border border-slate-300 px-3 text-xs dark:border-slate-700" type="button" @click="restore(item)"><ArchiveRestore :size="13" /> Restore</button><button v-if="isAdmin" class="grid size-8 place-items-center text-rose-600" type="button" aria-label="Permanently delete" @click="purge(item)"><Trash2 :size="14" /></button></li></ul>
        </section>
      </div>
    </main>
  </div>
</template>
