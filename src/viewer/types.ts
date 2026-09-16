export type ColorMap = 'terrain' | 'viridis' | 'turbo' | 'grayscale' | 'detail-local' | 'detail-global' | 'detail-manual'
export type SurfaceMode = 'surface' | 'ground'
export type CloudData = {
  positions: Float32Array
  rgb: Uint8Array
  classifications: Uint8Array
  elevations: Float32Array
  minElevation: number
  maxElevation: number
  pointCount: number
  skippedNodes: number
}
