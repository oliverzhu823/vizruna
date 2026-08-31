#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist', 'npm')
const sourceManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

rmSync(target, { recursive: true, force: true })
mkdirSync(join(target, 'bin'), { recursive: true })
mkdirSync(join(target, 'scripts'), { recursive: true })
mkdirSync(join(target, 'out'), { recursive: true })

for (const directory of ['node-web', 'renderer', 'main']) {
  cpSync(join(root, 'out', directory), join(target, 'out', directory), { recursive: true })
}
for (const file of ['vizruna.mjs', 'vizruna-node-web.mjs', 'patch-pi-sdk-dependencies.mjs']) {
  cpSync(join(root, 'scripts', file), join(target, 'scripts', file))
}
cpSync(join(root, 'scripts', 'vizruna.mjs'), join(target, 'bin', 'vizruna.mjs'))
for (const file of ['README.md', 'README.en.md', 'NOTICE.md', 'THIRD_PARTY_DEPENDENCIES.md']) {
  cpSync(join(root, file), join(target, file))
}
cpSync(join(root, 'THIRD_PARTY_LICENSES'), join(target, 'THIRD_PARTY_LICENSES'), { recursive: true })

const manifest = {
  name: 'vizruna',
  productName: 'Vizruna',
  version: sourceManifest.version,
  description: sourceManifest.description,
  type: 'module',
  license: sourceManifest.license,
  author: sourceManifest.author,
  repository: { type: 'git', url: 'git+https://github.com/oliverzhu823/vizruna.git' },
  homepage: 'https://github.com/oliverzhu823/vizruna#readme',
  bugs: 'https://github.com/oliverzhu823/vizruna/issues',
  publishConfig: { access: 'public', tag: 'alpha' },
  engines: { node: '>=22.19.0' },
  bin: { vizruna: 'bin/vizruna.mjs' },
  scripts: { postinstall: 'node scripts/patch-pi-sdk-dependencies.mjs' },
  dependencies: {
    '@earendil-works/pi-ai': '0.84.4',
    '@earendil-works/pi-coding-agent': '0.84.4',
    'better-sqlite3': sourceManifest.dependencies['better-sqlite3'],
    'brace-expansion': sourceManifest.dependencies['brace-expansion'],
    'node-pty': sourceManifest.dependencies['node-pty'],
    'protobufjs': sourceManifest.dependencies.protobufjs,
    'zod': sourceManifest.dependencies.zod,
  },
  overrides: sourceManifest.overrides,
  keywords: ['pi-agent', 'agent-harness', 'local-first', 'ai-agent', 'web-ui'],
}
writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[npm-package] prepared ${manifest.name}@${manifest.version} at ${target}`)
