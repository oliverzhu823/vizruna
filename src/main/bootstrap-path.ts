import fixPath from 'fix-path'
import { shellEnvSync } from 'shell-env'
import { app } from 'electron'
import {
  PI_CODING_AGENT_DIRECTORY_ENV,
  VIZRUNA_RUNTIME_CHANNEL_ENV,
  resolveRuntimeIdentity,
} from './runtime-identity'
import { mergeLoginShellEnvironment } from './login-shell-environment'
import {
  VIZRUNA_APPLICATION_ROOT_ENV,
  VIZRUNA_USER_DATA_ENV,
} from '../runtime/runtime-paths'

const isE2E =
  process.env.PI_E2E === '1' || process.env.PI_E2E === 'true'

export const runtimeIdentity = resolveRuntimeIdentity({
  isPackaged: app.isPackaged,
  isE2E,
  appDataPath: app.getPath('appData'),
  tempPath: app.getPath('temp'),
  pid: process.pid,
  explicitUserData: process.env.PI_E2E_USER_DATA,
  explicitPiAgentDirectory: process.env[PI_CODING_AGENT_DIRECTORY_ENV],
  isWeb: process.env.VIZRUNA_WEB_RUNTIME === '1',
})

app.setName(runtimeIdentity.appName)
app.setPath('userData', runtimeIdentity.userDataPath)
process.env[VIZRUNA_USER_DATA_ENV] = runtimeIdentity.userDataPath
process.env[VIZRUNA_APPLICATION_ROOT_ENV] = app.getAppPath()
process.env[VIZRUNA_RUNTIME_CHANNEL_ENV] = runtimeIdentity.channel
if (runtimeIdentity.piAgentDirectory) {
  process.env[PI_CODING_AGENT_DIRECTORY_ENV] =
    runtimeIdentity.piAgentDirectory
}

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
