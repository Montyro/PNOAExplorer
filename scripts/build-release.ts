import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const dist = path.join(root, 'dist')
const release = path.join(root, 'release')
const generatedManifest = path.join(import.meta.dir, '.release-assets.ts')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string }
const artifactName = `PNOAExplorer-v${packageJson.version}-win-x64.exe`
const artifact = path.join(release, artifactName)

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(absolute) : [absolute]
  }))
  return files.flat().sort()
}

const files = await filesBelow(dist)
const imports = files.map((file, index) => {
  const relative = path.relative(import.meta.dir, file).replaceAll('\\', '/')
  return `import asset${index} from ${JSON.stringify(relative.startsWith('.') ? relative : `./${relative}`)} with { type: 'file' }`
})
const routes = files.map((file, index) => {
  const route = `/${path.relative(dist, file).replaceAll('\\', '/')}`
  return `  [${JSON.stringify(route)}, asset${index}],`
})
await writeFile(generatedManifest, `${imports.join('\n')}\n\nexport const embeddedAssets = new Map<string, string>([\n${routes.join('\n')}\n])\n`)

await rm(release, { recursive: true, force: true })
await mkdir(release, { recursive: true })
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, 'release-server.ts')],
  compile: { outfile: artifact },
  define: { RELEASE_VERSION: JSON.stringify(packageJson.version) },
  minify: true,
  naming: { asset: '[name].[ext]' },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const hash = createHash('sha256')
for await (const chunk of createReadStream(artifact)) hash.update(chunk)
await writeFile(path.join(release, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${artifactName}\n`)
console.log(`Release creada: ${artifact}`)
