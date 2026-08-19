import { ref } from 'vue'
import { defineStore } from 'pinia'

export type Theme = 'light' | 'dark'

const storageKey = 'atlas-docs-theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable in strict browser privacy modes.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0d10' : '#ffffff')
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(initialTheme())
  applyTheme(theme.value)

  function toggle(): void {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem(storageKey, theme.value)
    } catch {
      // The theme still changes for the current page when storage is unavailable.
    }
    applyTheme(theme.value)
  }

  return { theme, toggle }
})
