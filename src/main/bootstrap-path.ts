import fixPath from 'fix-path'
import { shellEnvSync } from 'shell-env'
import { app } from 'electron'
import { join } from 'node:path'
import {
  PRODUCT_NAME,
  PRODUCT_USER_DATA_DIRECTORY,
} from '@shared/product-identity'
import { mergeLoginShellEnvironment } from './login-shell-environment'

app.setName(PRODUCT_NAME)
const e2eUserData =
  process.env.PI_E2E === '1' || process.env.PI_E2E === 'true'
    ? join(app.getPath('temp'), `${PRODUCT_USER_DATA_DIRECTORY}-e2e-${process.pid}`)
    : null
const productUserDataPath =
  process.env.PI_E2E_USER_DATA ||
  e2eUserData ||
  join(app.getPath('appData'), PRODUCT_USER_DATA_DIRECTORY)
app.setPath('userData', productUserDataPath)

if (process.platform === 'darwin') {
  try {
    const mergedEnvironment = mergeLoginShellEnvironment({
      launchEnvironment: { ...process.env },
      loginShellEnvironment: shellEnvSync(),
      pathDelimiter: ':',
    })

    for (const [variableName, variableValue] of Object.entries(mergedEnvironment)) {
      if (typeof variableValue === 'string') process.env[variableName] = variableValue
    }
  } catch {
    console.warn('[bootstrap] Unable to load the macOS login shell environment')
  }
} else {
  fixPath()
}
