const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_PIXELS = 64_000_000
const MAX_EDGE = 3840
const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const jpegFrames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** Read dimensions before decoding so a small compressed file cannot allocate an unbounded canvas. */
export function readWallpaperDimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (type === 'image/png' && bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) &&
      String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let position = 2
    while (position + 3 < bytes.length) {
      if (bytes[position++] !== 0xff) return null
      while (bytes[position] === 0xff) position++
      const marker = bytes[position++]
      if (marker === 0xd9 || marker === 0xda) return null
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (position + 2 > bytes.length) return null
      const length = view.getUint16(position)
      if (length < 2 || position + length > bytes.length) return null
      if (jpegFrames.has(marker) && length >= 7) return { width: view.getUint16(position + 5), height: view.getUint16(position + 3) }
      position += length
    }
  }
  if (type === 'image/webp' && bytes.length >= 30 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    const uint24 = (offset: number) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
    if (chunk === 'VP8X') return { width: uint24(24) + 1, height: uint24(27) + 1 }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const packed = view.getUint32(21, true)
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
  }
  return null
}

export function wallpaperOutputSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
    throw new Error('图片尺寸过大或无效，请选择不超过 6400 万像素的图片。')
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function prepareWallpaper(file: File): Promise<{ image: Blob; imageName: string }> {
  if (!acceptedTypes.has(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  if (file.size === 0 || file.size > MAX_INPUT_BYTES) throw new Error('请选择非空且不超过 20 MB 的图片。')
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer())
  const dimensions = readWallpaperDimensions(bytes, file.type)
  if (!dimensions) throw new Error('无法识别图片内容，请选择有效的 JPG、PNG 或 WebP 图片。')
  wallpaperOutputSize(dimensions.width, dimensions.height)
  let bitmap: ImageBitmap | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    bitmap = await createImageBitmap(file)
    const size = wallpaperOutputSize(bitmap.width, bitmap.height)
    canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas?.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed')), 'image/webp', 0.9)
    })
    if (!image.size || !acceptedTypes.has(image.type) || image.size > MAX_INPUT_BYTES) throw new Error('Image encoding failed')
    return { image, imageName: file.name.slice(0, 255) || '自定义壁纸' }
  } catch {
    throw new Error('图片无法读取或处理，请换一张图片重试，原有壁纸已保留。')
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
