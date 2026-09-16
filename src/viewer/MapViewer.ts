import Map from 'ol/Map.js'
import View from 'ol/View.js'
import ImageLayer from 'ol/layer/Image.js'
import TileLayer from 'ol/layer/Tile.js'
import ImageCanvasSource from 'ol/source/ImageCanvas.js'
import XYZ from 'ol/source/XYZ.js'
import { get as getProjection, toLonLat } from 'ol/proj.js'
import { defaults as interactions } from 'ol/interaction/defaults.js'
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom.js'
import { defaults as controls } from 'ol/control/defaults.js'
import ScaleLine from 'ol/control/ScaleLine.js'
import Worker from './raster.worker?worker'
import { colorRamp, type Extent } from './raster'
import type { CloudData, ColorMap, SurfaceMode } from './types'

export type LayerMode = 'lidar' | 'both' | 'orthophoto'
export type Georeference = { epsg: string; centerX: number; centerY: number }

export class MapViewer {
  readonly map: Map
  private source: ImageCanvasSource
  private readonly lidarLayer: ImageLayer<ImageCanvasSource>
  private readonly orthophotoLayer: TileLayer<XYZ>
  private raster = document.createElement('canvas')
  private rasterExtent?: Extent
  private worker?: InstanceType<typeof Worker>
  private ready = false
  private id = 0
  private radius = 400
  private origin: [number, number] = [0, 0]
  private projectionCode = 'EPSG:3857'
  private color: ColorMap = 'terrain'
  private detailRange: [number, number] | null = null
  private mode: SurfaceMode = 'surface'
  private firstResolve?: () => void
  private firstReject?: (error: Error) => void
  private observer: ResizeObserver
  private pending?: ReturnType<typeof setTimeout>
  private initialized = false

  constructor(private container: HTMLElement) {
    this.source = this.createRasterSource(this.projectionCode)
    this.orthophotoLayer = new TileLayer({
      visible: false,
      source: new XYZ({
        url: 'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileCol={x}&TileRow={y}',
        projection: 'EPSG:3857',
        crossOrigin: 'anonymous',
        transition: 150,
        maxZoom: 20,
      }),
    })
    this.lidarLayer = new ImageLayer({ source: this.source })
    container.tabIndex = 0
    this.map = new Map({
      target: container,
      pixelRatio: Math.min(devicePixelRatio, 2),
      layers: [this.orthophotoLayer, this.lidarLayer],
      view: this.createView(this.projectionCode, [0, 0]),
      interactions: interactions({ altShiftDragRotate: false, pinchRotate: false, mouseWheelZoom: false }).extend([
        new MouseWheelZoom({ useAnchor: true, duration: 180, timeout: 60, constrainResolution: false }),
      ]),
      controls: controls({ attribution: false, rotate: false }).extend([new ScaleLine({ units: 'metric' })]),
    })
    this.map.on('moveend', () => this.requestRender())
    this.map.on('movestart', () => {
      if (!this.lidarLayer.getVisible()) return
      this.id++
      container.dataset.rendering = 'moving'
    })
    this.observer = new ResizeObserver(() => { this.map.updateSize(); this.scheduleRender() })
    this.observer.observe(container)
  }

  private createView(projection: string, center: [number, number]) {
    return new View({
      projection,
      center,
      resolution: 2,
      minResolution: 0.0625,
      maxResolution: 16,
      enableRotation: false,
      smoothResolutionConstraint: false,
    })
  }

  private createRasterSource(projection: string) {
    return new ImageCanvasSource({
      projection,
      ratio: 1,
      interpolate: false,
      canvasFunction: (extent, _resolution, _ratio, size) => {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(size[0]))
        canvas.height = Math.max(1, Math.round(size[1]))
        if (this.rasterExtent) {
          const [left, bottom, right, top] = this.rasterExtent
          const sx = canvas.width / (extent[2] - extent[0])
          const sy = canvas.height / (extent[3] - extent[1])
          const context = canvas.getContext('2d')!
          context.imageSmoothingEnabled = false
          context.drawImage(this.raster, (left - extent[0]) * sx, (extent[3] - top) * sy, (right - left) * sx, (top - bottom) * sy)
        }
        return canvas
      },
    })
  }

  private setGeoreference({ epsg, centerX, centerY }: Georeference) {
    if (!getProjection(epsg)) throw new Error(`La proyección ${epsg} no está registrada en OpenLayers.`)
    this.projectionCode = epsg
    this.origin = [centerX, centerY]
    this.rasterExtent = undefined
    this.source = this.createRasterSource(epsg)
    this.lidarLayer.setSource(this.source)
    this.map.setView(this.createView(epsg, this.origin))
  }

  showCloud(data: CloudData, radius: number, georeference: Georeference): Promise<void> {
    this.clear()
    this.radius = radius
    this.setGeoreference(georeference)
    this.initialized = true
    this.worker = new Worker()
    return new Promise((resolve, reject) => {
      this.firstResolve = resolve
      this.firstReject = reject
      this.worker!.onerror = (event) => this.fail(event.message)
      this.worker!.onmessage = ({ data: result }) => {
        if (result.type === 'error') { this.fail(result.message); return }
        if (result.type === 'ready') { this.ready = true; this.requestRender(true); return }
        if (result.id !== this.id) return
        this.raster.width = result.width
        this.raster.height = result.height
        this.raster.getContext('2d')!.putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0)
        this.rasterExtent = [
          result.extent[0] + this.origin[0],
          result.extent[1] + this.origin[1],
          result.extent[2] + this.origin[0],
          result.extent[3] + this.origin[1],
        ]
        this.source.changed()
        this.map.renderSync()
        this.container.dataset.rendering = 'ready'
        this.container.dataset.lod = String(result.lod)
        this.container.dataset.cell = String(result.cell)
        this.container.dataset.fallbackPixels = String(result.fallbackPixels)
        this.container.dataset.range = JSON.stringify([result.low, result.high])
        this.container.dataset.extent = JSON.stringify(result.extent)
        this.container.dataset.projection = this.projectionCode
        this.container.dataset.origin = JSON.stringify(this.origin)
        const low = document.querySelector<HTMLElement>('#legend-min')
        const high = document.querySelector<HTMLElement>('#legend-max')
        if (low) low.textContent = result.low === null ? 'Sin datos' : `${result.low.toFixed(2)} m`
        if (high) high.textContent = result.high === null ? '—' : `${result.high.toFixed(2)} m`
        const ramp = document.querySelector<HTMLElement>('#legend-ramp')
        if (ramp) ramp.style.background = `linear-gradient(to top, ${colorRamp(this.color)})`
        const detail = document.querySelector<HTMLElement>('#view-detail')
        const contrast = this.color === 'detail-local'
          ? 'Detail local P2–P98'
          : this.color === 'detail-global'
            ? 'Detail global'
            : this.color === 'detail-manual'
              ? (this.detailRange ? 'Detail manual' : 'Detail manual · rango global')
              : 'contraste visible P2–P98'
        if (detail) detail.textContent = `${result.cell.toLocaleString('es-ES')} m/celda · ${contrast}${result.fallbackPixels ? ' · huecos cubiertos con LOD más grueso' : ''}${result.occupied ? '' : ' · sin datos en esta vista'}`
        const legend = document.querySelector<HTMLElement>('#elevation-legend')
        if (legend) legend.title = `${contrast}. Los valores fuera del intervalo usan los colores de los extremos.`
        this.firstResolve?.()
        this.firstResolve = undefined
        this.firstReject = undefined
      }
      this.resetView()
      this.worker!.postMessage({ type: 'build', data, radius }, [data.positions.buffer, data.elevations.buffer, data.classifications.buffer, data.rgb.buffer])
    })
  }

  private fail(message: string) {
    this.container.dataset.rendering = 'error'
    this.firstReject?.(new Error(message))
    this.firstReject = undefined
    this.firstResolve = undefined
    const detail = document.querySelector<HTMLElement>('#view-detail')
    if (detail) detail.textContent = `No se pudo generar la vista: ${message}`
  }

  private scheduleRender() {
    clearTimeout(this.pending)
    if (!this.lidarLayer.getVisible()) return
    if (this.ready) { this.id++; this.container.dataset.rendering = 'loading' }
    this.pending = setTimeout(() => this.requestRender(), 100)
  }

  private requestRender(force = false) {
    if (!this.ready || !this.worker || (!force && !this.lidarLayer.getVisible()) || this.map.getView().getAnimating() || this.map.getView().getInteracting()) return
    const size = this.map.getSize()
    if (!size || size[0] <= 0 || size[1] <= 0) return
    const mapExtent = this.map.getView().calculateExtent(size) as Extent
    const extent: Extent = [
      mapExtent[0] - this.origin[0],
      mapExtent[1] - this.origin[1],
      mapExtent[2] - this.origin[0],
      mapExtent[3] - this.origin[1],
    ]
    const ratio = Math.min(devicePixelRatio, 2)
    this.container.dataset.rendering = 'loading'
    this.worker.postMessage({
      type: 'render',
      id: ++this.id,
      extent,
      width: Math.round(size[0] * ratio),
      height: Math.round(size[1] * ratio),
      mode: this.mode,
      color: this.color,
      detailRange: this.detailRange,
    })
  }

  setLayerMode(mode: LayerMode) {
    const lidarVisible = mode !== 'orthophoto'
    this.lidarLayer.setVisible(lidarVisible)
    this.orthophotoLayer.setVisible(mode !== 'lidar')
    const legend = document.querySelector<HTMLElement>('#elevation-legend')
    if (legend) legend.hidden = !lidarVisible
    this.container.dataset.layerMode = mode
    if (lidarVisible) this.requestRender()
    else this.container.dataset.rendering = this.ready ? 'ready' : 'empty'
  }

  setLidarOpacity(opacity: number) {
    this.lidarLayer.setOpacity(Math.max(0, Math.min(1, opacity)))
  }

  setColorMap(color: ColorMap) { this.color = color; this.requestRender() }

  setDetailRange(range: [number, number] | null) {
    if (range && (!range.every(Number.isFinite) || range[0] >= range[1])) return
    this.detailRange = range ? [...range] : null
    if (this.color === 'detail-manual') this.requestRender()
  }

  setSurfaceMode(mode: SurfaceMode) { this.mode = mode; this.requestRender() }

  getCenterLonLat(): [number, number] | null {
    if (!this.initialized) return null
    const center = this.map.getView().getCenter()
    if (!center) return null
    return toLonLat(center, this.map.getView().getProjection()) as [number, number]
  }

  resetView() {
    if (!this.initialized) return
    this.map.getView().cancelAnimations()
    this.map.getView().fit([
      this.origin[0] - this.radius,
      this.origin[1] - this.radius,
      this.origin[0] + this.radius,
      this.origin[1] + this.radius,
    ], { padding: [90, 70, 80, 40] })
    this.scheduleRender()
  }

  clear() {
    this.worker?.terminate()
    this.worker = undefined
    this.firstReject?.(new Error('Consulta sustituida'))
    this.firstResolve = undefined
    this.firstReject = undefined
    this.ready = false
    this.initialized = false
    this.id++
    clearTimeout(this.pending)
    this.rasterExtent = undefined
    this.source.changed()
    this.container.dataset.rendering = 'empty'
  }

  dispose() {
    this.clear()
    this.observer.disconnect()
    this.map.setTarget(undefined)
    this.map.dispose()
  }
}
