#!/usr/bin/env node

import { createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const ED25519_MINISIGN_PREFIX = Buffer.from('Ed')

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical base64`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw new Error(`${label} is not canonical base64`)
  return decoded
}

function unwrapMinisignDocument(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing ${label}`)
  const trimmed = value.trim()
  if (trimmed.includes('\n')) return trimmed
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(trimmed, `${label} wrapper`))
  if (!text.includes('\n')) throw new Error(`${label} wrapper does not contain a minisign document`)
  return text
}

function minisignRecord(value, expectedLength, label) {
  const lines = unwrapMinisignDocument(value, label).replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment:')) {
    throw new Error(`${label} must be a two-line minisign document`)
  }
  const record = decodeBase64(lines[1], `${label} record`)
  if (record.length !== expectedLength || !record.subarray(0, 2).equals(ED25519_MINISIGN_PREFIX)) {
    throw new Error(`${label} does not contain an Ed25519 minisign record`)
  }
  return record
}

function minisignPublicKeyRecord(publicKey) {
  return minisignRecord(publicKey, 42, 'Tauri updater public key')
}

export function parseTauriUpdaterSignature(signature) {
  return minisignRecord(signature, 74, 'Tauri updater signature')
}

export function equalTauriUpdaterSignatures(left, right) {
  return parseTauriUpdaterSignature(left).equals(parseTauriUpdaterSignature(right))
}

export function parseTauriUpdaterPublicKey(publicKey) {
  const encodedPublicKey = minisignPublicKeyRecord(publicKey)
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
    const encodedSignature = parseTauriUpdaterSignature(signature)
    const key = parseTauriUpdaterPublicKey(publicKey)
    const encodedPublicKey = minisignPublicKeyRecord(publicKey)
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

function releaseAssetName(url, expectedVersion) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error(`updater asset URL must use HTTPS: ${url}`)
  if (!parsed.pathname.includes(`/releases/download/v${expectedVersion}/`)) {
    throw new Error(`updater asset URL must target release tag v${expectedVersion}: ${url}`)
  }
  const assetName = decodeURIComponent(parsed.pathname.split('/').pop() ?? '')
  if (!assetName.includes(`_${expectedVersion}_`)) {
    throw new Error(`updater asset name must contain version ${expectedVersion}: ${assetName}`)
  }
  return assetName
}

export async function verifyLocalReleaseAssets({ artifactsDir, manifestPath, publicKey, expectedVersion }) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.version !== expectedVersion) throw new Error(`manifest version ${manifest.version} must match expected ${expectedVersion}`)
  const files = await walk(artifactsDir)
  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    if (!entry || typeof entry.url !== 'string' || typeof entry.signature !== 'string') {
      throw new Error(`manifest platform ${platform} is incomplete`)
    }
    const assetName = releaseAssetName(entry.url, expectedVersion)
    const assetPath = await uniqueArtifact(files, assetName)
    const signaturePath = await uniqueArtifact(files, `${assetName}.sig`)
    const artifact = await fs.readFile(assetPath)
    const signature = await fs.readFile(signaturePath, 'utf8')
    if (!equalTauriUpdaterSignatures(signature, entry.signature)) throw new Error(`manifest signature does not match ${assetName}.sig`)
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
    if (manifestSignature && !equalTauriUpdaterSignatures(signature, manifestSignature)) throw new Error('manifest signature does not match downloaded sidecar')
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
