#!/usr/bin/env node

import { createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function encodedMinisignLine(value, expectedLength) {
  for (const line of value.split(/\r?\n/)) {
    const decoded = Buffer.from(line.trim(), 'base64')
    if (decoded.length === expectedLength && decoded.subarray(0, 2).equals(Buffer.from('Ed'))) return decoded
  }
  return undefined
}

function minisignPublicKeyText(publicKey) {
  if (typeof publicKey !== 'string' || !publicKey.trim()) throw new Error('missing Tauri updater public key')
  const trimmed = publicKey.trim()
  if (trimmed.includes('\n')) return trimmed
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
  if (!decoded.startsWith('untrusted comment:')) throw new Error('Tauri updater public key is not base64-encoded minisign text')
  return decoded
}

export function parseTauriUpdaterPublicKey(publicKey) {
  const encodedPublicKey = encodedMinisignLine(minisignPublicKeyText(publicKey), 42)
  if (!encodedPublicKey) throw new Error('Tauri updater public key does not contain an Ed25519 minisign key')
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, encodedPublicKey.subarray(10)]),
    format: 'der',
    type: 'spki',
  })
}

export async function readTauriUpdaterPublicKey(configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url)) {
  const tauriConfig = JSON.parse(await fs.readFile(configPath, 'utf8'))
  const publicKey = tauriConfig?.plugins?.updater?.pubkey
  parseTauriUpdaterPublicKey(publicKey)
  return publicKey
}

export function verifyTauriUpdaterSignature({ artifact, signature, publicKey }) {
  try {
    const encodedSignature = encodedMinisignLine(signature, 74)
    if (!encodedSignature) return false
    const key = parseTauriUpdaterPublicKey(publicKey)
    const encodedPublicKey = encodedMinisignLine(minisignPublicKeyText(publicKey), 42)
    if (!encodedPublicKey) return false
    if (!encodedPublicKey.subarray(2, 10).equals(encodedSignature.subarray(2, 10))) return false
    return verify(null, artifact, key, encodedSignature.subarray(10))
  } catch {
    return false
  }
}

async function walk(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const candidate = path.join(rootDir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(candidate))
    if (entry.isFile()) files.push(candidate)
  }
  return files
}

async function uniqueArtifact(files, name) {
  const matches = files.filter((file) => path.basename(file) === name)
  if (matches.length !== 1) throw new Error(`expected exactly one release asset named ${name}, found ${matches.length}`)
  return matches[0]
}

export async function verifyLocalReleaseAssets({ artifactsDir, manifestPath, publicKey, expectedVersion }) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.version !== expectedVersion) throw new Error(`manifest version ${manifest.version} must match expected ${expectedVersion}`)
  const files = await walk(artifactsDir)
  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    if (!entry || typeof entry.url !== 'string' || typeof entry.signature !== 'string') {
      throw new Error(`manifest platform ${platform} is incomplete`)
    }
    const assetName = decodeURIComponent(new URL(entry.url).pathname.split('/').pop() ?? '')
    const assetPath = await uniqueArtifact(files, assetName)
    const signaturePath = await uniqueArtifact(files, `${assetName}.sig`)
    const artifact = await fs.readFile(assetPath)
    const signature = await fs.readFile(signaturePath, 'utf8')
    if (signature.trim() !== entry.signature.trim()) throw new Error(`manifest signature does not match ${assetName}.sig`)
    if (!verifyTauriUpdaterSignature({ artifact, signature, publicKey })) {
      throw new Error(`Tauri updater signature is invalid for ${platform} asset ${assetName}`)
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const valueFor = (name, fallback) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : fallback
  }
  const artifactsDir = path.resolve(valueFor('--artifacts', 'release-assets'))
  const manifestPath = path.resolve(valueFor('--manifest', path.join(artifactsDir, 'latest.json')))
  const artifactPath = valueFor('--artifact')
  const signaturePath = valueFor('--signature')
  const manifestSignature = valueFor('--manifest-signature')
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const expectedVersion = valueFor('--version', packageJson.version)
  if (expectedVersion !== packageJson.version) throw new Error(`release version ${expectedVersion} must match package.json version ${packageJson.version}`)
  const publicKey = await readTauriUpdaterPublicKey()
  if (artifactPath || signaturePath) {
    if (!artifactPath || !signaturePath) throw new Error('--artifact and --signature must be supplied together')
    const artifact = await fs.readFile(path.resolve(artifactPath))
    const signature = await fs.readFile(path.resolve(signaturePath), 'utf8')
    if (manifestSignature && signature.trim() !== manifestSignature.trim()) throw new Error('manifest signature does not match downloaded sidecar')
    if (!verifyTauriUpdaterSignature({ artifact, signature, publicKey })) throw new Error('Tauri updater signature is invalid')
    console.log('PASS verified signed updater artifact')
    return
  }
  await verifyLocalReleaseAssets({ artifactsDir, manifestPath, publicKey, expectedVersion })
  console.log(`PASS verified local signed release assets for ${expectedVersion}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
