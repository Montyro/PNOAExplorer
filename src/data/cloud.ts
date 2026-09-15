import { Bounds, Copc, type Hierarchy } from 'copc'
import { createLazPerf, type LazPerf } from 'laz-perf'
import type { CatalogItem } from './catalog'
import type { CloudData } from '../viewer/types'

type RangeGetter = (begin: number, end: number) => Promise<Uint8Array>
type HeaderCandidate = { item: CatalogItem; copc: Awaited<ReturnType<typeof Copc.create>>; get: RangeGetter }

let lazPerfPromise: Promise<LazPerf> | undefined

function decoder() {
  lazPerfPromise ??= createLazPerf({ locateFile: () => '/laz-perf.wasm' })
  return lazPerfPromise
}

function createRangeGetter(url: string): RangeGetter {
  return async (begin, end) => {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 12_000)
      try {
        const response = await fetch(url, {
          headers: { Range: `bytes=${begin}-${end - 1}` },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (response.status === 200 && bytes.byteLength !== end - begin) return bytes.slice(begin, end)
        return bytes
      } catch (error) {
        lastError = error
      } finally {
        window.clearTimeout(timeout)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('La petición de puntos agotó el tiempo de espera')
  }
}

function intersectsCircle(bounds: number[], x: number, y: number, radius: number) {
  const nearestX = Math.max(bounds[0], Math.min(x, bounds[3]))
  const nearestY = Math.max(bounds[1], Math.min(y, bounds[4]))
  return (nearestX - x) ** 2 + (nearestY - y) ** 2 <= radius ** 2
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>) {
  const output = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await work(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return output
}

export async function inspectCandidates(items: CatalogItem[], x: number, y: number, radius: number) {
  const candidates = await mapLimit(items.slice(0, 40), 5, async (item): Promise<HeaderCandidate | undefined> => {
    try {
      const get = createRangeGetter(item.url)
      const copc = await Copc.create(get)
      return intersectsCircle(copc.header.min.concat(copc.header.max), x, y, radius) ? { item, copc, get } : undefined
    } catch {
      return undefined
    }
  })
  return candidates.filter((candidate): candidate is HeaderCandidate => Boolean(candidate))
}

type NodeRef = { get: RangeGetter; copc: HeaderCandidate['copc']; key: string; node: Hierarchy.Node }

export async function loadCloud(
  tiles: HeaderCandidate[],
  centerX: number,
  centerY: number,
  radius: number,
  maxPoints: number,
  onProgress: (done: number, total: number) => void,
): Promise<CloudData> {
  const nodes: NodeRef[] = []
  for (const tile of tiles) {
    const pending = [tile.copc.info.rootHierarchyPage]
    const visited = new Set<number>()
    while (pending.length) {
      const page = pending.pop()!
      if (visited.has(page.pageOffset)) continue
      visited.add(page.pageOffset)
      const hierarchy = await Copc.loadHierarchyPage(tile.get, page)
      const intersects = (key: string) => intersectsCircle(Bounds.stepTo(tile.copc.info.cube, key.split('-').map(Number) as [number, number, number, number]), centerX, centerY, radius)
      for (const [key, node] of Object.entries(hierarchy.nodes)) {
        if (node && node.pointCount > 0 && intersects(key)) nodes.push({ get: tile.get, copc: tile.copc, key, node })
      }
      for (const [key, child] of Object.entries(hierarchy.pages)) {
        if (child && intersects(key)) pending.push(child)
      }
    }
  }

  const estimatedPoints = nodes.reduce((sum, entry) => sum + entry.node.pointCount, 0)
  if (estimatedPoints > maxPoints) throw new Error('Esta zona supera el límite de memoria. Reduce el radio para conservar todo el detalle LiDAR.')
  const capacity = estimatedPoints
  const positions = new Float32Array(capacity * 3)
  const rgb = new Uint8Array(capacity * 3)
  const classifications = new Uint8Array(capacity)
  const elevations = new Float32Array(capacity)
  let count = 0
  let minElevation = Infinity
  let maxElevation = -Infinity
  let completedNodes = 0
  let skippedNodes = 0
  const wasm = await decoder()

  await mapLimit(nodes, 3, async (entry) => {
    try {
      const view = await Copc.loadPointDataView(entry.get, entry.copc, entry.node, {
        lazPerf: wasm,
        include: ['X', 'Y', 'Z', 'Red', 'Green', 'Blue', 'Classification'],
      })
      const getX = view.getter('X')
      const getY = view.getter('Y')
      const getZ = view.getter('Z')
      const getClass = view.dimensions.Classification ? view.getter('Classification') : () => 0
      const getRed = view.dimensions.Red ? view.getter('Red') : () => 45000
      const getGreen = view.dimensions.Green ? view.getter('Green') : () => 45000
      const getBlue = view.dimensions.Blue ? view.getter('Blue') : () => 45000
      for (let i = 0; i < view.pointCount; i++) {
        const px = getX(i)
        const py = getY(i)
        if ((px - centerX) ** 2 + (py - centerY) ** 2 > radius ** 2) continue
        const pz = getZ(i)
        const outputIndex = count++
        positions[outputIndex * 3] = px - centerX
        positions[outputIndex * 3 + 1] = pz
        positions[outputIndex * 3 + 2] = -(py - centerY)
        const normalize = (value: number) => Math.min(255, value > 255 ? value / 256 : value)
        rgb[outputIndex * 3] = normalize(getRed(i))
        rgb[outputIndex * 3 + 1] = normalize(getGreen(i))
        rgb[outputIndex * 3 + 2] = normalize(getBlue(i))
        classifications[outputIndex] = getClass(i)
        elevations[outputIndex] = pz
        minElevation = Math.min(minElevation, pz)
        maxElevation = Math.max(maxElevation, pz)
      }
    } catch (error) {
      console.warn(`Nodo COPC omitido (${entry.key})`, error)
      skippedNodes += 1
    } finally {
      completedNodes += 1
      onProgress(completedNodes, nodes.length)
    }
  })

  if (!count) throw new Error('Ningún nodo LiDAR respondió correctamente. Vuelve a intentarlo.')
  for (let i = 0; i < count; i += 1) positions[i * 3 + 1] -= minElevation
  return {
    positions: positions.slice(0, count * 3),
    rgb: rgb.slice(0, count * 3),
    classifications: classifications.slice(0, count),
    elevations: elevations.slice(0, count),
    minElevation,
    maxElevation,
    pointCount: count,
    skippedNodes,
  }
}
