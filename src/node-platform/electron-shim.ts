import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fork, spawn } from 'node:child_process'
import { join } from 'node:path'
import { getRuntimeApplicationRoot, getRuntimeHomePath, getRuntimeTempPath, getRuntimeUserDataPath, getRuntimeVersion } from '../runtime/runtime-paths'

const pathOverrides = new Map<string, string>()
const appEvents = new EventEmitter()
let lockPath: string | null = null

function appPath(name: string): string {
  if (pathOverrides.has(name)) return pathOverrides.get(name)!
  if (name === 'userData' || name === 'appData') return getRuntimeUserDataPath()
  if (name === 'home') return getRuntimeHomePath()
  if (name === 'temp') return getRuntimeTempPath()
  if (name === 'downloads') return join(getRuntimeHomePath(), 'Downloads')
  if (name === 'documents') return join(getRuntimeHomePath(), 'Documents')
  return getRuntimeUserDataPath()
}

export const app = Object.assign(appEvents, {
  isPackaged: false,
  getAppPath: () => getRuntimeApplicationRoot(),
  getPath: appPath,
  setPath: (name: string, value: string) => pathOverrides.set(name, value),
  getVersion: () => getRuntimeVersion(),
  getName: () => 'Vizruna',
  setName: () => undefined,
  setAppUserModelId: () => undefined,
  getLocale: () => process.env.LANG?.split(/[_.]/)[0] || 'en',
  whenReady: async () => undefined,
  requestSingleInstanceLock: () => {
    mkdirSync(getRuntimeUserDataPath(), { recursive: true, mode: 0o700 })
    const target = join(getRuntimeUserDataPath(), 'vizruna-node-web.lock')
    try {
      const descriptor = openSync(target, 'wx', 0o600)
      writeFileSync(descriptor, String(process.pid))
      lockPath = target
      return true
    } catch {
      try {
        const pid = Number(readFileSync(target, 'utf8'))
        process.kill(pid, 0)
        return false
      } catch {
        try { unlinkSync(target) } catch { /* race */ }
        return app.requestSingleInstanceLock()
      }
    }
  },
  releaseSingleInstanceLock: () => {
    if (lockPath) try { unlinkSync(lockPath) } catch { /* already removed */ }
    lockPath = null
  },
  focus: () => undefined,
  quit: () => appEvents.emit('before-quit', { preventDefault: () => undefined }),
  exit: (code = 0) => { app.releaseSingleInstanceLock(); process.exit(code) },
})

function openWithSystem(target: string): Promise<void> {
  const [command, args] = process.platform === 'darwin'
    ? ['open', [target]]
    : process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', 'start', '', target]]
      : ['xdg-open', [target]]
  return new Promise((resolveOpen, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolveOpen() })
  })
}

export const shell = {
  openExternal: (url: string) => openWithSystem(url),
  openPath: async (path: string) => { try { await openWithSystem(path); return '' } catch (error) { return String(error) } },
  showItemInFolder: (path: string) => void openWithSystem(process.platform === 'darwin' ? `file://${path}` : path),
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] { return [] }
  static getFocusedWindow(): BrowserWindow | undefined { return undefined }
  isDestroyed(): boolean { return false }
  webContents = { send: () => undefined }
}

export class Notification {
  static isSupported(): boolean { return false }
  constructor(_options?: unknown) {}
  show(): void {}
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined as string | undefined }),
  showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
  showErrorBox: (_title: string, message: string) => console.error(message),
}

function encryptionKey(): Buffer {
  const directory = getRuntimeUserDataPath()
  const path = join(directory, '.node-web-encryption-key')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(32), { mode: 0o600 })
    try { chmodSync(path, 0o600) } catch { /* Windows */ }
  }
  return readFileSync(path)
}

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string): Buffer => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([Buffer.from('VZN1'), iv, cipher.getAuthTag(), body])
  },
  decryptString: (value: Buffer): string => {
    if (value.subarray(0, 4).toString() !== 'VZN1') throw new Error('Unsupported encrypted value')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(4, 16))
    decipher.setAuthTag(value.subarray(16, 32))
    return Buffer.concat([decipher.update(value.subarray(32)), decipher.final()]).toString('utf8')
  },
}

export const ipcMain = {
  handle: () => undefined,
  removeHandler: () => undefined,
  on: () => undefined,
}

export const utilityProcess = {
  fork: (modulePath: string, args: string[] = [], options?: { stdio?: string }) => {
    const child = fork(modulePath, args, {
      cwd: getRuntimeApplicationRoot(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: options?.stdio === 'pipe' ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    return Object.assign(child, {
      postMessage: (message: unknown) => child.send(message),
    })
  },
}

export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) }
export const session = { defaultSession: { webRequest: { onHeadersReceived: () => undefined } } }
export const Menu = { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) }

export default {
  app, shell, BrowserWindow, Notification, dialog, safeStorage,
  ipcMain, utilityProcess, nativeImage, session, Menu,
}
