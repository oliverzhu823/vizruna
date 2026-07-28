#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = join(root, 'src', 'renderer', 'src')
const han = /[\u3400-\u9fff]/
const violations = new Set()

function filesBelow(directory) {
  const output = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'locales') output.push(...filesBelow(path))
    } else if (
      (path.endsWith('.ts') || path.endsWith('.tsx')) &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.test.tsx')
    ) {
      output.push(path)
    }
  }
  return output
}

function callName(call) {
  const expression = call.expression
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const left = ts.isIdentifier(expression.expression) ? expression.expression.text : ''
    return left ? `${left}.${expression.name.text}` : expression.name.text
  }
  return ''
}

function isAllowedString(node) {
  let cursor = node.parent
  while (cursor) {
    if (ts.isCallExpression(cursor)) {
      const name = callName(cursor)
      if (
        name === 't' ||
        name === 'i18n.t' ||
        name.startsWith('console.') ||
        name === 'alertTrace' ||
        name.startsWith('trace') ||
        name === 'includes' ||
        name === 'replace' ||
        name === 'startsWith' ||
        name.endsWith('.includes') ||
        name.endsWith('.replace') ||
        name.endsWith('.startsWith')
      ) {
        return true
      }
      break
    }
    if (
      ts.isPropertyAssignment(cursor) &&
      ts.isIdentifier(cursor.name) &&
      cursor.name.text === 'keywords'
    ) {
      return true
    }
    if (
      ts.isJsxElement(cursor) ||
      ts.isJsxSelfClosingElement(cursor) ||
      ts.isVariableStatement(cursor) ||
      ts.isReturnStatement(cursor)
    ) {
      break
    }
    cursor = cursor.parent
  }
  return false
}

function record(path, sourceFile, node, text) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  violations.add(
    `${relative(root, path)}:${line + 1}:${character + 1} ${JSON.stringify(text.trim())}`,
  )
}

for (const path of filesBelow(sourceRoot)) {
  const source = readFileSync(path, 'utf8')
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile)
      if (han.test(text)) record(path, sourceFile, node, text)
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      han.test(node.text) &&
      !isAllowedString(node)
    ) {
      record(path, sourceFile, node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      const staticText =
        node.head.text + node.templateSpans.map((span) => span.literal.text).join('')
      if (han.test(staticText) && !isAllowedString(node)) {
        record(path, sourceFile, node, staticText)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (violations.size > 0) {
  console.error(`[i18n-ui] ${violations.size} hardcoded Han UI string(s) found`)
  for (const violation of [...violations].sort()) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('[i18n-ui] no hardcoded Han strings found in renderer UI')
