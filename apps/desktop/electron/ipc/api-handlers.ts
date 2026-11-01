import { app, ipcMain } from 'electron'
import fetch from 'node-fetch'
import { getApiBaseUrlByMode } from '../../src/config/api-environment'
import { summarizeApiPayload, summarizeApiUrl, summarizeApiError } from '../services/api-log-summary'

const isProductionApi = app.isPackaged || process.env.ELECTRON_FORCE_PROD_RENDERER === '1'
const API_BASE_URL = getApiBaseUrlByMode(isProductionApi)

function previewToken(token?: string) {
  if (!token) {
    return null
  }

  return '[present]'
}

function summarizePayload(data: unknown) {
  return summarizeApiPayload(data)
}

function logApiStart(
  label: string,
  method: string,
  url: string,
  extra: Record<string, unknown> = {}
) {
  console.log(`[API][${label}] request start`, {
    method: ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : '[other]',
    url: summarizeApiUrl(url),
    apiBaseUrl: summarizeApiUrl(API_BASE_URL),
    nodeEnv: process.env.NODE_ENV,
    metadata: summarizePayload(extra)
  })
}

function logApiSuccess(
  label: string,
  method: string,
  url: string,
  status: number,
  data: unknown,
  extra: Record<string, unknown> = {}
) {
  console.log(`[API][${label}] request success`, {
    method: ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : '[other]',
    url: summarizeApiUrl(url),
    status,
    response: summarizePayload(data as Record<string, unknown>),
    metadata: summarizePayload(extra)
  })
}

function logApiFailure(
  label: string,
  method: string,
  url: string,
  error: unknown,
  extra: Record<string, unknown> = {}
) {
  console.error(`[API][${label}] request failed`, {
    method: ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : '[other]',
    url: summarizeApiUrl(url),
    apiBaseUrl: summarizeApiUrl(API_BASE_URL),
    nodeEnv: process.env.NODE_ENV,
    error: summarizeApiError(error),
    metadata: summarizePayload(extra)
  })
}

async function fetchJson<T>(
  label: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  options: {
    data?: unknown
    headers?: Record<string, string>
    extra?: Record<string, unknown>
  } = {}
): Promise<T> {
  const { data, headers = {}, extra = {} } = options

  logApiStart(label, method, url, {
    payload: data,
    ...extra
  })

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: data ? JSON.stringify(data) : undefined
    })

    const responseData = (await response.json()) as T

    logApiSuccess(label, method, url, response.status, responseData, extra)
    return responseData
  } catch (error) {
    logApiFailure(label, method, url, error, extra)
    throw error
  }
}

interface ApiRequest {
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
  headers?: Record<string, string>
}

interface ApiResponse<T = any> {
  success: boolean
  message: string
  data?: T
  code?: string
}

// 通用API请求处理器
ipcMain.handle('api:request', async (_, request: ApiRequest): Promise<ApiResponse> => {
  const { endpoint, method, data, headers = {} } = request
  const url = `${API_BASE_URL}${endpoint}`

  try {
    const responseData = await fetchJson<ApiResponse>('request', method, url, {
      data,
      headers,
      extra: {
        endpoint,
        authorizationPreview: previewToken(headers.Authorization || headers.authorization)
      }
    })

    if (!responseData.success) {
      throw new Error(responseData.message || 'API request failed')
    }

    return responseData
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      code: 'API_ERROR'
    }
  }
})

// 认证相关API处理器
ipcMain.handle(
  'api:auth:login',
  async (_, credentials: { email: string; password: string; rememberMe?: boolean }) => {
    const url = `${API_BASE_URL}/auth/login`

    try {
      const data = await fetchJson<ApiResponse>('auth.login', 'POST', url, {
        data: credentials,
        extra: {
          email: credentials.email,
          rememberMe: credentials.rememberMe ?? false
        }
      })
      return data
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Login failed',
        code: 'LOGIN_ERROR'
      }
    }
  }
)

ipcMain.handle(
  'api:auth:register',
  async (_, userData: { email: string; username: string; password: string }) => {
    const url = `${API_BASE_URL}/auth/register`

    try {
      const data = await fetchJson<ApiResponse>('auth.register', 'POST', url, {
        data: userData,
        extra: {
          email: userData.email,
          username: userData.username
        }
      })
      return data
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Register failed',
        code: 'REGISTER_ERROR'
      }
    }
  }
)

ipcMain.handle('api:auth:logout', async (_, token?: string) => {
  const url = `${API_BASE_URL}/auth/logout`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const data = await fetchJson<ApiResponse>('auth.logout', 'POST', url, {
      headers,
      extra: {
        authorizationPreview: previewToken(token)
      }
    })
    return data
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Logout failed',
      code: 'LOGOUT_ERROR'
    }
  }
})

ipcMain.handle('api:auth:refresh', async (_, refreshToken: string) => {
  const url = `${API_BASE_URL}/auth/refresh`

  try {
    const data = await fetchJson<ApiResponse>('auth.refresh', 'POST', url, {
      data: { refreshToken },
      extra: {
        refreshTokenPreview: previewToken(refreshToken)
      }
    })
    return data
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Token refresh failed',
      code: 'REFRESH_ERROR'
    }
  }
})

ipcMain.handle('api:auth:verify', async (_, token: string) => {
  const url = `${API_BASE_URL}/auth/verify`

  try {
    const data = await fetchJson<ApiResponse>('auth.verify', 'GET', url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      extra: {
        authorizationPreview: previewToken(token)
      }
    })
    return data
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Token verification failed',
      code: 'VERIFY_ERROR'
    }
  }
})

console.log('[IPC] API handlers registered')
