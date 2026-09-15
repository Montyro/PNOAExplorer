import { buildPyramid, renderRaster, type Extent, type Pyramid } from './raster'
import type { CloudData, ColorMap, SurfaceMode } from './types'

let pyramid: Pyramid | undefined
type Input = { type: 'build'; data: CloudData; radius: number } | { type: 'render'; id: number; extent: Extent; width: number; height: number; mode: SurfaceMode; color: ColorMap }
self.onmessage = (event: MessageEvent<Input>) => {
  const message = event.data
  try {
    if (message.type === 'build') {
      pyramid = buildPyramid(message.data, message.radius)
      self.postMessage({ type: 'ready', levels: pyramid.levels.length })
    } else if (pyramid) {
      const result = renderRaster(pyramid, message.extent, message.width, message.height, message.mode, message.color)
      self.postMessage({ type: 'raster', id: message.id, extent: message.extent, width: message.width, height: message.height, ...result }, { transfer: [result.pixels.buffer] })
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
