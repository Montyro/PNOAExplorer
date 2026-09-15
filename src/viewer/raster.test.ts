import { describe, expect, it } from 'vitest'
import { buildPyramid, chooseLevel, renderRaster } from './raster'
import type { CloudData } from './types'

function cloud(points: number[][]): CloudData {
  return {
    positions: new Float32Array(points.flatMap(([x, south, z]) => [x, z, south])),
    elevations: new Float32Array(points.map((p) => p[2])),
    classifications: new Uint8Array(points.map((p) => p[3] ?? 2)),
    rgb: new Uint8Array(points.length * 3), pointCount: points.length,
    minElevation: 0, maxElevation: 9999, skippedNodes: 0,
  }
}
describe('elevation LOD and visible contrast', () => {
  it('reveals separate elevations at close range instead of enlarging an overview pixel', () => {
    const pyramid = buildPyramid(cloud([[-0.8,-0.8,10],[-0.3,-0.8,20]]), 1)
    expect(chooseLevel(pyramid, 0.1)).toBe(0)
    expect(chooseLevel(pyramid, 2)).toBe(2)
    expect(pyramid.levels[2].surface[0]).toBe(20)
    expect(pyramid.levels[0].surface[0]).toBe(10)
    expect(pyramid.levels[0].surface[1]).toBe(20)
  })
  it('excludes an offscreen mountain from the color range', () => {
    const pyramid = buildPyramid(cloud([[-1.8,-1.8,100],[-1.3,-1.8,100.5],[1.8,1.8,1000]]), 2)
    const overview = renderRaster(pyramid, [-2,-2,2,2], 8,8,'surface','terrain')
    const close = renderRaster(pyramid, [-2,1,-1,2], 8,8,'surface','terrain')
    expect(overview.high).toBe(1000)
    expect(close.low).toBe(100)
    expect(close.high).toBe(100.5)
    expect(close.validPixels).toBeGreaterThan(0)
  })
  it('filters ground before computing contrast and excludes nodata', () => {
    const pyramid = buildPyramid(cloud([[0.1,0.1,30,2],[0.2,0.2,32,2],[0.1,0.1,200,6]]), 1)
    const ground = renderRaster(pyramid, [-1,-1,1,1], 4,4,'ground','viridis')
    expect(ground.low).toBe(31)
    expect(ground.high).toBe(31)
    expect(ground.occupied).toBe(1)
    const empty = renderRaster(pyramid, [100,100,101,101],4,4,'ground','terrain')
    expect(empty.low).toBeNull()
    expect(empty.high).toBeNull()
    expect(empty.validPixels).toBe(0)
  })
  it('preserves north-up orientation and robust local percentiles', () => {
    const points: number[][] = []
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) points.push([-3.75+x/2,-3.75+y/2,100+y])
    points[0][2] = 9999
    const pyramid = buildPyramid(cloud(points),4)
    const image = renderRaster(pyramid,[-4,-4,4,4],16,16,'ground','grayscale')
    expect(image.high).toBeLessThan(120)
    expect(image.low).toBeGreaterThanOrEqual(100)
    expect(image.pixels[4]).toBeLessThan(image.pixels[15*16*4+4])
  })
})
