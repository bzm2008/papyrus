import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('portable MSVC probe', () => {
  it('accepts an installed Visual Studio toolchain when bundled tools are absent', () => {
    const output = execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', path.resolve('scripts/with-portable-msvc.ps1'),
      '-ProbeOnly',
    ], { encoding: 'utf8' })

    expect(output).toContain('MSVC toolchain ready')
  }, 15_000)

  it('propagates cargo failures to the caller', () => {
    expect(() => execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', path.resolve('scripts/with-portable-msvc.ps1'),
      'not-a-real-cargo-command',
    ], { encoding: 'utf8', stdio: 'pipe' })).toThrow()
  }, 15_000)
})
