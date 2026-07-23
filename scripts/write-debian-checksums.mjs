#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEBIAN_ASSETS = [
  (version) => `Papyrus_${version}_amd64.deb`,
  (version) => `Papyrus_${version}_amd64.AppImage`,
]

async function walk(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const candidate = path.join(rootDir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(candidate))
    else if (entry.isFile()) files.push(candidate)
  }
  return files
}

async function uniqueAssetPath(artifactsDir, assetName) {
  const matches = (await walk(artifactsDir)).filter((candidate) => path.basename(candidate) === assetName)
  if (matches.length !== 1) {
    throw new Error(`expected exactly one Debian release asset named ${assetName}, found ${matches.length}`)
  }
  return matches[0]
}

export async function generateDebianChecksums({ artifactsDir, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`)
  const entries = []
  for (const assetName of DEBIAN_ASSETS.map((name) => name(version))) {
    const assetPath = await uniqueAssetPath(artifactsDir, assetName)
    const contents = await fs.readFile(assetPath)
    entries.push({
      name: assetName,
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
  }
  return {
    entries,
    contents: entries.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n') + '\n',
  }
}

async function main() {
  const args = process.argv.slice(2)
  const valueFor = (name, fallback) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : fallback
  }
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const version = valueFor('--version', packageJson.version)
  if (version !== packageJson.version) throw new Error(`release version ${version} must match package.json version ${packageJson.version}`)
  const artifactsDir = path.resolve(valueFor('--artifacts', 'release-assets'))
  const output = path.resolve(valueFor('--output', path.join(artifactsDir, `Papyrus_${version}_SHA256SUMS`)))
  const generated = await generateDebianChecksums({ artifactsDir, version })
  await fs.writeFile(output, generated.contents, 'utf8')
  console.log(`Wrote ${path.relative(process.cwd(), output)} for ${generated.entries.length} Debian assets`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
