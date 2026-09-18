import { embeddedAssets } from './.release-assets'

declare const RELEASE_VERSION: string

function option(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv.includes('--version')) {
  console.log(RELEASE_VERSION)
  process.exit(0)
}

const port = Number(option('--port') ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('El puerto debe ser un número entre 1 y 65535.')
  process.exit(1)
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const embeddedPath = embeddedAssets.get(pathname)
    if (!embeddedPath) return new Response('No encontrado', { status: 404 })

    const headers = new Headers()
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    if (pathname === '/index.html') headers.set('Cache-Control', 'no-cache')
    else headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    return new Response(Bun.file(embeddedPath), { headers })
  },
})

console.log(`PNOA Explorer v${RELEASE_VERSION}`)
console.log(`Servidor activo en http://${server.hostname}:${server.port}`)
console.log('Mantén esta ventana abierta. Pulsa Ctrl+C para detenerlo.')
