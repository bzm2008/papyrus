import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const STABLE_RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const VERSION_FILES = {
  packageLock: 'package-lock.json',
  cargoToml: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
  tauriConfig: 'src-tauri/tauri.conf.json',
  browserManifest: 'apps/browser-bridge/manifest.json',
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validReleaseVersion(value) {
  if (typeof value !== 'string' || !STABLE_RELEASE_VERSION.test(value)) return false
  return value.split('.').every((part) => Number(part) <= 65_535)
}

function versionFailure() {
  return 'package.json.version must be a stable numeric release version (for example 1.0.0)'
}

function formatJson(value, original) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : ''
  return `${JSON.stringify(value, null, 2).replace(/\n/g, eol)}${trailingNewline}`
}

function replaceTopLevelJsonVersion(text, version) {
  if (!/^(\s*"version"\s*:\s*)"[^"]*"/m.test(text)) return null
  return text.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`)
}

async function readText(rootDir, relativePath) {
  try {
    return await fs.readFile(path.join(rootDir, relativePath), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readJson(rootDir, relativePath) {
  const text = await readText(rootDir, relativePath)
  if (text === null) return { text: null, value: null, error: `missing version source: ${relativePath}` }
  try {
    return { text, value: JSON.parse(text), error: null }
  } catch (error) {
    return { text, value: null, error: `${relativePath}: invalid JSON (${error.message})` }
  }
}

function packageVersionFrom(value) {
  if (!isObject(value) || !validReleaseVersion(value.version)) return null
  return value.version
}

function findTomlSection(text, header) {
  const headerMatch = new RegExp(`^\\s*\\[${header}\\]\\s*$`, 'm').exec(text)
  if (!headerMatch) return null
  const bodyStart = headerMatch.index + headerMatch[0].length
  const nextHeader = /^\s*\[/m.exec(text.slice(bodyStart))
  const bodyEnd = nextHeader ? bodyStart + nextHeader.index : text.length
  return { bodyStart, bodyEnd, body: text.slice(bodyStart, bodyEnd) }
}

function findCargoLockPackage(text, name) {
  const headers = [...text.matchAll(/^\[\[package\]\]\s*$/gm)]
  for (let index = 0; index < headers.length; index += 1) {
    const start = headers[index].index
    const end = index + 1 < headers.length ? headers[index + 1].index : text.length
    const block = text.slice(start, end)
    if (new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(block)) return { start, end, block }
  }
  return null
}

function cargoTomlVersion(text) {
  const section = findTomlSection(text, 'package')
  const version = section?.body.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)?.[1]
  return version ?? null
}

function cargoLockVersion(text) {
  const packageBlock = findCargoLockPackage(text, 'papyrus')
  return packageBlock?.block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? null
}

function replaceCargoTomlVersion(text, version) {
  const section = findTomlSection(text, 'package')
  if (!section) return null
  const body = section.body
  if (!/^\s*version\s*=\s*"[^"]+"\s*$/m.test(body)) return null
  const updatedBody = body.replace(/^(\s*version\s*=\s*)"[^"]+"\s*$/m, `$1"${version}"`)
  return `${text.slice(0, section.bodyStart)}${updatedBody}${text.slice(section.bodyEnd)}`
}

function replaceCargoLockVersion(text, version) {
  const packageBlock = findCargoLockPackage(text, 'papyrus')
  if (!packageBlock || !/^version\s*=\s*"[^"]+"\s*$/m.test(packageBlock.block)) return null
  const updatedBlock = packageBlock.block.replace(/^(version\s*=\s*)"[^"]+"\s*$/m, `$1"${version}"`)
  return `${text.slice(0, packageBlock.start)}${updatedBlock}${text.slice(packageBlock.end)}`
}

async function writeIfChanged(rootDir, relativePath, original, updated) {
  if (original === updated) return
  await fs.writeFile(path.join(rootDir, relativePath), updated, 'utf8')
}

async function readVersionSources(rootDir) {
  const [packageJson, packageLock, tauriConfig, browserManifest, cargoToml, cargoLock] = await Promise.all([
    readJson(rootDir, 'package.json'),
    readJson(rootDir, VERSION_FILES.packageLock),
    readJson(rootDir, VERSION_FILES.tauriConfig),
    readJson(rootDir, VERSION_FILES.browserManifest),
    readText(rootDir, VERSION_FILES.cargoToml),
    readText(rootDir, VERSION_FILES.cargoLock),
  ])
  return { packageJson, packageLock, tauriConfig, browserManifest, cargoToml, cargoLock }
}

/**
 * Inspect the release-version mirrors. package.json is the only authoritative input; package
 * artifacts cannot be produced if a native or extension surface has drifted from it.
 */
export async function inspectReleaseVersion({ rootDir = process.cwd() } = {}) {
  const sources = await readVersionSources(rootDir)
  const failures = []
  if (sources.packageJson.error) return { version: null, failures: [sources.packageJson.error] }

  const version = packageVersionFrom(sources.packageJson.value)
  if (!version) return { version: null, failures: [versionFailure()] }

  if (sources.packageLock.error) failures.push(sources.packageLock.error)
  else {
    if (sources.packageLock.value?.version !== version) {
      failures.push(`package-lock.json version must match package.json.version (${version})`)
    }
    if (sources.packageLock.value?.packages?.['']?.version !== version) {
      failures.push(`package-lock.json root package version must match package.json.version (${version})`)
    }
  }

  if (sources.tauriConfig.error) failures.push(sources.tauriConfig.error)
  else if (sources.tauriConfig.value?.version !== version) {
    failures.push(`src-tauri/tauri.conf.json version must match package.json.version (${version})`)
  }

  if (sources.browserManifest.error) failures.push(sources.browserManifest.error)
  else if (sources.browserManifest.value?.version !== version) {
    failures.push(`apps/browser-bridge/manifest.json version must match package.json.version (${version})`)
  }

  if (sources.cargoToml === null) failures.push(`missing version source: ${VERSION_FILES.cargoToml}`)
  else if (cargoTomlVersion(sources.cargoToml) !== version) {
    failures.push(`src-tauri/Cargo.toml package version must match package.json.version (${version})`)
  }

  if (sources.cargoLock === null) failures.push(`missing version source: ${VERSION_FILES.cargoLock}`)
  else if (cargoLockVersion(sources.cargoLock) !== version) {
    failures.push(`src-tauri/Cargo.lock papyrus package version must match package.json.version (${version})`)
  }

  return { version, failures }
}

/**
 * Copy the canonical package.json version into the release metadata mirrors. It deliberately
 * refuses prerelease strings because Chromium manifests and the protected OTA channel only ship
 * stable numeric releases.
 */
export async function synchronizeReleaseVersion({ rootDir = process.cwd() } = {}) {
  const sources = await readVersionSources(rootDir)
  if (sources.packageJson.error) return { version: null, failures: [sources.packageJson.error] }

  const version = packageVersionFrom(sources.packageJson.value)
  if (!version) return { version: null, failures: [versionFailure()] }

  const requiredSources = [
    sources.packageLock.error,
    sources.tauriConfig.error,
    sources.browserManifest.error,
    sources.cargoToml === null ? `missing version source: ${VERSION_FILES.cargoToml}` : null,
    sources.cargoLock === null ? `missing version source: ${VERSION_FILES.cargoLock}` : null,
  ].filter(Boolean)
  if (requiredSources.length > 0) return { version, failures: requiredSources }

  if (!isObject(sources.packageLock.value) || !isObject(sources.packageLock.value.packages) || !isObject(sources.packageLock.value.packages[''])) {
    return { version, failures: ['package-lock.json must contain a root package record'] }
  }
  if (!isObject(sources.tauriConfig.value)) return { version, failures: ['src-tauri/tauri.conf.json must be an object'] }
  if (!isObject(sources.browserManifest.value)) return { version, failures: ['apps/browser-bridge/manifest.json must be an object'] }

  const updatedPackageLock = structuredClone(sources.packageLock.value)
  updatedPackageLock.version = version
  updatedPackageLock.packages[''].version = version
  const updatedTauriConfig = replaceTopLevelJsonVersion(sources.tauriConfig.text, version)
  const updatedBrowserManifest = replaceTopLevelJsonVersion(sources.browserManifest.text, version)
  const updatedCargoToml = replaceCargoTomlVersion(sources.cargoToml, version)
  const updatedCargoLock = replaceCargoLockVersion(sources.cargoLock, version)
  if (updatedTauriConfig === null) return { version, failures: ['src-tauri/tauri.conf.json must contain a top-level version'] }
  if (updatedBrowserManifest === null) return { version, failures: ['apps/browser-bridge/manifest.json must contain a top-level version'] }
  if (updatedCargoToml === null) return { version, failures: ['src-tauri/Cargo.toml must contain a [package] version'] }
  if (updatedCargoLock === null) return { version, failures: ['src-tauri/Cargo.lock must contain the papyrus package version'] }

  await Promise.all([
    writeIfChanged(rootDir, VERSION_FILES.packageLock, sources.packageLock.text, formatJson(updatedPackageLock, sources.packageLock.text)),
    writeIfChanged(rootDir, VERSION_FILES.tauriConfig, sources.tauriConfig.text, updatedTauriConfig),
    writeIfChanged(rootDir, VERSION_FILES.browserManifest, sources.browserManifest.text, updatedBrowserManifest),
    writeIfChanged(rootDir, VERSION_FILES.cargoToml, sources.cargoToml, updatedCargoToml),
    writeIfChanged(rootDir, VERSION_FILES.cargoLock, sources.cargoLock, updatedCargoLock),
  ])
  return inspectReleaseVersion({ rootDir })
}

function parseArgs(argv) {
  let checkOnly = false
  let rootDir = process.cwd()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      checkOnly = true
    } else if (argument === '--root') {
      rootDir = path.resolve(argv[index + 1] ?? '')
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      return null
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return { checkOnly, rootDir }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) {
    console.log('Usage: node scripts/lib/release-version.mjs [--check] [--root path]')
    return
  }
  const report = options.checkOnly
    ? await inspectReleaseVersion({ rootDir: options.rootDir })
    : await synchronizeReleaseVersion({ rootDir: options.rootDir })
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`FAIL ${failure}`)
    process.exitCode = 1
    return
  }
  console.log(`PASS release version ${report.version}${options.checkOnly ? ' is synchronized' : ' synchronized'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
