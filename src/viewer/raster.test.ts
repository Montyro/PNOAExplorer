import { describe, expect, it } from 'vitest'
import { buildPyramid, chooseLevel, renderRaster, sampleElevation } from './raster'
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
  it('maps a manual Detail interval to the palette and clamps outside heights', () => {
    const pyramid = buildPyramid(cloud([[-0.75,-0.25,600],[-0.25,-0.25,750],[0.25,-0.25,1100],[0.75,-0.25,1600]]),1)
    const result = renderRaster(pyramid,[-1,0,1,0.5],4,1,'surface','detail-manual',[750,1100])
    expect([result.low,result.high]).toEqual([750,1100])
    expect([...result.pixels]).toEqual([12,7,35,255,12,7,35,255,250,235,245,255,250,235,245,255])
    const automatic = renderRaster(pyramid,[-1,0,1,0.5],4,1,'surface','detail-global')
    expect([automatic.low,automatic.high]).toEqual([600,1600])
    const otherPalette = renderRaster(pyramid,[-1,0,1,0.5],4,1,'surface','terrain',[750,1100])
    expect([otherPalette.low,otherPalette.high]).toEqual([600,1600])
    const invalid = renderRaster(pyramid,[-1,0,1,0.5],4,1,'surface','detail-manual',[1100,750])
    expect([invalid.low,invalid.high]).toEqual([600,1600])
  })
  it('reveals separate elevations at close range instead of enlarging an overview pixel', () => {
    const pyramid = buildPyramid(cloud([[-0.8,-0.8,10],[-0.3,-0.8,20]]), 1)
    expect(chooseLevel(pyramid, 0.1)).toBe(0)
    expect(chooseLevel(pyramid, 2)).toBe(2)
    expect(pyramid.levels[2].surface[0]).toBe(20)
    expect(pyramid.levels[0].surface[0]).toBe(10)
    expect(pyramid.levels[0].surface[1]).toBe(20)
  })
  it('excludes an offscreen mountain from the color range', () => {
    const pyramid = buildPyramid(cloud([[-1.3,-0.8,100],[-0.8,-0.8,100.5],[1.3,0.8,1000]]), 2)
    const overview = renderRaster(pyramid, [-2,-2,2,2], 8,8,'surface','terrain')
    const close = renderRaster(pyramid, [-1.5,0.5,-0.5,1], 8,4,'surface','terrain')
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
    expect(ground.occupied).toBe(12)
    expect(ground.fallbackPixels).toBe(11)
    const empty = renderRaster(pyramid, [100,100,101,101],4,4,'ground','terrain')
    expect(empty.low).toBeNull()
    expect(empty.high).toBeNull()
    expect(empty.validPixels).toBe(0)
  })
  it('preserves north-up orientation and robust local percentiles', () => {
    const points: number[][] = []
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) points.push([-3.75+x/2,-3.75+y/2,100+y])
    points[8][2] = 9999
    const pyramid = buildPyramid(cloud(points),4)
    const image = renderRaster(pyramid,[-4,-4,4,4],16,16,'ground','grayscale')
    expect(image.high).toBeLessThan(120)
    expect(image.low).toBeGreaterThanOrEqual(100)
    expect(image.pixels[(16+8)*4]).toBeLessThan(image.pixels[(14*16+8)*4])
  })
  it('uses the nearest available ancestor without changing measured cells', () => {
    const pyramid = buildPyramid(cloud([[-0.75,-0.75,10],[-0.25,-0.75,20],[0.25,0.25,80]]),1)
    const original = pyramid.levels[0].surface.slice()
    expect(sampleElevation(pyramid,0,0,0,'surface')).toBe(10)
    expect(sampleElevation(pyramid,0,1,0,'surface')).toBe(20)
    expect(sampleElevation(pyramid,0,0,2,'surface')).toBe(80)
    expect(sampleElevation(pyramid,0,1,0,'ground')).toBe(15)
    renderRaster(pyramid,[-1,-1,1,1],32,32,'surface','terrain')
    expect(pyramid.levels[0].surface).toEqual(original)
  })
  it('fills interior gaps but keeps the outside of the query transparent', () => {
    const pyramid = buildPyramid(cloud([[0.1,0.1,30]]),1)
    const result = renderRaster(pyramid,[-1,-1,1,1],4,4,'surface','terrain')
    expect(result.validPixels).toBe(12)
    expect(result.fallbackPixels).toBe(11)
    expect(result.pixels[3]).toBe(0)
    expect(result.pixels[(1*4+1)*4+3]).toBe(255)
    const fallbackOnly = renderRaster(pyramid,[-0.5,0,0,0.5],2,2,'surface','terrain')
    expect(fallbackOnly.low).toBe(30)
    expect(fallbackOnly.high).toBe(30)
    expect(fallbackOnly.fallbackPixels).toBe(4)
  })
  it('keeps missing ground empty when no ancestor contains ground', () => {
    const pyramid = buildPyramid(cloud([[0.1,0.1,30,6]]),1)
    const result = renderRaster(pyramid,[-1,-1,1,1],4,4,'ground','terrain')
    expect(result.validPixels).toBe(0)
    expect(result.low).toBeNull()
  })
  it('separates local and global ranges for the Detail palette', () => {
    const pyramid = buildPyramid(cloud([[-0.25,-0.25,10],[0.25,0.25,80]]),1)
    const local = renderRaster(pyramid,[-0.5,0,0,0.5],2,2,'surface','detail-local')
    const global = renderRaster(pyramid,[-0.5,0,0,0.5],2,2,'surface','detail-global')
    expect([local.low,local.high]).toEqual([10,10])
    expect([global.low,global.high]).toEqual([10,80])
  })
})
