#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const source = path.resolve(root, 'apps/browser-bridge')
const output = path.resolve(root, 'dist-browser-bridge')
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const packageVersion = typeof packageJson.version === 'string' ? packageJson.version.trim() : ''

function validateExtensionVersion(value) {
  const parts = value.split('.')
  if (!value || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 65535)) {
    throw new Error(`package.json.version must be a Chrome extension version (1-4 numeric components): ${value || '<missing>'}`)
  }
  return value
}

const extensionVersion = validateExtensionVersion(packageVersion)
const sourceStat = await fs.stat(source)
if (!sourceStat.isDirectory()) throw new Error('missing apps/browser-bridge')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })

// Keep test fixtures and Playwright sources out of the unpacked extension.  The
// extension has a deliberately small runtime surface and release packaging must
// never accidentally ship test HTML or source maps containing fixture data.
const runtimeFiles = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'service_worker.js',
  'content_script.js',
]
for (const file of runtimeFiles.filter((file) => file !== 'manifest.json')) {
  await fs.copyFile(path.join(source, file), path.join(output, file))
}
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'))
if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) throw new Error('invalid Browser Bridge MV3 manifest')
manifest.version = extensionVersion
await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`PASS built Browser Bridge -> ${path.relative(root, output)}`)
