import { isCredentialField, isCredentialHeaderContainer } from '../../src/utils/credential-fields'

const diagnosticFields = new Set([
  'success', 'data', 'message', 'error', 'code', 'status', 'items', 'total', 'count',
  'id', 'email', 'username', 'rememberMe', 'payload', 'endpoint', 'method',
  'headers', 'password', 'token', 'accessToken', 'refreshToken', 'privateKey', 'passphrase',
  'authorizationPreview', 'refreshTokenPreview',
])

/** API diagnostics describe shape, never request/response text or credential prefixes. */
export function summarizeApiPayload(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return `[string:${value.length}]`
  if (typeof value === 'boolean') return value
  if (typeof value !== 'object') return `[${typeof value}]`
  if (Array.isArray(value)) return `[array:${value.length}]`
  if (depth >= 3) return '[object]'
  try {
    return Object.fromEntries(Object.keys(value).slice(0, 30).map((key, index) => {
      // Dictionary keys can contain user text, paths or credentials too.
      const label = diagnosticFields.has(key) ? key : `[field ${index + 1}]`
      if (isCredentialField(key) || isCredentialHeaderContainer(key) || /token|password|secret|api.?key|passphrase/i.test(key)) return [label, '[redacted]']
      const field = Object.getOwnPropertyDescriptor(value, key)
      return [label, field && 'value' in field ? summarizeApiPayload(field.value, depth + 1) : '[accessor]']
    }))
  } catch { return '[object]' }
}

export function summarizeApiError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const names = ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'URIError', 'AbortError', 'FetchError', 'TimeoutError']
  try { const name = error.name; return names.includes(name) ? name : 'Error' }
  catch { return 'Error' }
}

export function summarizeApiUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.protocol}//${url.host}/[path omitted]`
  } catch {
    return '[invalid URL]'
  }
}
