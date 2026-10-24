import {
  fillRefractionRows,
  refractionGeometry,
  type RefractionGeometry
} from './glass-optics-field'

const MAX_CACHED_MAPS = 24
const mapCache = new Map<string, string>()
const pendingMaps = new Map<string, Promise<string>>()
const workerRequests = new Map<number, { resolve: (image: string) => void; reject: () => void }>()
let opticalWorker: Worker | undefined
let workerUnavailable = false
let requestId = 0

function stopWorker() {
  workerUnavailable = true
  opticalWorker?.terminate()
  opticalWorker = undefined
  const requests = [...workerRequests.values()]
  workerRequests.clear()
  requests.forEach(request => request.reject())
}

function workerMap(geometry: RefractionGeometry): Promise<string> | undefined {
  if (workerUnavailable || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function')
    return undefined
  try {
    if (!opticalWorker) {
      opticalWorker = new Worker(new URL('./glass-optics.worker.ts', import.meta.url), {
        type: 'module'
      })
      opticalWorker.addEventListener('error', event => {
        event.preventDefault()
        stopWorker()
      })
      opticalWorker.addEventListener('messageerror', stopWorker)
      opticalWorker.addEventListener(
        'message',
        (event: MessageEvent<{ id: number; image?: string }>) => {
          const request = workerRequests.get(event.data.id)
          if (!request) return
          workerRequests.delete(event.data.id)
          if (event.data.image) request.resolve(event.data.image)
          else request.reject()
        }
      )
    }
    const worker = opticalWorker
    return new Promise<string>((resolve, reject) => {
      const id = ++requestId
      workerRequests.set(id, {
        resolve,
        reject: () => reject(new Error('Optical worker unavailable'))
      })
      worker.postMessage({ id, geometry })
    })
  } catch {
    stopWorker()
    return undefined
  }
}

async function fallbackMap(geometry: RefractionGeometry): Promise<string> {
  const { mapWidth, mapHeight } = geometry
  const canvas = document.createElement('canvas')
  canvas.width = mapWidth
  canvas.height = mapHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is unavailable')
  const image = context.createImageData(mapWidth, mapHeight)
  let budgetStart = performance.now()
  for (let row = 0; row < mapHeight; row++) {
    fillRefractionRows(geometry, image.data, row, row + 1)
    // The fallback also yields against a 300 Hz frame budget, rather than filling
    // and synchronously PNG-encoding the entire image on the renderer thread.
    if (performance.now() - budgetStart >= 0.75) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      budgetStart = performance.now()
    }
  }
  context.putImageData(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      value => (value ? resolve(value) : reject(new Error('Optical image unavailable'))),
      'image/png'
    )
  })
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Optical image unavailable'))
    reader.readAsDataURL(blob)
  })
}

/** Share one worker and bounded LRU cache across all glass surfaces. */
export function createRefractionMap(
  width: number,
  height: number,
  cornerRadius: number
): Promise<string> {
  const geometry = refractionGeometry(width, height, cornerRadius)
  const { key } = geometry
  const cached = mapCache.get(key)
  if (cached) {
    mapCache.delete(key)
    mapCache.set(key, cached)
    return Promise.resolve(cached)
  }
  const pending = pendingMaps.get(key)
  if (pending) return pending
  const result = (async () => {
    const inWorker = workerMap(geometry)
    const image = inWorker
      ? await inWorker.catch(() => fallbackMap(geometry))
      : await fallbackMap(geometry)
    if (mapCache.size >= MAX_CACHED_MAPS) {
      const oldest = mapCache.keys().next().value
      if (oldest !== undefined) mapCache.delete(oldest)
    }
    mapCache.set(key, image)
    return image
  })()
  pendingMaps.set(key, result)
  void result.finally(() => pendingMaps.delete(key)).catch(() => {})
  return result
}
