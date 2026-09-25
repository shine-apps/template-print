#!/usr/bin/env node
/**
 * 从 RELEASE_NOTES.md 抽取指定版本段落，写入 release/release-notes.txt（UTF-8 无 BOM）。
 *   node scripts/release/prepare-notes.mjs <version>
 * 供 build-update-manifest.ps1（写入 latest.json.releaseNotes）与 GitHub Release 正文共同使用。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractReleaseNotes } from './notes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node prepare-notes.mjs <x.y.z>')
  process.exit(1)
}

const md = readFileSync(join(root, 'RELEASE_NOTES.md'), 'utf-8')
const notes = extractReleaseNotes(md, version)
if (!notes) {
  console.error(`RELEASE_NOTES.md 中找不到 ## ${version} 段落`)
  process.exit(1)
}

const releaseDir = join(root, 'release')
mkdirSync(releaseDir, { recursive: true })
writeFileSync(join(releaseDir, 'release-notes.txt'), notes, 'utf-8')
console.log(`wrote release/release-notes.txt (${notes.length} chars)`)
