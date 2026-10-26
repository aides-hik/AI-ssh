import assert from 'node:assert/strict'
import test from 'node:test'
import { fillRefractionRows, refractionGeometry } from './glass-optics-field'

function field(width: number, height: number, radius: number) {
  const geometry = refractionGeometry(width, height, radius)
  const pixels = new Uint8ClampedArray(geometry.mapWidth * geometry.mapHeight * 4)
  fillRefractionRows(geometry, pixels, 0, geometry.mapHeight)
  const pixel = (x: number, y: number) => {
    const offset = (y * geometry.mapWidth + x) * 4
    return Array.from(pixels.subarray(offset, offset + 4))
  }
  return { geometry, pixels, pixel }
}

test('glass leaves its flat centre and rounded exterior optically neutral', () => {
  const { pixel } = field(320, 180, 24)
  assert.deepEqual(pixel(160, 90), [128, 128, 128, 255])
  assert.deepEqual(pixel(0, 0), [128, 128, 128, 255])
  assert.deepEqual(pixel(160, 24), [128, 128, 128, 255])
})

test('glass thickness peaks inside the bevel and fades into a clear centre', () => {
  const { pixel } = field(320, 180, 24)
  const top = Array.from({ length: 24 }, (_, y) => pixel(160, y)[1] - 128)
  const peak = Math.max(...top)
  const peakRow = top.indexOf(peak)
  assert.ok(peak > 75, 'the bevel must visibly bend the background')
  assert.ok(peakRow > 0 && peakRow < 9, 'thickness belongs inside the silhouette')
  assert.ok(top[0] < peak / 3, 'the silhouette must not jump to maximum displacement')
  assert.equal(top.at(-1), 0)
  for (let y = peakRow + 1; y < top.length; y++) assert.ok(top[y] <= top[y - 1])
})

test('opposite glass edges bend equally and preserve rounded-corner normals', () => {
  const { geometry, pixel } = field(320, 180, 24)
  for (let y = 0; y < geometry.mapHeight; y++) {
    for (let x = 0; x < geometry.mapWidth; x++) {
      const p = pixel(x, y)
      const reflectedX = pixel(geometry.mapWidth - x - 1, y)
      const reflectedY = pixel(x, geometry.mapHeight - y - 1)
      assert.equal(p[0] + reflectedX[0], 256)
      assert.equal(p[1] + reflectedY[1], 256)
      assert.equal(p[2], 128)
      assert.equal(p[3], 255)
    }
  }
  const corner = pixel(8, 8)
  assert.ok(corner[0] > 128 && corner[1] > 128)
  assert.equal(corner[0], corner[1])
})

test('large panels retain bounded maps and an undistorted flat region', () => {
  const { geometry, pixel } = field(1440, 900, 24)
  assert.equal(geometry.mapWidth, 512)
  assert.ok(geometry.mapHeight <= 512)
  assert.deepEqual(pixel(256, 12), [128, 128, 128, 255])
  assert.ok(pixel(256, 1)[1] > 128)
})

test('small surfaces retain a neutral centre and chunked worker rows match the fallback', () => {
  for (const [width, height, radius] of [
    [1, 1, 64],
    [44, 30, 14],
    [492, 333, 32]
  ]) {
    const { geometry, pixels, pixel } = field(width, height, radius)
    assert.deepEqual(
      pixel(Math.floor(geometry.mapWidth / 2), Math.floor(geometry.mapHeight / 2)),
      [128, 128, 128, 255]
    )
    const chunks = new Uint8ClampedArray(pixels.length)
    for (let row = 0; row < geometry.mapHeight; row += 7)
      fillRefractionRows(geometry, chunks, row, Math.min(row + 7, geometry.mapHeight))
    assert.deepEqual(chunks, pixels)
  }
})
