import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBrowserDownload } from '../browser-download'

describe('saveBrowserDownload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('rejects incomplete payloads', () => {
    expect(saveBrowserDownload(null)).toBe(false)
    expect(saveBrowserDownload({ filename: 'x', mimeType: 'text/plain' })).toBe(false)
  })

  it('creates a local browser download and sanitizes path separators', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vizruna-test')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    expect(saveBrowserDownload({
      filename: 'folder/audit.json',
      mimeType: 'application/json',
      base64: window.btoa('hello'),
    })).toBe(true)

    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    expect(blob.size).toBe(5)
    expect(click).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vizruna-test')
  })
})
