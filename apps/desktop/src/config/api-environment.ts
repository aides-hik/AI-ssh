const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3000'

function normalizeApiOrigin(value?: string): string {
  return value?.trim().replace(/\/+$/, '') || DEFAULT_API_ORIGIN
}

export function getRendererApiOrigin(): string {
  const envBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL
  return normalizeApiOrigin(envBaseUrl)
}

export function getRendererApiBaseUrl(): string {
  return `${getRendererApiOrigin()}/api/v1`
}

export function getApiOriginByMode(_isProduction: boolean): string {
  if (typeof process !== 'undefined') {
    const envBaseUrl = process.env?.AI_SSH_API_BASE_URL || process.env?.VITE_API_BASE_URL
    if (envBaseUrl?.trim()) return normalizeApiOrigin(envBaseUrl)
  }

  return getRendererApiOrigin()
}

export function getApiBaseUrlByMode(isProduction: boolean): string {
  return `${getApiOriginByMode(isProduction)}/api/v1`
}
