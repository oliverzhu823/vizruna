import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const piSdkRoot = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')

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
  const sourceRoot = join(root, 'node_modules', patch.packageName)
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
