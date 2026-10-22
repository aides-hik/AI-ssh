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

async function initialize() {
  if (!window.electronAPI?.updater) {
    return state.value
  }

  if (!initialized) {
    initialized = true
    window.electronAPI.onUpdaterStateChange((nextState: UpdateClientState) => {
      state.value = nextState
    })
  }

  state.value = await window.electronAPI.updater.getState()
  if (state.value.enabled) {
    state.value = await window.electronAPI.updater.startBackgroundCheck()
  }
  return state.value
}

async function startBackgroundCheck() {
  if (!window.electronAPI?.updater) {
    return state.value
  }

  state.value = await window.electronAPI.updater.startBackgroundCheck()
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
    installDownloadedUpdate,
    shouldShowInstallPrompt
  }
}
