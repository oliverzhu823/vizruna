import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const REVIEW_TEXT_MAX_BYTES = 1024 * 1024

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  if (!existsSync(absolute)) return absolute
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function isWithinRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Read reviewable text only from the trusted workspace or a local temporary-artifact root.
 * This keeps arbitrary home-directory files outside the renderer's readable capability.
 */
export function readReviewArtifactText(req: {
  path: string
  workspaceRoot?: string | null
  maxBytes?: number
}) {
  const rawPath = String(req.path || '').trim()
  if (!rawPath) return { ok: false as const, error: 'missing_path' as const }

  const trustedWorkspace = req.workspaceRoot ? canonicalPath(req.workspaceRoot) : null
  const candidate = canonicalPath(
    isAbsolute(rawPath) ? rawPath : trustedWorkspace ? resolve(trustedWorkspace, rawPath) : rawPath,
  )
  const allowedRoots = [trustedWorkspace, canonicalPath(tmpdir()), canonicalPath('/tmp')].filter(
    (root): root is string => Boolean(root),
  )
  if (!allowedRoots.some((root) => isWithinRoot(candidate, root))) {
    return { ok: false as const, error: 'outside_allowed_roots' as const }
  }
  if (!existsSync(candidate)) return { ok: false as const, error: 'not_found' as const }

  try {
    const stat = statSync(candidate)
    if (!stat.isFile()) return { ok: false as const, error: 'not_a_file' as const }
    const maxBytes = Math.min(
      Math.max(1, req.maxBytes ?? REVIEW_TEXT_MAX_BYTES),
      REVIEW_TEXT_MAX_BYTES,
    )
    if (stat.size > maxBytes) return { ok: false as const, error: 'too_large' as const, size: stat.size }
    const buffer = readFileSync(candidate)
    if (buffer.length > maxBytes) return { ok: false as const, error: 'too_large' as const, size: stat.size }
    return {
      ok: true as const,
      content: buffer.toString('utf-8'),
      size: stat.size,
      path: candidate,
    }
  } catch {
    return { ok: false as const, error: 'read_failed' as const }
  }
}
