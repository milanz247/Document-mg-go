import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'
import { documentRoute, routeToDocumentPath } from './utils/routes'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
useThemeStore(pinia)
const auth = useAuthStore(pinia)
window.addEventListener('atlas:unauthorized', () => {
  auth.clear()
  const currentRoute = router.currentRoute.value
  const readerPath = currentRoute.name === 'editor-edit'
    ? documentRoute(routeToDocumentPath(currentRoute.params.documentPath))
    : '/docs'
  void router.replace({ path: readerPath, query: { unlock: currentRoute.fullPath } })
})
app.mount('#app')
