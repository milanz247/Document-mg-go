import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import DocumentationLayout from '../layouts/DocumentationLayout.vue'
import DocumentPage from '../pages/DocumentPage.vue'
import EditorPage from '../pages/EditorPage.vue'
import NotFoundPage from '../pages/NotFoundPage.vue'
import { useAuthStore } from '../stores/auth'
import { documentRoute, routeToDocumentPath } from '../utils/routes'

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
    { path: '/editor/new', name: 'editor-new', component: EditorPage, meta: { requiresAuth: true } },
    { path: '/editor/:documentPath(.*)', name: 'editor-edit', component: EditorPage, meta: { requiresAuth: true } },
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

  if (requiresAuth && !auth.isAuthenticated) {
    return unlockRedirect(to)
  }
  return true
})

export default router
