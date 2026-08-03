#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFICIAL_REPOSITORY = 'oliverzhu823/vizruna'
const GIT_TIMEOUT_MS = 12_000

export function repositoryFromRemote(remote) {
  const value = String(remote || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  const match = value.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i,
  )
  return match?.[1]?.toLowerCase() || null
}

export function isOfficialVizrunaRemote(remote) {
  return repositoryFromRemote(remote) === OFFICIAL_REPOSITORY
}

function git(args, options = {}) {
  return spawnSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  })
}

function output(result) {
  return String(result.stdout || '').trim()
}

function log(message) {
  console.log(`[Vizruna-web 更新] ${message}`)
}

export function updateOfficialSource(cwd = process.cwd()) {
  if (process.env.VIZRUNA_WEB_SKIP_UPDATE === '1') {
    log('已按环境设置跳过自动检查。')
    return { status: 'skipped', reason: 'disabled' }
  }
  if (!existsSync(resolve(cwd, '.git'))) {
    log('当前是源码压缩包，不执行 Git 自动更新。重新下载新版并覆盖代码目录即可，用户数据不会受影响。')
    return { status: 'skipped', reason: 'not-git' }
  }

  const inside = git(['rev-parse', '--is-inside-work-tree'], { cwd })
  if (inside.status !== 0 || output(inside) !== 'true') {
    log('当前目录不是有效 Git 仓库，跳过更新。')
    return { status: 'skipped', reason: 'invalid-git' }
  }
  const remote = git(['remote', 'get-url', 'origin'], { cwd })
  if (remote.status !== 0 || !isOfficialVizrunaRemote(output(remote))) {
    log('origin 不是 Vizruna 官方仓库，为安全起见不自动更新。')
    return { status: 'skipped', reason: 'untrusted-origin' }
  }
  const branch = git(['branch', '--show-current'], { cwd })
  if (branch.status !== 0 || output(branch) !== 'main') {
    log('当前不在 main 分支，不自动改变开发分支。')
    return { status: 'skipped', reason: 'not-main' }
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=normal'], { cwd })
  if (dirty.status !== 0 || output(dirty)) {
    log('检测到本地文件改动，已保留改动并跳过自动更新。')
    return { status: 'skipped', reason: 'dirty' }
  }

  log('正在安全检查官方 main 分支更新...')
  const fetched = git(['fetch', '--quiet', 'origin', 'main'], { cwd })
  if (fetched.status !== 0) {
    log('当前无法连接 GitHub，将继续启动现有版本。')
    return { status: 'skipped', reason: 'offline' }
  }
  const head = git(['rev-parse', 'HEAD'], { cwd })
  const target = git(['rev-parse', 'origin/main'], { cwd })
  if (head.status !== 0 || target.status !== 0) {
    log('无法确认版本关系，将继续启动现有版本。')
    return { status: 'skipped', reason: 'unknown-revision' }
  }
  if (output(head) === output(target)) {
    log('当前已经是最新版。')
    return { status: 'current' }
  }
  const ancestor = git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { cwd })
  if (ancestor.status !== 0) {
    log('本地版本与官方分支存在分叉，不自动覆盖。')
    return { status: 'skipped', reason: 'diverged' }
  }
  const merged = git(['merge', '--ff-only', 'origin/main'], { cwd })
  if (merged.status !== 0) {
    log('快进更新未完成，将继续保留当前版本。')
    return { status: 'skipped', reason: 'merge-failed' }
  }
  log('已更新到官方最新版本。')
  return { status: 'updated', revision: output(target) }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    updateOfficialSource()
  } catch (error) {
    log(`检查失败，将继续启动现有版本：${error instanceof Error ? error.message : String(error)}`)
  }
}
