type BrowserDownload = {
  filename: string
  mimeType: string
  base64: string
}

function isBrowserDownload(value: unknown): value is BrowserDownload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrowserDownload>
  return (
    typeof candidate.filename === 'string' &&
    candidate.filename.length > 0 &&
    typeof candidate.mimeType === 'string' &&
    candidate.mimeType.length > 0 &&
    typeof candidate.base64 === 'string' &&
    candidate.base64.length > 0
  )
}

export function saveBrowserDownload(value: unknown): boolean {
  if (!isBrowserDownload(value)) return false
  const binary = window.atob(value.base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  const url = URL.createObjectURL(new Blob([bytes], { type: value.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = value.filename.replace(/[\\/]/g, '-')
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
