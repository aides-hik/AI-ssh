import { fillRefractionRows, type RefractionGeometry } from './glass-optics-field'

self.addEventListener(
  'message',
  async (event: MessageEvent<{ id: number; geometry: RefractionGeometry }>) => {
    const { id, geometry } = event.data
    try {
      const { mapWidth, mapHeight } = geometry
      const pixels = new Uint8ClampedArray(mapWidth * mapHeight * 4)
      fillRefractionRows(geometry, pixels, 0, mapHeight)
      const canvas = new OffscreenCanvas(mapWidth, mapHeight)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas 2D is unavailable')
      context.putImageData(new ImageData(pixels, mapWidth, mapHeight), 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      self.postMessage({ id, image: `data:image/png;base64,${btoa(binary)}` })
    } catch {
      self.postMessage({ id })
    }
  }
)
