import type { PerformanceSnapshot } from '@shared/reliability'
import type { WorkerDiagnosticSnapshot } from '@shared/reliability'

const startedAt = process.hrtime.bigint()
export const PERFORMANCE_BUDGETS = {
  rssWarningBytes: 1_500 * 1024 * 1024,
  heapWarningBytes: 768 * 1024 * 1024,
  workerHardCap: 16,
} as const

export function capturePerformance(
  workers: WorkerDiagnosticSnapshot,
  now = Date.now(),
): PerformanceSnapshot {
  const memory = process.memoryUsage()
  const warnings: string[] = []
  if (memory.rss > PERFORMANCE_BUDGETS.rssWarningBytes) {
    warnings.push('RSS memory is above the 1.5 GiB warning budget')
  }
  if (memory.heapUsed > PERFORMANCE_BUDGETS.heapWarningBytes) {
    warnings.push('JavaScript heap is above the 768 MiB warning budget')
  }
  if (workers.poolSize > PERFORMANCE_BUDGETS.workerHardCap) {
    warnings.push('Worker pool exceeds the hard cap of 16')
  }
  return {
    capturedAt: now,
    uptimeSeconds: Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    workerCount: workers.poolSize,
    activeWorkerCount: workers.workers.filter((worker) => worker.running).length,
    budgets: { ...PERFORMANCE_BUDGETS },
    warnings,
  }
}
