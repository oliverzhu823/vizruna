import { memo } from 'react'
import { cn } from '@renderer/lib/utils'

/** Vizruna pixel mark: visible execution path + Agent/Audit checkpoint. */
function VizrunaMarkImpl({ className, size = 16 }: { className?: string; size?: number }) {
  const pixels = [
    [96, 260], [164, 328], [232, 396], [300, 464], [368, 532], [436, 600],
    [504, 532], [572, 464], [640, 396], [708, 328], [776, 396],
    [844, 464], [844, 532], [844, 600], [640, 464], [776, 464],
  ] as const

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect width="1024" height="1024" rx="224" fill="#111216" />
      {pixels.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="76" height="76" fill="#F7F4EC" />
      ))}
      <rect x="708" y="464" width="76" height="76" fill="#9DBA86" />
    </svg>
  )
}

export const VizrunaMark = memo(VizrunaMarkImpl)
