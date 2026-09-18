import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const executable = path.resolve(`release/PNOAExplorer-v${packageJson.version}-win-x64.exe`)
assert.ok(existsSync(executable), `No existe ${executable}; ejecuta npm run release:win primero.`)

const port = 4174
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
  assert.match(await response.text(), /PNOA Explorer/)

  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
    await page.locator('h1').waitFor()
    assert.equal(await page.title(), 'PNOA Explorer · Mapa de elevación 2D')
    assert.equal(await page.getByRole('button', { name: 'New spot' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Visualizar LiDAR' }).click()
    await page.locator('#status-title').filter({ hasText: /Mapa preparado|No se pudo cargar/ }).waitFor({ timeout: 180_000 })
    assert.equal(await page.locator('#status-title').textContent(), 'Mapa preparado')
    assert.notEqual(await page.locator('#point-count').textContent(), '—')
    assert.equal(await page.locator('#dataset-years').textContent(), '2022–2025')
    assert.equal(await page.getByRole('button', { name: 'New spot' }).isEnabled(), true)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ executable, url: `http://127.0.0.1:${port}`, status: 'ok' }, null, 2))
} finally {
  server.kill()
}
