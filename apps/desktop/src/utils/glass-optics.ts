/**
 * A rounded-rectangle refraction field shared by the application and previews.
 * This original implementation encodes the inward normal in the red/green channels
 * encode the inward normal near the edge; the flat centre stays neutral.
 * The image is generated only when the surface geometry changes, never per frame.
 */
const mapCache = new Map<string, string>()
const MAX_MAP_EDGE = 512
const MAX_CACHED_MAPS = 24

export function createRefractionMap(width: number, height: number, cornerRadius: number): string {
  const cssWidth = Math.max(1, Math.round(width))
  const cssHeight = Math.max(1, Math.round(height))
  const radius = Math.max(0, Math.min(cornerRadius, cssWidth / 2, cssHeight / 2))
  const key = `${cssWidth}:${cssHeight}:${radius}`
  const cached = mapCache.get(key)
  if (cached) return cached

  const ratio = Math.min(1, MAX_MAP_EDGE / Math.max(cssWidth, cssHeight))
  const mapWidth = Math.max(1, Math.round(cssWidth * ratio))
  const mapHeight = Math.max(1, Math.round(cssHeight * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = mapWidth
  canvas.height = mapHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is unavailable')

  const image = context.createImageData(mapWidth, mapHeight)
  const halfWidth = cssWidth / 2
  const halfHeight = cssHeight / 2
  // Keep the optical rim readable on compact pills as well as large panels.
  const rim = Math.min(32, Math.max(9, Math.min(cssWidth, cssHeight) * 0.24))

  for (let y = 0; y < mapHeight; y++) {
    const py = ((y + 0.5) / mapHeight) * cssHeight - halfHeight
    for (let x = 0; x < mapWidth; x++) {
      const px = ((x + 0.5) / mapWidth) * cssWidth - halfWidth
      const qx = Math.abs(px) - (halfWidth - radius)
      const qy = Math.abs(py) - (halfHeight - radius)
      const exteriorX = Math.max(qx, 0)
      const exteriorY = Math.max(qy, 0)
      const exteriorLength = Math.hypot(exteriorX, exteriorY)
      const distance = exteriorLength + Math.min(Math.max(qx, qy), 0) - radius
      const offset = (y * mapWidth + x) * 4
      let red = 128
      let green = 128

      if (distance <= 0 && distance > -rim) {
        let normalX = 0
        let normalY = 0
        if (exteriorLength > 0.0001) {
          normalX = (exteriorX / exteriorLength) * Math.sign(px)
          normalY = (exteriorY / exteriorLength) * Math.sign(py)
        } else if (qx > qy) {
          normalX = Math.sign(px)
        } else {
          normalY = Math.sign(py)
        }

        const depth = Math.min(1, -distance / rim)
        const smoothDepth = depth * depth * (3 - 2 * depth)
        const bend = 118 * Math.pow(1 - smoothDepth, 1.6)
        red = Math.round(128 - normalX * bend)
        green = Math.round(128 - normalY * bend)
      }

      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = 128
      image.data[offset + 3] = 255
    }
  }

  context.putImageData(image, 0, 0)
  const result = canvas.toDataURL('image/png')
  if (mapCache.size >= MAX_CACHED_MAPS) {
    const oldestKey = mapCache.keys().next().value
    if (oldestKey !== undefined) mapCache.delete(oldestKey)
  }
  mapCache.set(key, result)
  return result
}
