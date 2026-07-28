import { describe, expect, it, vi } from 'vitest'
import { capturePerformance, PERFORMANCE_BUDGETS } from './performance-monitor'

describe('performance governance', () => {
  it('publishes explicit budgets and flags resource excess', () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: PERFORMANCE_BUDGETS.rssWarningBytes + 1,
      heapTotal: 0,
      heapUsed: PERFORMANCE_BUDGETS.heapWarningBytes + 1,
      external: 1,
      arrayBuffers: 0,
    })
    const workers = Array.from({ length: 17 }, (_, index) => ({
      poolKey: `worker-${index}`,
      cwd: '/tmp/project',
      sessionBound: true,
      running: index < 4,
      stopping: false,
    }))
    const snapshot = capturePerformance({
      poolSize: workers.length,
      foregroundPoolKey: workers[0].poolKey,
      workers,
    })
    expect(snapshot.budgets).toEqual(PERFORMANCE_BUDGETS)
    expect(snapshot.activeWorkerCount).toBe(4)
    expect(snapshot.warnings).toHaveLength(3)
    vi.restoreAllMocks()
  })
})

