#!/usr/bin/env node
/**
 * 发布前版本一致性校验：
 *   node scripts/release/check-version.mjs <version>
 * <version>（不含 v）必须同时等于 package.json#version 与 shared/app-info.ts 的 APP_VERSION。
 * 任一不一致 exit 1（CI 用于防止 tag 与代码版本错配）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const expected = process.argv[2]

function fail(msg) {
  console.error('version check failed: ' + msg)
  process.exit(1)
}

if (!expected || !/^\d+\.\d+\.\d+$/.test(expected)) {
  fail(`非法版本号参数: ${expected ?? '(empty)'}`)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const appInfo = readFileSync(join(root, 'shared', 'app-info.ts'), 'utf-8')
const m = appInfo.match(/APP_VERSION\s*=\s*'([^']+)'/)
const appInfoVersion = m?.[1]

if (pkg.version !== expected) fail(`package.json#version=${pkg.version}，期望 ${expected}`)
if (appInfoVersion !== expected) fail(`shared/app-info.ts APP_VERSION=${appInfoVersion ?? '(not found)'}，期望 ${expected}`)
console.log(`version check ok: ${expected}`)
