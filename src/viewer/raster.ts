import type { CloudData, ColorMap, SurfaceMode } from './types'

export type Extent = [number, number, number, number]
export type Level = { size: number; cell: number; surface: Float32Array; ground: Float32Array }
export type Pyramid = { radius: number; levels: Level[] }

const palettes: Record<ColorMap, number[][]> = {
  terrain: [[25,49,76],[42,99,117],[67,130,95],[130,151,83],[177,137,84],[166,151,133],[244,243,230]],
  viridis: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  turbo: [[48,18,59],[35,86,190],[29,184,213],[97,252,108],[238,208,47],[224,75,25],[122,4,3]],
  grayscale: [[18,22,21],[245,247,240]],
}

export function colorRamp(map: ColorMap) {
  return palettes[map].map((color) => `rgb(${color.join(',')})`).join(',')
}

function empty(length: number) { const a = new Float32Array(length); a.fill(NaN); return a }

// Two physical elevation pyramids. No RGB rescaling or global point subsampling.
// Base grid 0.5 m: its spacing is not a claim about the survey's point density.
export function buildPyramid(data: CloudData, radius: number): Pyramid {
  const size = Math.ceil(radius * 2 / 0.5)
  const surface = empty(size * size)
  const ground = empty(size * size)
  const counts = new Uint32Array(size * size)
  for (let i = 0; i < data.pointCount; i++) {
    const x = Math.floor((data.positions[i * 3] + radius) / 0.5)
    const y = Math.floor((data.positions[i * 3 + 2] + radius) / 0.5)
    const z = data.elevations[i]
    if (x < 0 || y < 0 || x >= size || y >= size || !Number.isFinite(z)) continue
    const at = y * size + x
    surface[at] = Number.isNaN(surface[at]) ? z : Math.max(surface[at], z)
    if (data.classifications[i] === 2) {
      if (!counts[at]) ground[at] = 0
      ground[at] += z
      counts[at]++
    }
  }
  for (let i = 0; i < ground.length; i++) if (counts[i]) ground[i] /= counts[i]
  const levels: Level[] = [{ size, cell: 0.5, surface, ground }]
  while (levels[levels.length - 1].size > 1) {
    const previous = levels[levels.length - 1]
    const nextSize = Math.ceil(previous.size / 2)
    const next: Level = { size: nextSize, cell: previous.cell * 2, surface: empty(nextSize ** 2), ground: empty(nextSize ** 2) }
    for (let y = 0; y < nextSize; y++) for (let x = 0; x < nextSize; x++) {
      let peak = -Infinity, sum = 0, n = 0
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const cx = x * 2 + dx, cy = y * 2 + dy
        if (cx >= previous.size || cy >= previous.size) continue
        const index = cy * previous.size + cx
        if (Number.isFinite(previous.surface[index])) peak = Math.max(peak, previous.surface[index])
        if (Number.isFinite(previous.ground[index])) { sum += previous.ground[index]; n++ }
      }
      const at = y * nextSize + x
      if (Number.isFinite(peak)) next.surface[at] = peak
      if (n) next.ground[at] = sum / n
    }
    levels.push(next)
  }
  return { radius, levels }
}

export function chooseLevel(pyramid: Pyramid, metersPerPixel: number) {
  return Math.min(pyramid.levels.length - 1, Math.max(0, Math.floor(Math.log2(metersPerPixel / pyramid.levels[0].cell))))
}

export function renderRaster(pyramid: Pyramid, extent: Extent, width: number, height: number, mode: SurfaceMode, map: ColorMap) {
  const resolution = (extent[2] - extent[0]) / width
  const lod = chooseLevel(pyramid, resolution)
  const level = pyramid.levels[lod]
  const values = level[mode]
  // Contrast is calculated from occupied cells in this viewport and this LOD only.
  const x0 = Math.max(0, Math.floor((extent[0] + pyramid.radius) / level.cell))
  const x1 = Math.min(level.size - 1, Math.floor((extent[2] + pyramid.radius) / level.cell))
  const y0 = Math.max(0, Math.floor((pyramid.radius - extent[3]) / level.cell))
  const y1 = Math.min(level.size - 1, Math.floor((pyramid.radius - extent[1]) / level.cell))
  let min = Infinity, max = -Infinity, occupied = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const value = values[y * level.size + x]
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value); max = Math.max(max, value); occupied++
  }
  // Histogram avoids sorting millions of values on every navigation event.
  let low = min, high = max
  if (occupied > 50 && max > min) {
    const bins = new Uint32Array(2048)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const value = values[y * level.size + x]
      if (Number.isFinite(value)) bins[Math.min(2047, Math.floor((value - min) / (max - min) * 2047))]++
    }
    let cumulative = 0, foundLow = false
    for (let i = 0; i < bins.length; i++) {
      cumulative += bins[i]
      if (!foundLow && cumulative >= occupied * 0.02) { low = min + i / 2047 * (max - min); foundLow = true }
      if (cumulative >= occupied * 0.98) { high = min + i / 2047 * (max - min); break }
    }
  }
  const colors = new Uint8Array(256 * 3)
  const stops = palettes[map]
  for (let i = 0; i < 256; i++) {
    const position = i / 255 * (stops.length - 1)
    const a = Math.min(stops.length - 2, Math.floor(position)), fraction = position - a
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = Math.round(stops[a][c] * (1 - fraction) + stops[a + 1][c] * fraction)
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  let validPixels = 0
  for (let y = 0; y < height; y++) {
    const north = extent[3] - (y + 0.5) / height * (extent[3] - extent[1])
    const row = Math.floor((pyramid.radius - north) / level.cell)
    for (let x = 0; x < width; x++) {
      const east = extent[0] + (x + 0.5) / width * (extent[2] - extent[0])
      const col = Math.floor((east + pyramid.radius) / level.cell)
      if (row < 0 || col < 0 || row >= level.size || col >= level.size) continue
      const value = values[row * level.size + col]
      if (!Number.isFinite(value)) continue
      const color = Math.round(Math.max(0, Math.min(1, (value - low) / Math.max(0.001, high - low))) * 255) * 3
      const out = (y * width + x) * 4
      pixels[out] = colors[color]; pixels[out + 1] = colors[color + 1]; pixels[out + 2] = colors[color + 2]; pixels[out + 3] = 255
      validPixels++
    }
  }
  return { pixels, lod, cell: level.cell, low: occupied ? low : null, high: occupied ? high : null, occupied, validPixels }
}
