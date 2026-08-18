import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
useThemeStore(pinia)
const auth = useAuthStore(pinia)
window.addEventListener('atlas:unauthorized', () => {
  auth.clear()
  void router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
})
app.mount('#app')
