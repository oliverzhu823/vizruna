#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const localeRoot = join(root, 'src', 'renderer', 'src', 'locales')
const sourceRoot = join(root, 'src', 'renderer', 'src')
const languages = ['zh', 'en']

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function flatten(value, prefix = '', output = new Map()) {
  for (const [key, nested] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flatten(nested, fullKey, output)
    } else {
      output.set(fullKey, nested)
    }
  }
  return output
}

function filesBelow(directory, predicate) {
  const output = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) output.push(...filesBelow(path, predicate))
    else if (predicate(path)) output.push(path)
  }
  return output
}

function placeholders(value) {
  if (typeof value !== 'string') return []
  return [...value.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)(?:\s*,[^}]*)?\s*\}\}/g)]
    .map((match) => match[1])
    .sort()
}

const errors = []
const localeFiles = new Map(
  languages.map((language) => [
    language,
    readdirSync(join(localeRoot, language))
      .filter((file) => extname(file) === '.json')
      .sort(),
  ]),
)

if (JSON.stringify(localeFiles.get('zh')) !== JSON.stringify(localeFiles.get('en'))) {
  errors.push('zh/en namespace file lists differ')
}

const resources = { zh: {}, en: {} }
for (const language of languages) {
  for (const file of localeFiles.get(language)) {
    const namespace = file.replace(/\.json$/, '')
    resources[language][namespace] = readJson(join(localeRoot, language, file))
  }
  // Settings components intentionally use `models:*` as a virtual namespace.
  resources[language].models = resources[language].settings?.models ?? {}
}

for (const namespace of Object.keys(resources.zh).sort()) {
  const zh = flatten(resources.zh[namespace])
  const en = flatten(resources.en[namespace] ?? {})
  for (const key of zh.keys()) {
    if (!en.has(key)) errors.push(`${namespace}:${key} exists only in zh`)
  }
  for (const key of en.keys()) {
    if (!zh.has(key)) errors.push(`${namespace}:${key} exists only in en`)
  }
  for (const [key, zhValue] of zh) {
    if (!en.has(key)) continue
    const zhPlaceholders = placeholders(zhValue)
    const enPlaceholders = placeholders(en.get(key))
    if (JSON.stringify(zhPlaceholders) !== JSON.stringify(enPlaceholders)) {
      errors.push(
        `${namespace}:${key} placeholder mismatch: zh=${zhPlaceholders.join(',')} en=${enPlaceholders.join(',')}`,
      )
    }
  }
}

function hasKey(language, namespace, key) {
  const resource = resources[language][namespace]
  return !!resource && flatten(resource).has(key)
}

const sourceFiles = filesBelow(
  sourceRoot,
  (path) => path.endsWith('.ts') || path.endsWith('.tsx'),
)
for (const path of sourceFiles) {
  const source = readFileSync(path, 'utf8')
  const namespaceMatch = source.match(
    /\buseTranslation\(\s*(['"])([A-Za-z0-9_.-]+)\1\s*\)/,
  )
  const defaultNamespace = namespaceMatch?.[2] ?? 'common'
  for (const match of source.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) {
    const rawKey = match[2]
    const separator = rawKey.indexOf(':')
    const namespace = separator >= 0 ? rawKey.slice(0, separator) : defaultNamespace
    const key = separator >= 0 ? rawKey.slice(separator + 1) : rawKey
    for (const language of languages) {
      if (!hasKey(language, namespace, key)) {
        errors.push(
          `${relative(root, path)} references missing ${language} key ${namespace}:${key}`,
        )
      }
    }
  }
}

if (errors.length > 0) {
  const uniqueErrors = [...new Set(errors)].sort()
  console.error(`[i18n] ${uniqueErrors.length} error(s)`)
  for (const error of uniqueErrors) console.error(`- ${error}`)
  process.exit(1)
}

const namespaceCount = Object.keys(resources.zh).length
const leafCount = Object.values(resources.zh).reduce(
  (total, resource) => total + flatten(resource).size,
  0,
)
console.log(
  `[i18n] zh/en parity and literal references verified: ${namespaceCount} namespaces, ${leafCount} leaves`,
)
