import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION } from '../../shared/app-info'

describe('版本号一致性', () => {
  it('APP_VERSION 必须等于 package.json#version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'))
    expect(APP_VERSION).toBe(pkg.version)
  })
})
