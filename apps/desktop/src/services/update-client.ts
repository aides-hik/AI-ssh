import { readonly, ref } from 'vue'

export interface UpdateClientState {
  enabled: boolean
  status: string
  currentVersion: string
  availableVersion?: string
  progress?: number
  downloadedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  statusText?: string
  downloadedFilePath?: string
  selectedSourceId?: string
  lastCheckedAt?: string
  error?: string
}

type UpdateBridge = Pick<Window['electronAPI'], 'updater' | 'onUpdaterStateChange'>

export function createUpdateClient(getBridge: () => UpdateBridge | undefined) {
  const state = ref<UpdateClientState>({ enabled: false, status: 'idle', currentVersion: '' })
  let initialized = false
  let initialization: Promise<UpdateClientState> | undefined
  let unsubscribe: (() => void) | undefined
  let check: Promise<UpdateClientState> | undefined
  let cancellation: Promise<UpdateClientState> | undefined
  let installation: Promise<boolean> | undefined
  let installPromptShownForVersion = ''
  let requestGeneration = 0
  let lifecycle = 0

  function initialize(): Promise<UpdateClientState> {
    const bridge = getBridge()
    if (!bridge?.updater || initialized) return Promise.resolve(state.value)
    if (initialization) return initialization
    if (!unsubscribe) {
      unsubscribe = bridge.onUpdaterStateChange(nextState => {
        requestGeneration++
        state.value = nextState
      })
    }
    const generation = ++requestGeneration
    const currentLifecycle = lifecycle
    const pending = (async () => {
      const initial = await bridge.updater.getState()
      if (currentLifecycle !== lifecycle) return state.value
      initialized = true
      if (generation !== requestGeneration) return state.value
      state.value = initial
      // Initialization only waits for the snapshot. Downloads continue independently.
      // Keep an already prepared package and an in-flight main-process check intact.
      if (initial.enabled && ['idle', 'error'].includes(initial.status)) {
        const background = startBackgroundCheck()
        const backgroundGeneration = requestGeneration
        void background.catch(error => {
          if (currentLifecycle !== lifecycle || backgroundGeneration !== requestGeneration) return
          state.value = { ...state.value, status: 'error', statusText: '检查更新失败，请重试',
            error: error instanceof Error ? error.message : String(error) }
        })
      }
      return state.value
    })()
    initialization = pending
    void pending.finally(() => {
      if (initialization === pending) initialization = undefined
    }).catch(() => {})
    return pending
  }

  function startBackgroundCheck(): Promise<UpdateClientState> {
    const bridge = getBridge()
    if (!bridge?.updater || installation || state.value.status === 'installing') return Promise.resolve(state.value)
    if (check) return check
    const generation = ++requestGeneration
    const pending = (async () => {
      const result = await bridge.updater.startBackgroundCheck()
      if (generation === requestGeneration) state.value = result
      return state.value
    })()
    check = pending
    void pending.finally(() => { if (check === pending) check = undefined }).catch(() => {})
    return pending
  }

  function cancelBackgroundCheck(): Promise<UpdateClientState> {
    const bridge = getBridge()
    if (!bridge?.updater?.cancelBackgroundCheck || installation) return Promise.resolve(state.value)
    if (cancellation) return cancellation
    // A retry may start without waiting for a cancelled transport to settle.
    check = undefined
    const generation = ++requestGeneration
    const pending = (async () => {
      const result = await bridge.updater.cancelBackgroundCheck()
      if (generation === requestGeneration && result) state.value = result
      return state.value
    })()
    cancellation = pending
    void pending.finally(() => { if (cancellation === pending) cancellation = undefined }).catch(() => {})
    return pending
  }

  function installDownloadedUpdate(): Promise<boolean> {
    const bridge = getBridge()
    if (installation) return installation
    if (!bridge?.updater || state.value.status !== 'downloaded') {
      return Promise.reject(new Error('安装包尚未就绪，请重新检查更新'))
    }
    const pending = (async () => {
      const installed = await bridge.updater.installDownloadedUpdate()
      if (!installed) throw new Error('无法启动安装程序，请重试')
      return true
    })()
    installation = pending
    void pending.finally(() => { if (installation === pending) installation = undefined }).catch(() => {})
    return pending
  }

  function shouldShowInstallPrompt(nextState: UpdateClientState) {
    if (!nextState.enabled || nextState.status !== 'downloaded' || !nextState.availableVersion ||
      installPromptShownForVersion === nextState.availableVersion) return false
    installPromptShownForVersion = nextState.availableVersion
    return true
  }

  function dispose() {
    ++lifecycle
    ++requestGeneration
    unsubscribe?.()
    unsubscribe = undefined
    initialized = false
    initialization = undefined
    check = undefined
    cancellation = undefined
    installation = undefined
    installPromptShownForVersion = ''
  }

  return { state: readonly(state), initialize, startBackgroundCheck, cancelBackgroundCheck,
    installDownloadedUpdate, shouldShowInstallPrompt, dispose }
}

const client = createUpdateClient(() => typeof window === 'undefined' ? undefined : window.electronAPI)
if (import.meta.hot) import.meta.hot.dispose(client.dispose)

export function useUpdateClient() {
  return client
}
