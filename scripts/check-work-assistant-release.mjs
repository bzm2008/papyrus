#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

import { runReleaseChecks } from './lib/release-checks.mjs'

function parseArgs(argv) {
  let phase = 'local'
  let rootDir = process.cwd()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--phase') {
      phase = argv[index + 1] ?? ''
      index += 1
    } else if (argument === '--root') {
      rootDir = path.resolve(argv[index + 1] ?? '')
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/check-work-assistant-release.mjs [--phase local|release] [--root path]')
      return null
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return { phase, rootDir }
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) process.exit(0)
  const report = await runReleaseChecks(options)
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`FAIL ${failure}`)
    process.exitCode = 1
  } else {
    const scope = report.phase === 'release'
      ? 'workflow/package structure only; remote CI and device certification remain separate'
      : 'local application and extension structure'
    console.log(`PASS work-assistant release checks (${report.phase}; ${scope})`)
  }
} catch (error) {
  console.error(`FAIL release checker error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
