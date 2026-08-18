import { createRouter, createWebHistory } from 'vue-router'
import DocumentationLayout from '../layouts/DocumentationLayout.vue'
import DocumentPage from '../pages/DocumentPage.vue'
import EditorPage from '../pages/EditorPage.vue'
import LoginPage from '../pages/LoginPage.vue'
import NotFoundPage from '../pages/NotFoundPage.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/docs' },
    { path: '/login', name: 'login', component: LoginPage },
    {
      path: '/docs',
      component: DocumentationLayout,
      meta: { requiresAuth: true },
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
  try {
    await auth.initialize()
  } catch {
    if (to.name !== 'login') return { name: 'login' }
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) return '/docs'
  return true
})

export default router
