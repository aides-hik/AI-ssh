import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Reuse the monorepo's existing image dependency; no packaging tools are run.
const serverRequire = createRequire(new URL('../../../packages/server/package.json', import.meta.url))
const sharp = serverRequire('sharp')
const directory = fileURLToPath(new URL('../resources/icons/', import.meta.url))
const source = await readFile(join(directory, 'canva-preview.png'))
const metadata = await sharp(source).metadata()
if (!metadata.width || metadata.width !== metadata.height) {
  throw new Error('The Canva source must be a square PNG')
}

// Remove only the black outside corners around the approved rounded app tile.
// Preserve the source resolution rather than presenting an upscale as a master.
const size = metadata.width
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.18}" fill="white"/></svg>`)
const icon = await sharp(source).ensureAlpha()
  .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
await writeFile(join(directory, 'prism.png'), icon)

async function pngAt(size) {
  return sharp(icon).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
}

// ICO uses PNG payloads, supported by Windows Vista and later.
const windowsSizes = [16, 24, 32, 48, 64, 128, 256]
const windowsImages = await Promise.all(windowsSizes.map(pngAt))
const icoHeader = Buffer.alloc(6 + windowsSizes.length * 16)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(windowsSizes.length, 4)
let offset = icoHeader.length
for (let i = 0; i < windowsSizes.length; i++) {
  const entry = 6 + i * 16
  icoHeader[entry] = windowsSizes[i] % 256
  icoHeader[entry + 1] = windowsSizes[i] % 256
  icoHeader.writeUInt16LE(1, entry + 4)
  icoHeader.writeUInt16LE(32, entry + 6)
  icoHeader.writeUInt32LE(windowsImages[i].length, entry + 8)
  icoHeader.writeUInt32LE(offset, entry + 12)
  offset += windowsImages[i].length
}
await writeFile(join(directory, 'prism.ico'), Buffer.concat([icoHeader, ...windowsImages]))

// Modern ICNS stores one PNG per size. Required large representations are
// resampled from the available source; they do not add original image detail.
const macSizes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
const chunks = await Promise.all(macSizes.map(async ([type, size]) => {
  const png = await pngAt(size)
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([header, png])
}))
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns', 0, 4, 'ascii')
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile(join(directory, 'prism.icns'), Buffer.concat([icnsHeader, ...chunks]))
await writeFile(join(directory, 'prism-linux.png'), await pngAt(512))
console.log(`Generated Prism app icons from the ${size}×${size} Canva source.`)
