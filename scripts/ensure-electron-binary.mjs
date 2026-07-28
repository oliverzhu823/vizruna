#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  throw new Error('Electron platform binary is unavailable after installation')
}

console.log(`[ensure-electron] verified ${electronPath}`)
