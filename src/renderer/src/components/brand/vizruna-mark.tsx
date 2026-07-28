import { memo } from 'react'
import { cn } from '@renderer/lib/utils'

/** Vizruna pixel mark: visible execution path + Agent/Audit checkpoint. */
function VizrunaMarkImpl({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 700 700"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="vizruna-mark-surface" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1A1B1F" />
          <stop offset="1" stopColor="#111216" />
        </linearGradient>
      </defs>
      <rect x="37" y="46" width="625" height="611" rx="82" fill="url(#vizruna-mark-surface)" />
      <path
        fill="#FDFAF3"
        d="M109 171v69h45v68h31v68h36v68h36v69h35v31h69v-31h34v-39h31v-45h49v-52h-31v16h-54v51h-32v26h-62v-93h-34v-69h-34v-68h-49v-69z"
      />
      <path
        fill="#FDFAF3"
        d="M415 171v70h-44v68h-36v71h-26v65h33v-34h31v-66h42v-53h71v53h42v129h32v70h32V377h-27v-68h-37v-68h-44v-70z"
      />
      <rect x="474" y="377" width="53" height="53" fill="#8DA575" />
    </svg>
  )
}

export const VizrunaMark = memo(VizrunaMarkImpl)
