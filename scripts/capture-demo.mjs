import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const executable = path.resolve(`release/PNOAExplorer-v${packageJson.version}-win-x64.exe`)
assert.ok(existsSync(executable), `No existe ${executable}; ejecuta npm run release:win primero.`)

const port = 4175
const server = spawn(executable, ['--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })

try {
  let response
  for (let attempt = 0; attempt < 40; attempt++) {
    try { response = await fetch(`http://127.0.0.1:${port}`); break } catch { await new Promise((resolve) => setTimeout(resolve, 250)) }
  }
  assert.equal(response?.status, 200, output || 'El servidor no respondió.')

  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Visualizar LiDAR' }).click()
    await page.locator('#status-title').filter({ hasText: /Mapa preparado|No se pudo cargar/ }).waitFor({ timeout: 180_000 })
    assert.equal(await page.locator('#status-title').textContent(), 'Mapa preparado')
    await page.locator('#layer-mode').selectOption('both')
    await page.locator('#lidar-opacity').fill('70')
    await page.waitForTimeout(4_000)
    await mkdir('docs', { recursive: true })
    await page.screenshot({ path: 'docs/demo.png', fullPage: true })
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
  console.log('Captura creada: docs/demo.png')
} finally {
  server.kill()
}
