import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

describe('Vizruna product identity', () => {
  it('uses a private package identity separate from upstream pi Desktop', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.equal(pkg.name, 'vizruna')
    assert.equal(pkg.productName, 'Vizruna')
    assert.equal(pkg.private, true)
    assert.equal(pkg.license, 'UNLICENSED')
    assert.equal(pkg.engines.node, '>=22.19.0 <23')
  })

  it('uses a distinct application id and package display name', () => {
    const builder = read('electron-builder.yml')
    assert.match(builder, /^appId: com\.vizruna\.desktop$/m)
    assert.match(builder, /^productName: Vizruna$/m)
  })

  it('sets a dedicated userData directory before Main services initialize', () => {
    const bootstrap = read('src/main/bootstrap-path.ts')
    const runtime = read('src/main/runtime-identity.ts')
    assert.match(bootstrap, /app\.setName\(runtimeIdentity\.appName\)/)
    assert.match(bootstrap, /app\.setPath\('userData'/)
    assert.match(bootstrap, /PI_CODING_AGENT_DIRECTORY_ENV/)
    assert.match(runtime, /PRODUCT_DEVELOPMENT_USER_DATA_DIRECTORY/)
    assert.match(runtime, /join\(userDataPath, 'pi-agent'\)/)
    assert.match(runtime, /isDevelopment \|\| options\.isE2E/)
  })

  it('keeps development and packaged identities visibly distinct', () => {
    const identity = read('packages/shared/product-identity.ts')
    const index = read('src/main/index.ts')
    assert.match(identity, /PRODUCT_DEVELOPMENT_NAME = 'Vizruna Dev'/)
    assert.match(
      identity,
      /PRODUCT_DEVELOPMENT_APP_ID = 'com\.vizruna\.desktop\.dev'/,
    )
    assert.match(index, /app\.dock\.setBadge\('DEV'\)/)
  })

  it('uses versioned product-local renderer persistence', () => {
    const identity = read('packages/shared/product-identity.ts')
    const store = read('src/renderer/src/stores/ui-store.ts')
    const html = read('src/renderer/index.html')
    assert.match(
      identity,
      /PRODUCT_UI_STORAGE_KEY = `\$\{PRODUCT_PACKAGE_NAME\}-ui:v1`/,
    )
    assert.match(store, /name: PRODUCT_UI_STORAGE_KEY/)
    assert.match(html, /vizruna-ui:v1/)
    assert.doesNotMatch(store, /name: 'pi-desktop-ui'/)
  })

  it('uses the Vizruna repository as its update source with an environment override', () => {
    const identity = read('packages/shared/product-identity.ts')
    const updateCheck = read('src/main/github-release-check.ts')
    const settings = read('src/main/ipc/handlers/settings.ts')
    assert.match(identity, /PRODUCT_UPDATE_REPOSITORY = 'oliverzhu823\/vizruna'/)
    assert.match(updateCheck, /PRODUCT_UPDATE_REPOSITORY_ENV/)
    assert.match(updateCheck, /PRODUCT_UPDATE_REPOSITORY/)
    assert.match(settings, /PRODUCT_UPDATE_REPOSITORY_ENV/)
    assert.match(settings, /PRODUCT_UPDATE_REPOSITORY/)
    assert.doesNotMatch(updateCheck, /const DEFAULT_REPO = 'justhil\/pi-app'/)
    assert.doesNotMatch(settings, /\|\| 'justhil\/pi-app'/)
  })

  it('keeps product planning and compliance evidence versioned', () => {
    const ignore = read('.gitignore')
    const notice = read('NOTICE.md')
    assert.match(ignore, /!docs\/startup\//)
    assert.match(notice, /bcef920e3900a858b305c67c42a34e61779f977c/)
    assert.match(notice, /Commercial distribution remains blocked/)
  })
})
