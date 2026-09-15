import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: {width: 1440,height: 1000}, deviceScaleFactor: dpr })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('requestfailed', r => console.error(r.url(), r.failure()))
    page.on('console', m => { if (m.type() === 'error') console.error(m.text()) })
    await page.goto('http://127.0.0.1:5173', {waitUntil: 'domcontentloaded'})
    await page.locator('#fit-view').waitFor()
    await page.evaluate(async () => {
      const {viewer} = await import('/src/main.ts')
      const points = [], elevations = [], classes = []
      // Real metric heights on a synthetic slope with small ridges; no network dependency.
      for (let y = -200; y < 200; y += .5) for (let x = -200; x < 200; x += .5) {
        const z = 700 + x*.15 + y*.3 + Math.sin(x*2)*.2
        points.push(x,z,y); elevations.push(z); classes.push(2)
      }
      await viewer.showCloud({positions:new Float32Array(points),elevations:new Float32Array(elevations),classifications:new Uint8Array(classes),rgb:new Uint8Array(classes.length*3),pointCount:classes.length,minElevation:600,maxElevation:800,skippedNodes:0},200)
    })
    const ready = () => page.waitForFunction(() => document.querySelector('#viewer').dataset.rendering === 'ready')
    const state = () => page.locator('#viewer').evaluate(el => ({ lod: +el.dataset.lod, range: JSON.parse(el.dataset.range), extent:JSON.parse(el.dataset.extent) }))
    const coordinate = (pixel) => page.evaluate(async (pixel) => { const {viewer}=await import('/src/main.ts'); return viewer.map.getCoordinateFromPixel(pixel) },pixel)
    const fitted = await state()
    await page.evaluate(async () => (await import('/src/main.ts')).viewer.map.getView().setResolution(2))
    await page.waitForTimeout(300); await ready()
    const initial = await state()
    // Zoom at a point far from the center to detect the original anchoring bug.
    const pixel = [440,460]
    const before = await coordinate(pixel)
    await page.mouse.move(...pixel)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0,-480)
      await page.waitForTimeout(650)
      await ready()
    }
    const after = await coordinate(pixel)
    assert.ok(Math.hypot(after[0]-before[0],after[1]-before[1]) < .001, 'wheel must preserve ground position under cursor')
    const zoomed = await state()
    assert.ok(zoomed.lod < initial.lod, 'zoom should select finer LOD')
    assert.ok(zoomed.range[1]-zoomed.range[0] < initial.range[1]-initial.range[0], 'visible contrast must narrow on zoom')
    const start = [510,500], finish = [570,540]
    await page.mouse.move(...start); await page.mouse.down()
    await page.mouse.move(start[0]+4,start[1]+4,{steps:4})
    const world = await coordinate([start[0]+4,start[1]+4])
    await page.mouse.move(...finish,{steps:8})
    // Hold before release so the test measures direct pan rather than kinetic continuation.
    await page.waitForTimeout(160); await page.mouse.up(); await page.waitForTimeout(450); await ready()
    const moved = await coordinate(finish)
    assert.ok(Math.hypot(world[0]-moved[0],world[1]-moved[1]) < 1, 'drag should follow pointer')
    const panned = await state()
    assert.notDeepEqual(panned.range, zoomed.range, 'panning must update visible normalization')
    await page.locator('#color-mode').selectOption('viridis'); await ready()
    const resolutionBefore = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.map.getView().getResolution())
    await page.mouse.dblclick(460,400); await page.waitForTimeout(500); await ready()
    const resolutionAfter = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.map.getView().getResolution())
    assert.ok(resolutionAfter < resolutionBefore, 'double click zooms in')
    await page.getByRole('button',{name:'Encuadrar zona'}).click(); await ready()
    const reset = await state()
    assert.ok(Math.abs(reset.extent[0]-fitted.extent[0]) < .01, 'fit restores extent')
    await page.setViewportSize({width:1200,height:820}); await page.waitForTimeout(300); await ready()
    await page.screenshot({path:`artifacts/navigation-dpr${dpr}.png`})
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({dpr,anchorError:Math.hypot(after[0]-before[0],after[1]-before[1]),initial,zoomed,panned,errors}))
    await page.close()
  }
} finally { await browser.close() }
