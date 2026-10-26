export interface RefractionGeometry {
  width: number
  height: number
  radius: number
  mapWidth: number
  mapHeight: number
  key: string
}

export function refractionGeometry(
  width: number,
  height: number,
  cornerRadius: number
): RefractionGeometry {
  const cssWidth = Math.max(1, Math.round(width))
  const cssHeight = Math.max(1, Math.round(height))
  const radius = Math.max(0, Math.min(cornerRadius, cssWidth / 2, cssHeight / 2))
  const ratio = Math.min(1, 512 / Math.max(cssWidth, cssHeight))
  return {
    width: cssWidth,
    height: cssHeight,
    radius,
    mapWidth: Math.max(1, Math.round(cssWidth * ratio)),
    mapHeight: Math.max(1, Math.round(cssHeight * ratio)),
    key: `${cssWidth}:${cssHeight}:${radius}`
  }
}

/** A rounded bevel refracts the scene; the flat centre keeps it undistorted. */
export function fillRefractionRows(
  geometry: RefractionGeometry,
  pixels: Uint8ClampedArray,
  startRow: number,
  endRow: number
) {
  const { width, height, radius, mapWidth, mapHeight } = geometry
  const halfWidth = width / 2
  const halfHeight = height / 2
  // Bevel width follows the corner geometry, rather than growing with the panel.
  // Keeping it inside the corner radius also avoids the SDF's medial-axis seam.
  const rim = Math.min(32, Math.max(6, radius * 0.88), Math.min(width, height) * 0.35)
  const inverseGlassIndex = 1 / 1.46
  for (let y = startRow; y < endRow; y++) {
    const py = ((y + 0.5) / mapHeight) * height - halfHeight
    for (let x = 0; x < mapWidth; x++) {
      const px = ((x + 0.5) / mapWidth) * width - halfWidth
      const qx = Math.abs(px) - (halfWidth - radius)
      const qy = Math.abs(py) - (halfHeight - radius)
      const exteriorX = Math.max(qx, 0)
      const exteriorY = Math.max(qy, 0)
      const exteriorLength =
        exteriorX === 0 ? exteriorY : exteriorY === 0 ? exteriorX : Math.hypot(exteriorX, exteriorY)
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
        } else if (qx > qy) normalX = Math.sign(px)
        else normalY = Math.sign(py)
        const depth = Math.min(1, -distance / rim)
        const edge = 1 - depth
        // A convex cross-section rises from the silhouette to a flat top:
        // h = sqrt(1 - edge³). Its slope reaches zero smoothly at the flat join.
        // Trace a perpendicular ray through that curved air/glass interface and
        // the flat underside using Snell's law, with a glass index of 1.46.
        const height = Math.sqrt(1 - edge * edge * edge)
        const slopeX = 1.275 * edge * edge
        const normalLength = Math.hypot(slopeX, height)
        const sinIncident = slopeX / normalLength
        const cosIncident = height / normalLength
        const sinRefracted = sinIncident * inverseGlassIndex
        const cosRefracted = Math.sqrt(1 - sinRefracted * sinRefracted)
        const rayX = sinIncident * cosRefracted - cosIncident * sinRefracted
        const rayZ = cosIncident * cosRefracted + sinIncident * sinRefracted
        const displacement = (height * rayX) / rayZ
        // The silhouette itself has no glass thickness. A short coverage ramp
        // keeps the PNG's bilinear sampling continuous across rounded corners.
        const coverage = Math.min(1, depth / 0.16)
        const smoothCoverage = coverage * coverage * (3 - 2 * coverage)
        const bend = Math.min(116, displacement * 480) * smoothCoverage
        red = Math.round(128 - normalX * bend)
        green = Math.round(128 - normalY * bend)
      }
      pixels[offset] = red
      pixels[offset + 1] = green
      pixels[offset + 2] = 128
      pixels[offset + 3] = 255
    }
  }
}
