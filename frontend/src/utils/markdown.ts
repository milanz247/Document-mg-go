import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import nginx from 'highlight.js/lib/languages/nginx'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import MarkdownIt from 'markdown-it'
import { resolveAssetPath, resolveDocumentationPath } from './routes'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('go', go)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('nginx', nginx)
hljs.registerLanguage('text', plaintext)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function renderMarkdown(markdown: string, documentPath: string): string {
  const headingCounts = new Map<string, number>()
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(code).value
    },
  })

  md.core.ruler.after('inline', 'task-list-items', (state) => {
    for (let index = 2; index < state.tokens.length; index += 1) {
      const token = state.tokens[index]
      if (token.type !== 'inline' || state.tokens[index - 2]?.type !== 'list_item_open') continue
      const firstText = token.children?.[0]
      if (!firstText || firstText.type !== 'text') continue
      const match = firstText.content.match(/^\[([ xX])\]\s+/)
      if (!match) continue
      firstText.content = firstText.content.slice(match[0].length)
      const checkbox = new state.Token('html_inline', '', 0)
      checkbox.content = `<input class="task-checkbox" type="checkbox" disabled${match[1].toLowerCase() === 'x' ? ' checked' : ''}>`
      token.children?.unshift(checkbox)
    }
  })

  md.renderer.rules.heading_open = (tokens, index) => {
    const level = tokens[index].tag
    const content = tokens[index + 1]?.content ?? ''
    const baseSlug = slugify(content) || 'section'
    const count = headingCounts.get(baseSlug) ?? 0
    headingCounts.set(baseSlug, count + 1)
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`
    return `<${level} id="${escapeHtml(slug)}"><a class="heading-anchor" href="#${escapeHtml(slug)}" aria-label="Link to ${escapeHtml(content)}">#</a>`
  }

  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]
    const language = token.info.trim().split(/\s+/)[0]
    const highlighted = md.options.highlight?.(token.content, language, '') ?? escapeHtml(token.content)
    const languageLabel = language || 'text'
    return `<div class="code-block"><div class="code-toolbar"><span>${escapeHtml(languageLabel)}</span><button type="button" class="copy-code">Copy</button></div><pre><code class="hljs language-${escapeHtml(languageLabel)}">${highlighted}</code></pre></div>`
  }

  const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options))
  md.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
    const token = tokens[index]
    const hrefIndex = token.attrIndex('href')
    if (hrefIndex >= 0) {
      const href = String(token.attrs![hrefIndex][1])
      const internalRoute = resolveDocumentationPath(documentPath, href)
      if (internalRoute) {
        token.attrs![hrefIndex][1] = internalRoute
        token.attrSet('data-doc-link', 'true')
      } else if (/^https?:\/\//i.test(href)) {
        token.attrSet('target', '_blank')
        token.attrSet('rel', 'noopener noreferrer')
      }
    }
    return defaultLinkOpen(tokens, index, options, environment, renderer)
  }

  md.renderer.rules.image = (tokens, index, options, _environment, renderer) => {
    const token = tokens[index]
    const srcIndex = token.attrIndex('src')
    if (srcIndex >= 0) {
      const resolved = resolveAssetPath(documentPath, String(token.attrs![srcIndex][1]))
      token.attrs![srcIndex][1] = resolved ?? ''
      token.attrSet('loading', 'lazy')
    }
    return renderer.renderToken(tokens, index, options)
  }

  return DOMPurify.sanitize(md.render(markdown), {
    ADD_ATTR: ['target', 'data-doc-link', 'loading', 'checked', 'disabled'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
  })
}
