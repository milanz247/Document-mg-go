<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { renderMarkdown } from '../../utils/markdown'

const props = defineProps<{ markdown: string; documentPath: string }>()
const router = useRouter()
const rendered = computed(() => renderMarkdown(props.markdown, props.documentPath))

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement
  const link = target.closest<HTMLAnchorElement>('a[data-doc-link="true"]')
  if (link) {
    event.preventDefault()
    await router.push(`${link.pathname}${link.hash}`)
    return
  }

  const copyButton = target.closest<HTMLButtonElement>('.copy-code')
  if (!copyButton) return
  const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent ?? ''
  try {
    await navigator.clipboard.writeText(code)
    copyButton.textContent = 'Copied!'
    window.setTimeout(() => { copyButton.textContent = 'Copy' }, 1600)
  } catch {
    copyButton.textContent = 'Copy failed'
  }
}
</script>

<template>
  <article class="markdown-body" @click="handleClick" v-html="rendered"></article>
</template>

