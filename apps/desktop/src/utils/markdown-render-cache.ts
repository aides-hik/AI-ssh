interface RenderCacheOptions {
  maxEntries?: number
  maxCharacters?: number
}

/** One current rendering per message block; streamed prefixes replace each other. */
export function createMarkdownRenderCache(
  parse: (text: string) => string,
  { maxEntries = 512, maxCharacters = 2 * 1024 * 1024 }: RenderCacheOptions = {}
) {
  const entries = new Map<string, { text: string; html: string; characters: number }>()
  let characters = 0
  const remove = (key: string) => {
    const previous = entries.get(key)
    if (previous) characters -= previous.characters
    entries.delete(key)
  }

  return (text: string, key: string): string => {
    const cached = entries.get(key)
    if (cached?.text === text) {
      entries.delete(key)
      entries.set(key, cached)
      return cached.html
    }
    remove(key)
    if (!text) return ''
    const html = parse(text)
    const cost = text.length + html.length
    if (maxEntries < 1 || cost > maxCharacters) return html
    while (entries.size >= maxEntries || characters + cost > maxCharacters) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      remove(oldest)
    }
    entries.set(key, { text, html, characters: cost })
    characters += cost
    return html
  }
}
