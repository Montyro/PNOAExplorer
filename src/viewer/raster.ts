import type { CloudData, ColorMap, SurfaceMode } from './types'

export type Extent = [number, number, number, number]
export type Level = { size: number; cell: number; surface: Float32Array; ground: Float32Array }
export type Pyramid = { radius: number; levels: Level[];   globalRanges: {
    surface: [number, number] | null
    ground: [number, number] | null }}

function getRange(values: Float32Array): [number, number] | null {
  let min = Infinity
  let max = -Infinity

  for (let i = 0; i < values.length; i++) {
    const value = values[i]

    if (!Number.isFinite(value)) continue

    if (value < min) min = value
    if (value > max) max = value
  }

  return Number.isFinite(min) && Number.isFinite(max)
    ? [min, max]
    : null
}
const detailPalette = [
  [12, 7, 35], [30, 18, 75], [48, 30, 120], [54, 55, 160], [45, 85, 190],
  [30, 120, 205], [20, 155, 205], [20, 185, 185], [25, 200, 145], [45, 205, 95],
  [90, 210, 55], [145, 215, 35], [195, 215, 30], [235, 205, 35], [250, 175, 35],
  [250, 135, 35], [245, 90, 40], [225, 50, 55], [200, 35, 85], [170, 30, 125],
  [145, 40, 165], [165, 80, 195], [195, 125, 215], [225, 175, 230], [250, 235, 245],
]

const palettes: Record<ColorMap, number[][]> = {
  terrain: [[25,49,76],[42,99,117],[67,130,95],[130,151,83],[177,137,84],[166,151,133],[244,243,230]],
  viridis: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  turbo: [[48,18,59],[35,86,190],[29,184,213],[97,252,108],[238,208,47],[224,75,25],[122,4,3]],
  grayscale: [[18,22,21],[245,247,240]],
  'detail-local': detailPalette,
  'detail-global': detailPalette,
  'detail-manual': detailPalette,
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

  const globalRanges = {
    surface: getRange(surface),
    ground: getRange(ground),
  }

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
  return {
  radius,
  levels,
  globalRanges,
}
}

export function chooseLevel(pyramid: Pyramid, metersPerPixel: number) {
  return Math.min(pyramid.levels.length - 1, Math.max(0, Math.floor(Math.log2(metersPerPixel / pyramid.levels[0].cell))))
}


// Select the nearest available ancestor; never write fallback values into the pyramid.
export function sampleElevation(pyramid: Pyramid, lod: number, row: number, col: number, mode: SurfaceMode): number {
  for (let i = lod; i < pyramid.levels.length; i++) {
    const level = pyramid.levels[i]
    if (row < 0 || col < 0 || row >= level.size || col >= level.size) return NaN
    const value = level[mode][row * level.size + col]
    if (Number.isFinite(value)) return value
    row = Math.floor(row / 2)
    col = Math.floor(col / 2)
  }
  return NaN
}

export function renderRaster(pyramid: Pyramid, extent: Extent, width: number, height: number, mode: SurfaceMode, map: ColorMap, detailRange: [number, number] | null = null) {
  const resolution = (extent[2] - extent[0]) / width
  const lod = chooseLevel(pyramid, resolution)
  const level = pyramid.levels[lod]
  const samples = empty(width * height)
  let min = Infinity, max = -Infinity, occupied = 0, fallbackPixels = 0
  // Resolve coverage first, so contrast describes what is actually visible,
  // including coarser cells. Pixel centres outside the requested circle stay empty.
  for (let y = 0; y < height; y++) {
    const north = extent[3] - (y + 0.5) / height * (extent[3] - extent[1])
    const row = Math.floor((pyramid.radius - north) / level.cell)
    for (let x = 0; x < width; x++) {
      const east = extent[0] + (x + 0.5) / width * (extent[2] - extent[0])
      if (east * east + north * north > pyramid.radius * pyramid.radius) continue
      const col = Math.floor((east + pyramid.radius) / level.cell)
      const value = sampleElevation(pyramid, lod, row, col, mode)
      if (!Number.isFinite(value)) continue
      samples[y * width + x] = value
      if (!Number.isFinite(level[mode][row * level.size + col])) fallbackPixels++
      min = Math.min(min, value); max = Math.max(max, value); occupied++
    }
  }
  let low = min, high = max
  if (occupied > 50 && max > min) {
    const bins = new Uint32Array(2048)
    for (const value of samples) {
      if (Number.isFinite(value)) bins[Math.min(2047, Math.floor((value - min) / (max - min) * 2047))]++
    }
    let cumulative = 0, foundLow = false
    for (let i = 0; i < bins.length; i++) {
      cumulative += bins[i]
      if (!foundLow && cumulative >= occupied * 0.02) { low = min + i / 2047 * (max - min); foundLow = true }
      if (cumulative >= occupied * 0.98) { high = min + i / 2047 * (max - min); break }
    }
  }
  if (map === 'detail-global' || map === 'detail-manual') {
    const validManualRange = detailRange && detailRange.every(Number.isFinite) && detailRange[0] < detailRange[1]
    const range = map === 'detail-manual' && validManualRange ? detailRange : pyramid.globalRanges[mode]
    if (range) { low = range[0]; high = range[1] }
  }
  const colorLevels = map.startsWith('detail-') ? 4096 : 256
  const colors = new Uint8Array(colorLevels * 3)
  const stops = palettes[map]
  for (let i = 0; i < colorLevels; i++) {
    const position = i / (colorLevels - 1) * (stops.length - 1)
    const a = Math.min(stops.length - 2, Math.floor(position))
    const fraction = position - a
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = Math.round(stops[a][c] * (1 - fraction) + stops[a + 1][c] * fraction)
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]
    if (!Number.isFinite(value)) continue
    const normalized = Math.max(0, Math.min(1, (value - low) / Math.max(0.001, high - low)))
    const color = Math.round(normalized * (colorLevels - 1)) * 3
    pixels[i * 4] = colors[color]
    pixels[i * 4 + 1] = colors[color + 1]
    pixels[i * 4 + 2] = colors[color + 2]
    pixels[i * 4 + 3] = 255
  }
  return { pixels, lod, cell: level.cell, low: occupied ? low : null, high: occupied ? high : null, occupied, validPixels: occupied, fallbackPixels }
}
