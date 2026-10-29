import { readonly, ref } from 'vue'

export interface UpdateClientState {
  enabled: boolean
  status: string
  currentVersion: string
  availableVersion?: string
  progress?: number
  statusText?: string
  downloadedFilePath?: string
  selectedSourceId?: string
  lastCheckedAt?: string
  error?: string
}

const state = ref<UpdateClientState>({
  enabled: false,
  status: 'idle',
  currentVersion: ''
})

let initialized = false
let installPromptShownForVersion = ''
let requestGeneration = 0

async function initialize() {
  if (!window.electronAPI?.updater) {
    return state.value
  }

  if (!initialized) {
    initialized = true
    window.electronAPI.onUpdaterStateChange((nextState: UpdateClientState) => {
      requestGeneration++
      state.value = nextState
    })
  }

  const generation = ++requestGeneration
  const initial = await window.electronAPI.updater.getState()
  if (generation !== requestGeneration) return state.value
  state.value = initial
  if (state.value.enabled) {
    await startBackgroundCheck()
  }
  return state.value
}

async function startBackgroundCheck() {
  if (!window.electronAPI?.updater) {
    return state.value
  }

  const generation = ++requestGeneration
  const result = await window.electronAPI.updater.startBackgroundCheck()
  if (generation === requestGeneration) state.value = result
  return state.value
}

async function cancelBackgroundCheck() {
  if (!window.electronAPI?.updater?.cancelBackgroundCheck) return state.value
  const generation = ++requestGeneration
  const result = await window.electronAPI.updater.cancelBackgroundCheck()
  if (generation === requestGeneration && result) state.value = result
  return state.value
}

async function installDownloadedUpdate() {
  if (!window.electronAPI?.updater) {
    return false
  }

  return window.electronAPI.updater.installDownloadedUpdate()
}

function shouldShowInstallPrompt(nextState: UpdateClientState) {
  if (!nextState.enabled || nextState.status !== 'downloaded' || !nextState.availableVersion) {
    return false
  }

  if (installPromptShownForVersion === nextState.availableVersion) {
    return false
  }

  installPromptShownForVersion = nextState.availableVersion
  return true
}

export function useUpdateClient() {
  return {
    state: readonly(state),
    initialize,
    startBackgroundCheck,
    cancelBackgroundCheck,
    installDownloadedUpdate,
    shouldShowInstallPrompt
  }
}
