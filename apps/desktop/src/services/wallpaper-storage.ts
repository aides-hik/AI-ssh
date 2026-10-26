export type WallpaperPreset = 'flow' | 'aurora' | 'sunset' | 'none' | 'custom'

export interface WallpaperPreferences {
  preset: WallpaperPreset
  fit: 'cover' | 'contain'
  dim: number
  blur: number
}

export interface WallpaperRecord {
  preferences: WallpaperPreferences
  image?: Blob
  imageName?: string
}

export const DEFAULT_WALLPAPER_PREFERENCES: Readonly<WallpaperPreferences> = Object.freeze({
  preset: 'flow', fit: 'cover', dim: 0, blur: 0
})

const DATABASE = 'prism-appearance'
const STORE = 'wallpaper'
const KEY = 'active'
const MAX_BYTES = 20 * 1024 * 1024
const presets: WallpaperPreset[] = ['flow', 'aurora', 'sunset', 'none', 'custom']
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** Validate without silently resetting a damaged or unsupported saved image. */
export function validateWallpaperRecord(value: unknown): WallpaperRecord {
  if (!value || typeof value !== 'object') throw new Error('壁纸设置格式无效，原有壁纸已保留。')
  const record = value as Partial<WallpaperRecord>
  const preferences = record.preferences
  if (!preferences || !presets.includes(preferences.preset) ||
      !['cover', 'contain'].includes(preferences.fit) ||
      !Number.isFinite(preferences.dim) || preferences.dim < 0 || preferences.dim > 70 ||
      !Number.isFinite(preferences.blur) || preferences.blur < 0 || preferences.blur > 20) {
    throw new Error('壁纸设置格式无效，原有壁纸已保留。')
  }
  if (record.image !== undefined && (!(record.image instanceof Blob) ||
      !imageTypes.has(record.image.type) || record.image.size === 0 || record.image.size > MAX_BYTES)) {
    throw new Error('壁纸图片无效，原有壁纸已保留。')
  }
  if (preferences.preset === 'custom' && !record.image) throw new Error('找不到自定义壁纸，请重新选择图片。')
  if (record.imageName !== undefined && (typeof record.imageName !== 'string' || record.imageName.length > 255)) {
    throw new Error('壁纸文件名无效，原有壁纸已保留。')
  }
  return {
    preferences: { preset: preferences.preset, fit: preferences.fit, dim: preferences.dim, blur: preferences.blur },
    ...(record.image && { image: record.image }),
    ...(record.imageName !== undefined && { imageName: record.imageName })
  }
}

/** The image and preferences commit together; a failed write leaves the old record intact. */
export function createWallpaperStorage(factory: () => IDBFactory | undefined = () => globalThis.indexedDB) {
  let queue: Promise<unknown> = Promise.resolve()
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.catch(() => undefined)
    return result
  }

  async function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const unavailable = () => reject(new Error('无法打开壁纸存储，请检查本地存储权限后重试。'))
      let request: IDBOpenDBRequest
      try {
        const indexedDB = factory()
        if (!indexedDB) { unavailable(); return }
        request = indexedDB.open(DATABASE, 1)
      } catch { unavailable(); return }
      let blocked = false
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onblocked = () => { blocked = true; unavailable() }
      request.onerror = unavailable
      request.onsuccess = () => {
        const database = request.result
        if (blocked) { database.close(); return }
        database.onversionchange = () => database.close()
        resolve(database)
      }
    })
  }

  function load(): Promise<WallpaperRecord | null> {
    return serialized(async () => {
      const database = await open()
      try {
        const value = await new Promise<unknown>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readonly')
          const request = transaction.objectStore(STORE).get(KEY)
          let result: unknown
          request.onsuccess = () => { result = request.result }
          transaction.oncomplete = () => resolve(result)
          transaction.onerror = transaction.onabort = () => reject(new Error('读取壁纸失败，请重试。'))
        })
        return value === undefined ? null : validateWallpaperRecord(value)
      } catch (error) {
        if (error instanceof Error && /壁纸/.test(error.message)) throw error
        throw new Error('读取壁纸失败，请重试。', { cause: error })
      } finally { database.close() }
    })
  }

  function save(value: WallpaperRecord): Promise<void> {
    const record = validateWallpaperRecord(value)
    return serialized(async () => {
      const database = await open()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE, 'readwrite')
          transaction.objectStore(STORE).put(record, KEY)
          transaction.oncomplete = () => resolve()
          transaction.onerror = transaction.onabort = () => reject(new Error('壁纸未能保存，请检查可用空间后重试，原有壁纸已保留。'))
        })
      } catch {
        throw new Error('壁纸未能保存，请检查可用空间后重试，原有壁纸已保留。')
      } finally { database.close() }
    })
  }

  return { load, save }
}

const storage = createWallpaperStorage()
export const loadWallpaper = storage.load
export const saveWallpaper = storage.save
