import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function resolvePackageRoot(packageName) {
  // Pi only exports an ESM entry point. `require.resolve()` selects the
  // CommonJS condition and therefore fails in a clean npm installation even
  // though the package is installed correctly. Resolve through the ESM import
  // condition, then walk back to the owning package manifest.
  let current = dirname(fileURLToPath(import.meta.resolve(packageName)))
  for (;;) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === packageName) return current
    }
    const parent = dirname(current)
    if (parent === current) throw new Error(`Unable to locate package root: ${packageName}`)
    current = parent
  }
}

const piSdkRoot = resolvePackageRoot('@earendil-works/pi-coding-agent')

const patches = [
  { packageName: 'brace-expansion', expectedVersion: '5.0.9' },
  { packageName: 'protobufjs', expectedVersion: '7.6.5' },
]

function readPackageVersion(packageRoot) {
  const manifestPath = join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) return null
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? null
}

if (!existsSync(join(piSdkRoot, 'package.json'))) {
  console.error(`[patch-pi-sdk] Pi SDK is not installed at ${piSdkRoot}`)
  process.exit(1)
}

for (const patch of patches) {
  const sourceRoot = resolvePackageRoot(patch.packageName)
  const targetRoot = join(piSdkRoot, 'node_modules', patch.packageName)
  const sourceVersion = readPackageVersion(sourceRoot)

  if (sourceVersion !== patch.expectedVersion) {
    console.error(
      `[patch-pi-sdk] expected ${patch.packageName}@${patch.expectedVersion}, found ${sourceVersion ?? 'missing'}`,
    )
    process.exit(1)
  }

  if (readPackageVersion(targetRoot) !== patch.expectedVersion) {
    rmSync(targetRoot, { recursive: true, force: true })
    cpSync(sourceRoot, targetRoot, { recursive: true })
  }

  const installedVersion = readPackageVersion(targetRoot)
  if (installedVersion !== patch.expectedVersion) {
    console.error(
      `[patch-pi-sdk] failed to install ${patch.packageName}@${patch.expectedVersion}; found ${installedVersion ?? 'missing'}`,
    )
    process.exit(1)
  }

  console.log(`[patch-pi-sdk] verified ${patch.packageName}@${installedVersion}`)
}
