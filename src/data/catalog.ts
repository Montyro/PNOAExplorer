import type { Dataset } from './datasets'

export type CatalogItem = {
  key: string
  size: number
  url: string
  hintX: number
  hintY: number
}

const BUCKET = 'https://open-lidar-data.s3.eu-central-1.amazonaws.com'
const tilePattern = /_(\d{3})-(\d{4})_/

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pnoa-lidar', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('catalogs')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCache(key: string): Promise<CatalogItem[] | undefined> {
  try {
    const db = await openDatabase()
    return await new Promise((resolve, reject) => {
      const request = db.transaction('catalogs').objectStore('catalogs').get(key)
      request.onsuccess = () => resolve(request.result as CatalogItem[] | undefined)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return undefined
  }
}

async function writeCache(key: string, value: CatalogItem[]) {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('catalogs', 'readwrite').objectStore('catalogs').put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // The viewer remains usable when private browsing blocks IndexedDB.
  }
}

export async function loadCatalog(
  dataset: Dataset,
  onProgress: (page: number, items: number) => void,
): Promise<CatalogItem[]> {
  const cached = await readCache(dataset.id)
  if (cached?.length) {
    onProgress(0, cached.length)
    return cached
  }

  const items: CatalogItem[] = []
  let token: string | undefined
  let page = 0

  do {
    const params = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000', prefix: dataset.prefix })
    if (token) params.set('continuation-token', token)
    const response = await fetch(`${BUCKET}/?${params}`)
    if (!response.ok) throw new Error(`No se pudo leer el catálogo (${response.status})`)
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
    for (const element of xml.querySelectorAll('Contents')) {
      const key = element.querySelector('Key')?.textContent ?? ''
      const match = key.match(tilePattern)
      if (!match || !key.endsWith('.copc.laz')) continue
      items.push({
        key,
        size: Number(element.querySelector('Size')?.textContent ?? 0),
        url: `${BUCKET}/${key}`,
        hintX: Number(match[1]) * 1000,
        hintY: Number(match[2]) * 1000,
      })
    }
    token = xml.querySelector('NextContinuationToken')?.textContent ?? undefined
    page += 1
    onProgress(page, items.length)
  } while (token)

  await writeCache(dataset.id, items)
  return items
}

export function nearbyCatalogItems(items: CatalogItem[], x: number, y: number, radius: number) {
  const margin = radius + 2500
  return items.filter((item) => Math.abs(item.hintX - x) <= margin && Math.abs(item.hintY - y) <= margin)
}

