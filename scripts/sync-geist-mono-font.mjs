import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'src', 'renderer', 'public', 'fonts', 'geist-mono')
const requiredFiles = ['GeistMono-Regular.woff2', 'OFL.txt']
const missingFiles = requiredFiles.filter((file) => !existsSync(join(destDir, file)))

if (missingFiles.length > 0) {
  console.error(
    `[sync-geist-mono] missing bundled font assets: ${missingFiles.join(', ')} in ${destDir}`,
  )
  process.exit(1)
}

console.log('[sync-geist-mono] bundled font assets verified:', requiredFiles.join(', '))
