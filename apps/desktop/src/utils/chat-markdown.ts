import { marked, Renderer } from 'marked'

const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => htmlEntities[character] || character)
}

/** Render code controls without treating fence contents or labels as HTML. */
export function renderChatMarkdown(text: string, copyLabel: string, codeLabel: string): string {
  const renderer = new Renderer()
  const copy = escapeHtml(copyLabel)

  renderer.code = ({ text: code, lang }) => {
    const language = lang?.match(/^\S+/)?.[0] || ''
    const languageClass = /^[a-zA-Z0-9_+-]+$/.test(language)
      ? ` class="language-${language}"`
      : ''
    // Match marked's newline handling so copying keeps the code's whitespace.
    const content = code ? code.replace(/\n$/, '') + '\n' : ''

    return `<figure class="oc-code-block"><figcaption class="oc-code-toolbar"><span class="oc-code-language">${escapeHtml(language || codeLabel)}</span><button type="button" class="oc-code-copy" data-code-copy aria-label="${copy}"><i class="bi bi-copy" aria-hidden="true"></i><span>${copy}</span></button></figcaption><pre><code${languageClass}>${escapeHtml(content)}</code></pre></figure>\n`
  }

  return marked.parse(text, { async: false, renderer }) as string
}
