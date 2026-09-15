import { describe, expect, it } from 'vitest'
import { datasetForCoordinate, projectCoordinate } from './datasets'
import { nearbyCatalogItems, type CatalogItem } from './catalog'

describe('selección de cobertura PNOA', () => {
  it('elige el huso 30 y proyecta la coordenada de referencia correctamente', () => {
    const dataset = datasetForCoordinate(-2.6694763767013745, 40.43190101842764)
    const point = projectCoordinate(dataset, -2.6694763767013745, 40.43190101842764)
    expect(dataset.epsg).toBe('EPSG:25830')
    expect(point.x).toBeCloseTo(528035, -2)
    expect(point.y).toBeCloseTo(4475748, -2)
  })

  it('selecciona los sistemas de Galicia, Cataluña y Canarias', () => {
    expect(datasetForCoordinate(-8.54, 42.88).epsg).toBe('EPSG:25829')
    expect(datasetForCoordinate(2.17, 41.38).epsg).toBe('EPSG:25831')
    expect(datasetForCoordinate(-15.43, 28.12).epsg).toBe('EPSG:4083')
  })
})

describe('prefiltro del catálogo', () => {
  it('conserva las teselas próximas y descarta las lejanas', () => {
    const item = (hintX: number, hintY: number): CatalogItem => ({ key: '', size: 1, url: '', hintX, hintY })
    const result = nearbyCatalogItems(
      [item(440000, 4475000), item(441000, 4475000), item(700000, 4800000)],
      440291,
      4474255,
      400,
    )
    expect(result).toHaveLength(2)
  })
})
