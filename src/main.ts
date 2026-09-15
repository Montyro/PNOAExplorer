import './style.css'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import TileWMS from 'ol/source/TileWMS.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { datasetForCoordinate, projectCoordinate } from './data/datasets'
import { loadCatalog, nearbyCatalogItems } from './data/catalog'
import { inspectCandidates, loadCloud } from './data/cloud'
import { MapViewer } from './viewer/MapViewer'
import type { ColorMap, SurfaceMode } from './viewer/types'

const formatNumber = new Intl.NumberFormat('es-ES')

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <section class="viewer-panel">
      <div id="viewer" class="viewer" aria-label="Mapa cenital de elevación LiDAR"></div>
      <header class="brand">
        <span class="brand-mark"><i></i><i></i><i></i></span>
        <div><strong>PNOA LiDAR</strong><small>mapa de elevaciones</small></div>
      </header>
      <div class="viewer-hint"><span>Arrastrar</span> desplazar · <span>Rueda / doble clic</span> acercar<br><span id="view-detail">Detalle y contraste adaptados al área visible</span></div>
      <button id="fit-view" class="fit-view" type="button">Encuadrar zona</button>
      <div id="elevation-legend" class="elevation-legend" title="Contraste local: percentiles 2–98 de las celdas visibles. Los valores extremos se saturan."><span id="legend-max">—</span><i id="legend-ramp"></i><span id="legend-min">—</span><small>Elevación · vista</small></div>
      <div class="scale-chip"><i></i><span id="cloud-summary">Introduce una coordenada para comenzar</span></div>
    </section>

    <aside class="sidebar">
      <div class="sidebar-scroll">
        <p class="eyebrow">Explorar el territorio</p>
        <h1>La forma de España,<br><em>punto a punto.</em></h1>
        <p class="lede">Escribe una coordenada o toca el mapa. El visor localiza las teselas PNOA y transmite solo el detalle necesario.</p>

        <form id="search-form">
          <div class="coordinate-grid">
            <label>Latitud<input id="latitude" type="number" step="any" min="27" max="44" value="40.43190101842764" required></label>
            <label>Longitud<input id="longitude" type="number" step="any" min="-19" max="5" value="-2.6694763767013745" required></label>
          </div>
          <label class="range-label"><span>Radio de exploración <output id="radius-output">400 m</output></span><input id="radius" type="range" min="100" max="1000" step="50" value="400"></label>
          <button id="load-button" class="primary" type="submit"><span>Visualizar LiDAR</span><b>↗</b></button>
        </form>

        <div id="status-card" class="status-card idle" aria-live="polite">
          <div class="status-icon"><span></span></div>
          <div><strong id="status-title">Listo para explorar</strong><p id="status-detail">Los datos se cargan desde una réplica pública del PNOA.</p></div>
        </div>

        <div class="map-wrap">
          <div id="map" class="map"></div>
          <div class="map-label">Ortofoto PNOA</div>
        </div>

        <section id="dataset-card" class="dataset-card hidden">
          <div><span>Fuente</span><strong id="dataset-name">—</strong></div>
          <div class="metric-row"><div><span>Cobertura</span><strong id="dataset-years">—</strong></div><div><span>Densidad</span><strong id="dataset-density">—</strong></div></div>
          <div class="metric-row"><div><span>Teselas</span><strong id="tile-count">—</strong></div><div><span>Puntos visibles</span><strong id="point-count">—</strong></div></div>
        </section>

        <section class="controls-card">
          <label>Modelo<select id="surface-mode"><option value="surface">Superficie DSM</option><option value="ground">Terreno · clase 2</option></select></label>
          <label>Colormap<select id="color-mode"><option value="terrain">Terreno</option><option value="viridis">Viridis</option><option value="turbo">Turbo</option><option value="grayscale">Escala de grises</option></select></label>
        </section>
      </div>
      <footer>Datos IGN–CNIG · CC BY 4.0 <span>·</span> COPC por Flai</footer>
    </aside>
  </main>
`

const latitudeInput = document.querySelector<HTMLInputElement>('#latitude')!
const longitudeInput = document.querySelector<HTMLInputElement>('#longitude')!
const radiusInput = document.querySelector<HTMLInputElement>('#radius')!
const radiusOutput = document.querySelector<HTMLOutputElement>('#radius-output')!
const statusCard = document.querySelector<HTMLDivElement>('#status-card')!
const statusTitle = document.querySelector<HTMLElement>('#status-title')!
const statusDetail = document.querySelector<HTMLElement>('#status-detail')!
const loadButton = document.querySelector<HTMLButtonElement>('#load-button')!
const datasetCard = document.querySelector<HTMLElement>('#dataset-card')!
const cloudSummary = document.querySelector<HTMLElement>('#cloud-summary')!

const initialCoordinate = [-2.6694763767013745, 40.43190101842764]
const marker = new Feature({ geometry: new Point(fromLonLat(initialCoordinate)) })
const markerSource = new VectorSource({ features: [marker] })
const map = new Map({
  target: 'map',
  controls: [],
  layers: [
    new TileLayer({
      source: new TileWMS({
        url: 'https://www.ign.es/wms-inspire/pnoa-ma',
        params: { LAYERS: 'OI.OrthoimageCoverage', TILED: true },
        crossOrigin: 'anonymous',
      }),
    }),
    new VectorLayer({
      source: markerSource,
      style: new Style({
        image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#d9ff5d' }), stroke: new Stroke({ color: '#111', width: 3 }) }),
      }),
    }),
  ],
  view: new View({ center: fromLonLat(initialCoordinate), zoom: 13 }),
})

export const viewer = new MapViewer(document.querySelector('#viewer')!)
document.querySelector('#fit-view')!.addEventListener('click', () => viewer.resetView())

function updateCoordinate(longitude: number, latitude: number, moveMap = true) {
  longitudeInput.value = longitude.toFixed(6)
  latitudeInput.value = latitude.toFixed(6)
  const coordinate = fromLonLat([longitude, latitude])
  marker.setGeometry(new Point(coordinate))
  if (moveMap) map.getView().animate({ center: coordinate, duration: 350 })
}

map.on('click', (event) => {
  const [longitude, latitude] = toLonLat(event.coordinate)
  updateCoordinate(longitude, latitude, false)
})

function setStatus(kind: 'idle' | 'loading' | 'success' | 'error', title: string, detail: string) {
  statusCard.className = `status-card ${kind}`
  statusTitle.textContent = title
  statusDetail.textContent = detail
}

radiusInput.addEventListener('input', () => (radiusOutput.value = `${radiusInput.value} m`))
document.querySelector<HTMLSelectElement>('#color-mode')!.addEventListener('change', (event) => {
  viewer.setColorMap((event.target as HTMLSelectElement).value as ColorMap)
})
document.querySelector<HTMLSelectElement>('#surface-mode')!.addEventListener('change', (event) => {
  viewer.setSurfaceMode((event.target as HTMLSelectElement).value as SurfaceMode)
})
latitudeInput.addEventListener('change', () => updateCoordinate(Number(longitudeInput.value), Number(latitudeInput.value)))
longitudeInput.addEventListener('change', () => updateCoordinate(Number(longitudeInput.value), Number(latitudeInput.value)))

document.querySelector<HTMLFormElement>('#search-form')!.addEventListener('submit', async (event) => {
  event.preventDefault()
  const latitude = Number(latitudeInput.value)
  const longitude = Number(longitudeInput.value)
  const radius = Number(radiusInput.value)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return

  loadButton.disabled = true
  loadButton.querySelector('span')!.textContent = 'Preparando…'
  viewer.clear()
  datasetCard.classList.add('hidden')

  try {
    const dataset = datasetForCoordinate(longitude, latitude)
    const center = projectCoordinate(dataset, longitude, latitude)
    setStatus('loading', 'Indexando la cobertura', `Consultando ${dataset.label} en ${dataset.epsg}…`)
    const catalog = await loadCatalog(dataset, (page, items) => {
      const message = page === 0 ? 'Índice recuperado de la caché local' : `Página ${page} · ${formatNumber.format(items)} ficheros encontrados`
      setStatus('loading', 'Indexando la cobertura', message)
    })

    const nearby = nearbyCatalogItems(catalog, center.x, center.y, radius)
    setStatus('loading', 'Localizando teselas', `${nearby.length} candidatas cerca de la coordenada`)
    const tiles = await inspectCandidates(nearby, center.x, center.y, radius)
    if (!tiles.length) throw new Error('No se ha encontrado cobertura LiDAR en esta coordenada.')

    setStatus('loading', 'Transmitiendo puntos', `0 nodos preparados · ${tiles.length} tesela${tiles.length === 1 ? '' : 's'}`)
    const cloud = await loadCloud(tiles, center.x, center.y, radius, 30_000_000, (done, total) => {
      setStatus('loading', 'Transmitiendo puntos', `${done} de ${total} nodos · decodificando LAZ`)
    })
    if (!cloud.pointCount) throw new Error('La consulta no devolvió puntos dentro del radio elegido.')

    setStatus('loading', 'Preparando niveles de detalle', 'Generando el mapa de elevaciones…')
    await viewer.showCloud(cloud, radius)
    document.querySelector('#dataset-name')!.textContent = dataset.label
    document.querySelector('#dataset-years')!.textContent = dataset.years
    document.querySelector('#dataset-density')!.textContent = dataset.density
    document.querySelector('#tile-count')!.textContent = String(tiles.length)
    document.querySelector('#point-count')!.textContent = formatNumber.format(cloud.pointCount)
    datasetCard.classList.remove('hidden')
    cloudSummary.textContent = `${formatNumber.format(cloud.pointCount)} puntos · ${radius} m · ${cloud.minElevation.toFixed(1)}–${cloud.maxElevation.toFixed(1)} m`
    const skipped = cloud.skippedNodes ? ` · ${cloud.skippedNodes} nodo${cloud.skippedNodes === 1 ? '' : 's'} remoto${cloud.skippedNodes === 1 ? '' : 's'} omitido${cloud.skippedNodes === 1 ? '' : 's'}` : ''
    setStatus('success', 'Mapa preparado', `${formatNumber.format(cloud.pointCount)} puntos procesados${skipped}`)
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : 'Error desconocido'
    setStatus('error', 'No se pudo cargar la zona', message)
    cloudSummary.textContent = 'Prueba otra coordenada o vuelve a intentarlo'
  } finally {
    loadButton.disabled = false
    loadButton.querySelector('span')!.textContent = 'Visualizar LiDAR'
  }
})
