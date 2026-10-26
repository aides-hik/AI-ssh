import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareWallpaper, readWallpaperDimensions, wallpaperOutputSize } from './wallpaper-image'

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.set([73, 72, 68, 82], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

test('image headers identify PNG, JPEG and WebP dimensions and reject mismatched content', () => {
  assert.deepEqual(readWallpaperDimensions(png(6000, 4000), 'image/png'), { width: 6000, height: 4000 })
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 1, 144, 2, 88, 0])
  assert.deepEqual(readWallpaperDimensions(jpeg, 'image/jpeg'), { width: 600, height: 400 })
  const webp = new Uint8Array(30)
  for (const [position, text] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8X']] as const) webp.set(new TextEncoder().encode(text), position)
  webp[24] = 99
  webp[27] = 49
  assert.deepEqual(readWallpaperDimensions(webp, 'image/webp'), { width: 100, height: 50 })
  assert.equal(readWallpaperDimensions(new TextEncoder().encode('<svg onload="script"/>'), 'image/png'), null)
  assert.equal(readWallpaperDimensions(png(100, 100), 'image/jpeg'), null)
})

test('wallpaper dimensions preserve aspect ratio, never upscale, and reject huge decoded surfaces', () => {
  assert.deepEqual(wallpaperOutputSize(6000, 4000), { width: 3840, height: 2560 })
  assert.deepEqual(wallpaperOutputSize(1000, 3000), { width: 1000, height: 3000 })
  assert.throws(() => wallpaperOutputSize(10000, 10000), /6400 万像素/)
  assert.throws(() => wallpaperOutputSize(0, 100), /尺寸过大或无效/)
})

test('unsupported types, oversize files and invalid raster content fail before decoding', async () => {
  await assert.rejects(prepareWallpaper(new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })), /JPG、PNG 或 WebP/)
  await assert.rejects(prepareWallpaper(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })), /20 MB/)
  await assert.rejects(prepareWallpaper(new File(['not an image'], 'invalid.png', { type: 'image/png' })), /无法识别图片内容/)
  await assert.rejects(prepareWallpaper(new File([png(10000, 10000)], 'huge.png', { type: 'image/png' })), /6400 万像素/)
})

test('normalization closes the bitmap, releases the canvas, and keeps the old image recoverable on failure', async t => {
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  t.after(() => {
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap)
    else Reflect.deleteProperty(globalThis, 'createImageBitmap')
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  })
  let closed = 0
  let failEncoding = false
  let drawnSize: number[] = []
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_bitmap: unknown, _x: number, _y: number, width: number, height: number) => { drawnSize = [width, height] } }),
    toBlob: (callback: BlobCallback) => callback(failEncoding ? null : new Blob(['processed'], { type: 'image/webp' }))
  }
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 6000, height: 4000, close: () => { closed++ } }) })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } })
  const file = new File([png(6000, 4000)], '保留 原图.png', { type: 'image/png' })
  const normalized = await prepareWallpaper(file)
  assert.equal(normalized.imageName, '保留 原图.png')
  assert.equal(normalized.image.type, 'image/webp')
  assert.equal(await normalized.image.text(), 'processed')
  assert.deepEqual(drawnSize, [3840, 2560])
  assert.equal(closed, 1)
  assert.equal(canvas.width, 0)
  failEncoding = true
  await assert.rejects(prepareWallpaper(file), /原有壁纸已保留/)
  assert.equal(closed, 2)
  assert.equal(canvas.height, 0)
})
