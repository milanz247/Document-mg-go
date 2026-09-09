import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { documentRoute, routeToDocumentPath } from '../utils/routes'
const DocumentationLayout = () => import('../layouts/DocumentationLayout.vue')
const DocumentPage = () => import('../pages/DocumentPage.vue')
const EditorPage = () => import('../pages/EditorPage.vue')
const SettingsPage = () => import('../pages/SettingsPage.vue')
const NotFoundPage = () => import('../pages/NotFoundPage.vue')

function unlockRedirect(to: RouteLocationNormalized) {
  const readerPath = to.name === 'editor-edit'
    ? documentRoute(routeToDocumentPath(to.params.documentPath))
    : '/docs'
  return { path: readerPath, query: { unlock: to.fullPath } }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/docs' },
    {
      path: '/docs',
      component: DocumentationLayout,
      children: [
        { path: '', component: DocumentPage },
        { path: ':documentPath(.*)', component: DocumentPage },
      ],
    },
    { path: '/editor/new', name: 'editor-new', component: EditorPage, meta: { requiresAuth: true, roles: ['admin', 'editor'] } },
    { path: '/editor/:documentPath(.*)', name: 'editor-edit', component: EditorPage, meta: { requiresAuth: true, roles: ['admin', 'editor'] } },
    { path: '/settings', name: 'settings', component: SettingsPage, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', component: NotFoundPage },
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 96 }
    if (to.path !== from.path) return { top: 0 }
    return undefined
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  try {
    await auth.initialize()
  } catch {
    if (requiresAuth) return unlockRedirect(to)
  }
  if (requiresAuth && !auth.isAuthenticated) return unlockRedirect(to)
  const roles = to.matched.flatMap((record) => Array.isArray(record.meta.roles) ? record.meta.roles as string[] : [])
  if (roles.length && (!auth.user || !roles.includes(auth.user.role))) return '/docs'
  return true
})

export default router
