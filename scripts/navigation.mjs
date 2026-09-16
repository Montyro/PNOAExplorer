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
      await viewer.showCloud({positions:new Float32Array(points),elevations:new Float32Array(elevations),classifications:new Uint8Array(classes),rgb:new Uint8Array(classes.length*3),pointCount:classes.length,minElevation:600,maxElevation:800,skippedNodes:0},200,{epsg:'EPSG:25830',centerX:527986.5,centerY:4475913.2})
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
    const anchorError = Math.hypot(after[0]-before[0],after[1]-before[1])
    assert.ok(anchorError < .2, `wheel must preserve ground position under cursor (${anchorError} m)`)
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
    const expectedSpot = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.getCenterLonLat())
    await page.evaluate(() => {
      window.__newSpotRequests = 0
      document.querySelector('#search-form').requestSubmit = () => { window.__newSpotRequests++ }
      document.querySelector('#new-spot').disabled = false
    })
    await page.getByRole('button',{name:'New spot'}).click()
    const selectedSpot = await page.evaluate(() => ({
      longitude: Number(document.querySelector('#longitude').value),
      latitude: Number(document.querySelector('#latitude').value),
      requests: window.__newSpotRequests,
    }))
    assert.ok(Math.abs(selectedSpot.longitude-expectedSpot[0]) < 1e-6 && Math.abs(selectedSpot.latitude-expectedSpot[1]) < 1e-6, 'New spot must use the visible map center')
    assert.equal(selectedSpot.requests,1)
    await page.locator('#color-mode').selectOption('detail-global'); await ready()
    const globalDetail = (await state()).range
    assert.equal(await page.locator('#detail-range').isVisible(),false)
    await page.locator('#color-mode').selectOption('detail-local'); await ready()
    assert.deepEqual((await state()).range,panned.range)
    await page.locator('#color-mode').selectOption('detail-manual'); await ready()
    assert.equal(await page.locator('#detail-range').isVisible(),true)
    await page.locator('#detail-min').fill('750')
    await page.locator('#detail-max').fill('1100')
    await page.getByRole('button',{name:'Aplicar rango'}).click(); await ready()
    assert.deepEqual((await state()).range,[750,1100])
    assert.equal(await page.locator('#legend-min').textContent(),'750.00 m')
    assert.equal(await page.locator('#legend-max').textContent(),'1100.00 m')
    await page.locator('#detail-max').fill('700')
    await page.getByRole('button',{name:'Aplicar rango'}).click()
    assert.equal(await page.locator('#detail-max').evaluate(el=>el.checkValidity()),false)
    assert.deepEqual((await state()).range,[750,1100])
    await page.locator('#color-mode').selectOption('viridis'); await ready()
    assert.equal(await page.locator('#detail-range').isVisible(),false)
    await page.locator('#color-mode').selectOption('detail-manual'); await ready()
    assert.deepEqual((await state()).range,[750,1100])
    await page.getByRole('button',{name:'Rango completo'}).click(); await ready()
    assert.deepEqual((await state()).range,globalDetail)
    const centerBeforeLayers = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.map.getView().getCenter())
    await page.locator('#layer-mode').selectOption('both')
    assert.equal(await page.locator('#lidar-opacity-control').isVisible(),true)
    await page.locator('#lidar-opacity').fill('40')
    const bothState = await page.evaluate(async()=> {
      const layers=(await import('/src/main.ts')).viewer.map.getLayers().getArray()
      return {ortho:layers[0].getVisible(),lidar:layers[1].getVisible(),opacity:layers[1].getOpacity()}
    })
    assert.deepEqual(bothState,{ortho:true,lidar:true,opacity:.4})
    await page.locator('#layer-mode').selectOption('orthophoto')
    assert.equal(await page.locator('#elevation-legend').isVisible(),false)
    const orthoState = await page.evaluate(async()=> {
      const viewer=(await import('/src/main.ts')).viewer
      const layers=viewer.map.getLayers().getArray()
      return {ortho:layers[0].getVisible(),lidar:layers[1].getVisible(),center:viewer.map.getView().getCenter()}
    })
    assert.equal(orthoState.ortho,true); assert.equal(orthoState.lidar,false)
    assert.deepEqual(orthoState.center,centerBeforeLayers)
    await page.locator('#layer-mode').selectOption('lidar'); await ready()
    assert.equal(await page.locator('#elevation-legend').isVisible(),true)
    await page.locator('#color-mode').selectOption('viridis'); await ready()
    const resolutionBefore = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.map.getView().getResolution())
    await page.mouse.dblclick(460,400); await page.waitForTimeout(500); await ready()
    const resolutionAfter = await page.evaluate(async()=> (await import('/src/main.ts')).viewer.map.getView().getResolution())
    assert.ok(resolutionAfter < resolutionBefore, 'double click zooms in')
    await page.getByRole('button',{name:'Encuadrar zona'}).click(); await ready()
    const reset = await state()
    assert.ok(reset.extent[0] <= -200 && reset.extent[1] <= -200 && reset.extent[2] >= 200 && reset.extent[3] >= 200, 'fit must contain the downloaded area')
    await page.setViewportSize({width:1200,height:820}); await page.waitForTimeout(300); await ready()
    await page.screenshot({path:`artifacts/navigation-dpr${dpr}.png`})
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({dpr,anchorError,initial,zoomed,panned,errors}))
    await page.close()
  }
} finally { await browser.close() }
