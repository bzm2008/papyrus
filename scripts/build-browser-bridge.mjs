#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const source = path.resolve(root, 'apps/browser-bridge')
const output = path.resolve(root, 'dist-browser-bridge')
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
async function copyRuntimeFiles(targetDir, manifestFile = 'manifest.json') {
  await fs.mkdir(targetDir, { recursive: true })
  for (const file of runtimeFiles) {
    const sourceFile = file === 'manifest.json' ? manifestFile : file
    await fs.copyFile(path.join(source, sourceFile), path.join(targetDir, file))
  }
}

await copyRuntimeFiles(output)
await copyRuntimeFiles(path.join(output, 'firefox-esr'), 'manifest.firefox-esr.json')

const chromiumManifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'))
if (chromiumManifest.manifest_version !== 3 || !chromiumManifest.background?.service_worker) throw new Error('invalid Browser Bridge MV3 manifest')
const firefoxManifest = JSON.parse(await fs.readFile(path.join(output, 'firefox-esr', 'manifest.json'), 'utf8'))
if (firefoxManifest.manifest_version !== 3 || firefoxManifest.browser_specific_settings?.gecko?.id !== 'browser-bridge@papyrus.scallion') {
  throw new Error('invalid Firefox ESR Browser Bridge manifest')
}
console.log(`PASS built Browser Bridge -> ${path.relative(root, output)} and ${path.relative(root, path.join(output, 'firefox-esr'))}`)
