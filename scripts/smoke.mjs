import { chromium } from 'playwright-core'

const executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle', timeout: 30_000 })
  await page.locator('h1').waitFor({ state: 'visible' })
  await page.screenshot({ path: 'artifacts/initial.png', fullPage: true })
  await page.getByRole('button', { name: 'Visualizar LiDAR' }).click()
  await page.locator('#status-title').filter({ hasText: /Mapa preparado|No se pudo cargar/ }).waitFor({ timeout: 180_000 })
  const checksum = () => page.locator('#viewer canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let value = 0
    for (let index = 0; index < pixels.length; index += 997) value = (value + pixels[index] * (index + 1)) % 2147483647
    return value
  })
  const terrainChecksum = await checksum()
  await page.locator('#color-mode').selectOption('viridis')
  await page.waitForFunction(() => document.querySelector('#viewer').dataset.rendering === 'ready')
  const viridisChecksum = await checksum()
  await page.locator('#surface-mode').selectOption('ground')
  await page.waitForFunction(() => document.querySelector('#viewer').dataset.rendering === 'ready')
  const groundChecksum = await checksum()
  await page.screenshot({ path: 'artifacts/loaded.png', fullPage: true })
  const report = await page.evaluate(() => ({
    status: document.querySelector('#status-title')?.textContent,
    detail: document.querySelector('#status-detail')?.textContent,
    summary: document.querySelector('#cloud-summary')?.textContent,
    points: document.querySelector('#point-count')?.textContent,
    tiles: document.querySelector('#tile-count')?.textContent,
    canvas: document.querySelectorAll('#viewer canvas').length,
  }))
  const interactions = {
    colormapChanged: terrainChecksum !== viridisChecksum,
    groundModelChanged: viridisChecksum !== groundChecksum,
  }
  console.log(JSON.stringify({ report, interactions, errors }, null, 2))
  if (report.status !== 'Mapa preparado' || !interactions.colormapChanged || !interactions.groundModelChanged || errors.length) process.exitCode = 1
} finally {
  await browser.close()
}
