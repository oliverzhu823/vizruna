import { safeStorage, BrowserWindow } from 'electron'

const STORE_KEY = 'codexAccessTokenEnc'
const GENERIC_PREFIX = 'encryptedSecret:'

let backing: { get: (k: string) => unknown; set: (k: string, v: unknown) => void; delete?: (k: string) => void } | null =
  null

export function bindSecretStoreBacking(store: {
  get: (k: string) => unknown
  set: (k: string, v: unknown) => void
  delete?: (k: string) => void
}): void {
  backing = store
}

export function isCodexTokenEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch (e) {
    return false
  }
}

export function setCodexAccessToken(token: string | null | undefined): void {
  if (!backing) return
  const t = token?.trim()
  if (!t || t.length < 20) {
    if (backing.delete) backing.delete(STORE_KEY)
    else backing.set(STORE_KEY, undefined)
    return
  }
  if (!isCodexTokenEncryptionAvailable()) {
    console.warn('[secret-store] safeStorage unavailable; codex token not persisted')
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('ipc:events', {
        type: 'warning',
        message: '系统加密不可用，Codex Token 未持久化。重启后需重新输入。',
      })
    }
    return
  }
  const enc = safeStorage.encryptString(t)
  backing.set(STORE_KEY, enc.toString('base64'))
}

export function getCodexAccessToken(): string | null {
  if (!backing) return null
  const raw = backing.get(STORE_KEY)
  if (raw == null || raw === '') return null
  if (!isCodexTokenEncryptionAvailable()) return null
  try {
    const buf = Buffer.from(String(raw), 'base64')
    const plain = safeStorage.decryptString(buf)
    return plain && plain.length >= 20 ? plain : null
  } catch (e) {
    return null
  }
}

function genericKey(id: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id)) {
    throw new Error('Invalid secret identifier')
  }
  return `${GENERIC_PREFIX}${id}`
}

export function setEncryptedSecret(id: string, value: string | null | undefined): boolean {
  if (!backing) return false
  const key = genericKey(id)
  if (value == null || value.length === 0) {
    if (backing.delete) backing.delete(key)
    else backing.set(key, undefined)
    return true
  }
  if (!isCodexTokenEncryptionAvailable()) return false
  backing.set(key, safeStorage.encryptString(value).toString('base64'))
  return true
}

export function getEncryptedSecret(id: string): string | null {
  if (!backing || !isCodexTokenEncryptionAvailable()) return null
  const raw = backing.get(genericKey(id))
  if (!raw) return null
  try {
    return safeStorage.decryptString(Buffer.from(String(raw), 'base64')) || null
  } catch {
    return null
  }
}

export function deleteEncryptedSecret(id: string): void {
  if (!backing) return
  const key = genericKey(id)
  if (backing.delete) backing.delete(key)
  else backing.set(key, undefined)
}
