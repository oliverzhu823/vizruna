import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionLeaseConflictDialog } from './session-lease-conflict-dialog'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

const conflict = {
  sessionFile: '/tmp/session.jsonl',
  leaseFile: '/tmp/session.jsonl.lease',
  disposition: 'active-foreign' as const,
  reason: 'same-host-live-pid' as const,
  record: {
    version: 1 as const,
    appId: 'com.example.other',
    instanceId: '11111111-1111-4111-8111-111111111111',
    hostname: 'workstation',
    pid: 123,
    sessionFile: '/tmp/session.jsonl',
    acquiredAt: '2026-07-25T00:00:00.000Z',
    refreshedAt: '2026-07-25T00:00:10.000Z',
  },
}

describe('SessionLeaseConflictDialog', () => {
  beforeEach(() => {
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({
      currentSessionId: 'session-1',
      historySessionFile: conflict.sessionFile,
      sessionLeaseSnapshot: conflict,
      sessionLeaseDialogOpen: true,
      sessionLeaseTakeoverPending: false,
    })
  })

  it('offers a read-only path without mutating the lease', () => {
    render(<SessionLeaseConflictDialog />)
    fireEvent.click(screen.getByRole('button', { name: /keep read-only|保持只读/i }))
    expect(useUIStore.getState().sessionLeaseDialogOpen).toBe(false)
    expect(useUIStore.getState().sessionLeaseSnapshot).toEqual(conflict)
    expect(ipcClient.invoke).not.toHaveBeenCalled()
  })

  it('requires the explicit takeover action and applies the owned snapshot', async () => {
    const owned = {
      ...conflict,
      disposition: 'owned' as const,
      reason: 'same-instance' as const,
      record: {
        ...conflict.record,
        appId: 'com.pi.enterprise.desktop',
        instanceId: '22222222-2222-4222-8222-222222222222',
      },
    }
    vi.mocked(ipcClient.invoke).mockResolvedValue({ acquired: true, snapshot: owned })

    render(<SessionLeaseConflictDialog />)
    fireEvent.click(screen.getByRole('button', { name: /confirm forced takeover|确认强制接管/i }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('session.lease.takeover', {
        sessionFile: conflict.sessionFile,
        confirmed: true,
      })
      expect(useUIStore.getState().sessionLeaseSnapshot).toEqual(owned)
      expect(useUIStore.getState().sessionLeaseDialogOpen).toBe(false)
    })
  })
})
