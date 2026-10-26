import { nextTick, ref, shallowRef } from 'vue'
import {
  DEFAULT_WALLPAPER_PREFERENCES,
  loadWallpaper,
  saveWallpaper,
  type WallpaperPreferences,
  type WallpaperRecord
} from '../services/wallpaper-storage'
import { prepareWallpaper } from '../services/wallpaper-image'

const preferences = ref<WallpaperPreferences>({ ...DEFAULT_WALLPAPER_PREFERENCES })
const imageUrl = ref('')
const imageName = ref('')
const image = shallowRef<Blob>()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let initialized = false
let initialization: Promise<void> | undefined
let queue: Promise<unknown> = Promise.resolve()
let pendingSaves = 0

function apply(record: WallpaperRecord) {
  const replaceImage = image.value !== record.image
  const nextUrl = replaceImage ? (record.image ? URL.createObjectURL(record.image) : '') : imageUrl.value
  const oldUrl = imageUrl.value
  preferences.value = { ...record.preferences }
  imageName.value = record.imageName ?? ''
  if (replaceImage) {
    image.value = record.image
    imageUrl.value = nextUrl
    if (oldUrl) void nextTick(() => URL.revokeObjectURL(oldUrl))
  }
}

function snapshot(): WallpaperRecord {
  return {
    preferences: { ...preferences.value },
    ...(image.value && { image: image.value, imageName: imageName.value })
  }
}

async function initialize(): Promise<void> {
  if (initialized) return
  if (initialization) return initialization
  loading.value = true
  initialization = (async () => {
    try {
      const record = await loadWallpaper()
      if (record) apply(record)
      initialized = true
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '无法读取壁纸，请重试。'
    } finally {
      loading.value = false
      initialization = undefined
    }
  })()
  return initialization
}

function change(
  build: (current: WallpaperRecord) => WallpaperRecord | Promise<WallpaperRecord>,
  recover = false
): Promise<void> {
  pendingSaves++
  saving.value = true
  const operation = queue.then(async () => {
    await initialize()
    if (!initialized && !recover) return
    error.value = ''
    try {
      const next = await build(snapshot())
      await saveWallpaper(next)
      apply(next)
      initialized = true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '壁纸未能保存，请重试。'
    }
  }).finally(() => {
    pendingSaves--
    saving.value = pendingSaves > 0
  })
  queue = operation.catch(() => undefined)
  return operation
}

function selectPreset(preset: WallpaperPreferences['preset']): Promise<void> {
  return change(current => {
    if (preset === 'custom' && !current.image) throw new Error('请先上传一张自定义壁纸。')
    return { ...current, preferences: { ...current.preferences, preset } }
  })
}

function upload(file: File): Promise<void> {
  return change(async current => {
    const prepared = await prepareWallpaper(file)
    return {
      ...prepared,
      preferences: { ...current.preferences, preset: 'custom' }
    }
  })
}

function updatePreferences(update: Partial<Omit<WallpaperPreferences, 'preset'>>): Promise<void> {
  return change(current => ({ ...current, preferences: { ...current.preferences, ...update } }))
}

function removeCustom(): Promise<void> {
  return change(current => ({
    preferences: {
      ...current.preferences,
      preset: current.preferences.preset === 'custom' ? 'flow' : current.preferences.preset
    }
  }))
}

function restoreDefault(): Promise<void> {
  // An explicit reset also recovers a damaged saved record. Ordinary changes
  // never overwrite a record that initialization could not read.
  return change(current => ({ ...current, preferences: { ...DEFAULT_WALLPAPER_PREFERENCES } }), true)
}

export function useWallpaper() {
  return { preferences, imageUrl, imageName, loading, saving, error, initialize, selectPreset, upload, updatePreferences, removeCustom, restoreDefault }
}
