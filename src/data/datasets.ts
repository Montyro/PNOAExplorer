import proj4 from 'proj4'
import { register } from 'ol/proj/proj4.js'

export type Dataset = {
  id: string
  label: string
  epsg: string
  density: string
  years: string
  prefix: string
}

const ROOT = 'data/ES/CNIG'

const datasets: Record<string, Dataset> = {
  'EPSG:25829': {
    id: 'pnoa2-25829',
    label: 'PNOA LiDAR · 2.ª cobertura',
    epsg: 'EPSG:25829',
    density: '0,5–4 ptos/m² según zona',
    years: '2015–2021',
    prefix: `${ROOT}/Lidar_2015-2021_epsg25829/copc/`,
  },
  'EPSG:25830': {
    id: 'pnoa2-25830',
    label: 'PNOA LiDAR · 2.ª cobertura',
    epsg: 'EPSG:25830',
    density: '0,5–4 ptos/m² según zona',
    years: '2015–2021',
    prefix: `${ROOT}/Lidar_2015-2021_epsg25830/copc/`,
  },
  'EPSG:25831': {
    id: 'pnoa2-25831',
    label: 'PNOA LiDAR · 2.ª cobertura',
    epsg: 'EPSG:25831',
    density: '0,5–4 ptos/m² según zona',
    years: '2015–2021',
    prefix: `${ROOT}/Lidar_2015-2021_epsg25831/copc/`,
  },
  'EPSG:4083': {
    id: 'pnoa3-4083',
    label: 'PNOA LiDAR · 3.ª cobertura',
    epsg: 'EPSG:4083',
    density: '5 ptos/m² o más',
    years: '2022–2025',
    prefix: `${ROOT}/Lidar_2022-2025_epsg4083/copc/`,
  },
}

proj4.defs('EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +units=m +no_defs +type=crs')
proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs +type=crs')
proj4.defs('EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +units=m +no_defs +type=crs')
proj4.defs('EPSG:4083', '+proj=utm +zone=28 +ellps=GRS80 +units=m +no_defs +type=crs')
register(proj4)

export function datasetForCoordinate(longitude: number, latitude: number): Dataset {
  if (latitude < 30) return datasets['EPSG:4083']
  if (longitude < -6) return datasets['EPSG:25829']
  if (longitude < 0) return datasets['EPSG:25830']
  return datasets['EPSG:25831']
}

export function projectCoordinate(dataset: Dataset, longitude: number, latitude: number) {
  const [x, y] = proj4('EPSG:4326', dataset.epsg, [longitude, latitude])
  return { x, y }
}
