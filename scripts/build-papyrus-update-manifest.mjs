#!/usr/bin/env node

import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

function readArg(args, name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

async function walk(root) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await walk(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function platformForAsset(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.exe') && (lower.includes('setup') || lower.includes('nsis'))) return 'windows-x86_64'
  if (lower.endsWith('.appimage')) return 'linux-x86_64'
  if (lower.endsWith('.deb')) return 'linux-x86_64-deb'
  if (lower.endsWith('.app.tar.gz')) {
    if (lower.includes('aarch64') || lower.includes('arm64')) return 'darwin-aarch64'
    if (lower.includes('x86_64') || lower.includes('x64') || lower.includes('intel')) return 'darwin-x86_64'
  }
  return null
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/build-papyrus-update-manifest.mjs --artifacts <dir> --version <version> --output <file> [--owner bzm2008 --repo papyrus]')
  process.exit(0)
}

const artifactsDir = path.resolve(readArg(args, '--artifacts', 'release-assets'))
const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageVersion = typeof packageJson.version === 'string' ? packageJson.version.trim() : ''
const version = readArg(args, '--version', packageVersion)
const output = path.resolve(readArg(args, '--output', path.join(artifactsDir, 'latest.json')))
const owner = readArg(args, '--owner', 'bzm2008')
const repo = readArg(args, '--repo', 'papyrus')

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`)
if (version !== packageVersion) throw new Error(`release version ${version} must match package.json version ${packageVersion}`)

const files = await walk(artifactsDir)
const signatures = new Map()
for (const file of files) {
  if (file.toLowerCase().endsWith('.sig')) signatures.set(file.slice(0, -4), await fs.readFile(file, 'utf8'))
}

const platforms = {}
for (const [assetPath, signature] of signatures) {
  if (!signature) throw new Error(`empty updater signature: ${assetPath}.sig`)
  const name = path.basename(assetPath)
  const platform = platformForAsset(name)
  if (!platform) continue
  if (platforms[platform]) throw new Error(`duplicate updater asset for ${platform}: ${name}`)
  platforms[platform] = {
    signature: Buffer.from(signature, 'utf8').toString('base64'),
    url: `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`,
  }
  if (platform === 'linux-x86_64-deb') {
    platforms[platform].sha256 = createHash('sha256').update(await fs.readFile(assetPath)).digest('hex')
  }
}

const required = ['windows-x86_64', 'linux-x86_64', 'darwin-x86_64', 'darwin-aarch64']
const missing = required.filter((platform) => !platforms[platform])
if (missing.length) throw new Error(`missing signed updater assets: ${missing.join(', ')}`)

const manifest = {
  version,
  notes: `Papyrus ${version}：文科秘书工作台、项目账本、受控电脑助手与跨平台安装支持。`,
  pub_date: new Date().toISOString(),
  platforms,
}

await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${path.relative(process.cwd(), output)} with ${Object.keys(platforms).length} signed platforms`)
