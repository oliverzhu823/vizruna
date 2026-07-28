import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  openReviewSessionForPath,
  openWorkspaceRelativePath,
  resolveSystemFilePath,
  resolveWorkspaceRelativePath,
} from './open-workspace-path'

describe('workspace file opening boundaries', () => {
  beforeEach(() => {
    useUIStore.setState({
      currentWorkspace: '/workspace',
      activePanel: 'review',
      rightPanelCollapsed: true,
      workspaceFileOpenRequest: null,
      reviewFileOpenRequest: null,
    })
  })

  it('previews files inside the current workspace', () => {
    expect(openWorkspaceRelativePath('/workspace/report.md')).toBe(true)
    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'files',
      rightPanelCollapsed: false,
      workspaceFileOpenRequest: { rel: 'report.md' },
    })
  })

  it('keeps outside absolute artifacts out of the renderer preview boundary', () => {
    expect(resolveWorkspaceRelativePath('/private/tmp/report.md', '/workspace')).toBeNull()
    expect(openWorkspaceRelativePath('/private/tmp/report.md')).toBe(false)
    expect(useUIStore.getState().workspaceFileOpenRequest).toBeNull()
    expect(resolveSystemFilePath('/private/tmp/report.md', '/workspace')).toBe(
      '/private/tmp/report.md',
    )
  })

  it('persists an outside artifact review request until the lazy Review panel consumes it', () => {
    openReviewSessionForPath('/private/tmp/report.md')

    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'review',
      rightPanelCollapsed: false,
      reviewFileOpenRequest: {
        scope: 'session',
        path: '/private/tmp/report.md',
      },
    })
  })
})
