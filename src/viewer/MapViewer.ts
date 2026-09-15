import Map from 'ol/Map.js'
import View from 'ol/View.js'
import Projection from 'ol/proj/Projection.js'
import ImageLayer from 'ol/layer/Image.js'
import ImageCanvasSource from 'ol/source/ImageCanvas.js'
import { defaults as interactions } from 'ol/interaction/defaults.js'
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom.js'
import { defaults as controls } from 'ol/control/defaults.js'
import ScaleLine from 'ol/control/ScaleLine.js'
import Worker from './raster.worker?worker'
import { colorRamp, type Extent } from './raster'
import type { CloudData, ColorMap, SurfaceMode } from './types'

export class MapViewer {
  readonly map: Map
  private source: ImageCanvasSource
  private raster = document.createElement('canvas')
  private rasterExtent?: Extent
  private worker?: InstanceType<typeof Worker>
  private ready = false
  private id = 0
  private radius = 400
  private color: ColorMap = 'terrain'
  private mode: SurfaceMode = 'surface'
  private firstResolve?: () => void
  private firstReject?: (error: Error) => void
  private observer: ResizeObserver
  private pending?: ReturnType<typeof setTimeout>
  private initialized = false

  constructor(private container: HTMLElement) {
    const projection = new Projection({ code: 'PNOA:local', units: 'm' })
    this.source = new ImageCanvasSource({
      projection, ratio: 1, interpolate: false,
      canvasFunction: (extent, _resolution, _ratio, size) => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(size[0])); canvas.height = Math.max(1, Math.round(size[1]))
        if (this.rasterExtent) {
          const [left, bottom, right, top] = this.rasterExtent
          const sx = canvas.width / (extent[2] - extent[0]), sy = canvas.height / (extent[3] - extent[1])
          const context = canvas.getContext('2d')!
          context.imageSmoothingEnabled = false
          context.drawImage(this.raster, (left - extent[0]) * sx, (extent[3] - top) * sy, (right - left) * sx, (top - bottom) * sy)
        }
        return canvas
      },
    })
    container.tabIndex = 0
    this.map = new Map({
      target: container, pixelRatio: Math.min(devicePixelRatio, 2),
      layers: [new ImageLayer({ source: this.source })],
      view: new View({ projection, center: [0, 0], resolution: 2, minResolution: 0.0625, maxResolution: 16, enableRotation: false, smoothResolutionConstraint: false }),
      interactions: interactions({ altShiftDragRotate: false, pinchRotate: false, mouseWheelZoom: false }).extend([
        new MouseWheelZoom({ useAnchor: true, duration: 180, timeout: 60, constrainResolution: false }),
      ]),
      controls: controls({ attribution: false, rotate: false }).extend([new ScaleLine({ units: 'metric' })]),
    })
    this.map.on('moveend', () => this.requestRender())
    this.map.on('movestart', () => { this.id++; container.dataset.rendering = 'moving' })
    this.observer = new ResizeObserver(() => { this.map.updateSize(); this.scheduleRender() })
    this.observer.observe(container)
  }

  showCloud(data: CloudData, radius: number): Promise<void> {
    this.clear()
    this.radius = radius
    this.initialized = true
    this.worker = new Worker()
    return new Promise((resolve, reject) => {
      this.firstResolve = resolve; this.firstReject = reject
      this.worker!.onerror = (event) => this.fail(event.message)
      this.worker!.onmessage = ({ data: result }) => {
        if (result.type === 'error') { this.fail(result.message); return }
        if (result.type === 'ready') { this.ready = true; this.requestRender(); return }
        if (result.id !== this.id) return
        this.raster.width = result.width; this.raster.height = result.height
        this.raster.getContext('2d')!.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0)
        this.rasterExtent = result.extent
        this.source.changed()
        this.map.renderSync()
        this.container.dataset.rendering = 'ready'
        this.container.dataset.lod = String(result.lod)
        this.container.dataset.cell = String(result.cell)
        this.container.dataset.range = JSON.stringify([result.low, result.high])
        this.container.dataset.extent = JSON.stringify(result.extent)
        const low = document.querySelector<HTMLElement>('#legend-min')
        const high = document.querySelector<HTMLElement>('#legend-max')
        if (low) low.textContent = result.low === null ? 'Sin datos' : `${result.low.toFixed(2)} m`
        if (high) high.textContent = result.high === null ? '—' : `${result.high.toFixed(2)} m`
        const ramp = document.querySelector<HTMLElement>('#legend-ramp')
        if (ramp) ramp.style.background = `linear-gradient(to top, ${colorRamp(this.color)})`
        const detail = document.querySelector<HTMLElement>('#view-detail')
        if (detail) detail.textContent = `${result.cell.toLocaleString('es-ES')} m/celda · contraste visible P2–P98${result.occupied ? '' : ' · sin datos en esta vista'}`
        this.firstResolve?.(); this.firstResolve = undefined; this.firstReject = undefined
      }
      this.resetView()
      this.worker!.postMessage({ type: 'build', data, radius }, [data.positions.buffer, data.elevations.buffer, data.classifications.buffer, data.rgb.buffer])
    })
  }

  private fail(message: string) {
    this.container.dataset.rendering = 'error'
    this.firstReject?.(new Error(message)); this.firstReject = undefined; this.firstResolve = undefined
    const detail = document.querySelector<HTMLElement>('#view-detail')
    if (detail) detail.textContent = `No se pudo generar la vista: ${message}`
  }
  private scheduleRender() {
    clearTimeout(this.pending)
    if (this.ready) { this.id++; this.container.dataset.rendering = 'loading' }
    this.pending = setTimeout(() => this.requestRender(), 100)
  }
  private requestRender() {
    if (!this.ready || !this.worker || this.map.getView().getAnimating() || this.map.getView().getInteracting()) return
    const size = this.map.getSize()
    if (!size || size[0] <= 0 || size[1] <= 0) return
    const extent = this.map.getView().calculateExtent(size) as Extent
    const ratio = Math.min(devicePixelRatio, 2)
    this.container.dataset.rendering = 'loading'
    this.worker.postMessage({ type: 'render', id: ++this.id, extent, width: Math.round(size[0] * ratio), height: Math.round(size[1] * ratio), mode: this.mode, color: this.color })
  }
  setColorMap(color: ColorMap) { this.color = color; this.requestRender() }
  setSurfaceMode(mode: SurfaceMode) { this.mode = mode; this.requestRender() }
  resetView() {
    if (!this.initialized) return
    this.map.getView().cancelAnimations()
    this.map.getView().fit([-this.radius, -this.radius, this.radius, this.radius], { padding: [90, 70, 80, 40] })
    this.scheduleRender()
  }
  clear() {
    this.worker?.terminate(); this.worker = undefined
    this.firstReject?.(new Error('Consulta sustituida'))
    this.firstResolve = undefined; this.firstReject = undefined
    this.ready = false; this.initialized = false; this.id++
    clearTimeout(this.pending)
    this.rasterExtent = undefined; this.source.changed()
    this.container.dataset.rendering = 'empty'
  }
  dispose() { this.clear(); this.observer.disconnect(); this.map.setTarget(undefined); this.map.dispose() }
}
