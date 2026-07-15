#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_GRACE_MS = 10_000
const MAX_OUTPUT = 128 * 1024
const OUTPUT_MARKER = '.papyrus-bundle-smoke'

export function isPathWithin(parentPath, childPath) {
  const parent = path.resolve(parentPath)
  const child = path.resolve(childPath)
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function validateOutputDirectory(outputDir, bundleDir, rootDir = ROOT, cwd = process.cwd()) {
  const output = path.resolve(outputDir)
  const bundle = path.resolve(bundleDir)
  const protectedAncestors = [path.resolve(rootDir), path.resolve(cwd), bundle]

  if (path.parse(output).root === output) {
    throw new Error('smoke output directory cannot be a filesystem root')
  }
  for (const protectedPath of protectedAncestors) {
    if (isPathWithin(output, protectedPath)) {
      throw new Error(`smoke output directory cannot contain protected path: ${protectedPath}`)
    }
  }
  if (isPathWithin(bundle, output)) {
    throw new Error(`smoke output directory cannot be inside bundle directory: ${bundle}`)
  }
  return output
}

export async function assertNoSymlinkAncestors(targetPath, protectedPaths = []) {
  const protectedResolved = await Promise.all(protectedPaths.map((value) => canonicalPath(value)))
  const targetResolved = path.resolve(targetPath)
  let current = targetResolved
  while (true) {
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) {
        const realTarget = await fs.realpath(current).catch(() => current)
        const expandedTarget = path.resolve(realTarget, path.relative(current, targetResolved))
        const pointsAtProtectedPath = protectedResolved.some(
          (protectedPath) => isPathWithin(protectedPath, expandedTarget),
        )
        if (protectedResolved.length === 0 || pointsAtProtectedPath) {
          throw new Error(`smoke output path cannot contain a symlink or junction to a protected path: ${current}`)
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function canonicalPath(value) {
  const resolved = path.resolve(value)
  try {
    return await fs.realpath(resolved)
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    const parent = path.dirname(resolved)
    if (parent === resolved) return resolved
    const canonicalParent = await canonicalPath(parent)
    return path.join(canonicalParent, path.basename(resolved))
  }
}

async function hasOwnedSmokeMarker(markerPath) {
  let stat
  try {
    stat = await fs.lstat(markerPath)
  } catch {
    return false
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return false
  const markerContents = await fs.readFile(markerPath, 'utf8').catch(() => '')
  try {
    const parsed = JSON.parse(markerContents)
    return parsed?.tool === 'papyrus-bundle-smoke' && parsed?.version === 1
  } catch {
    return false
  }
}

export async function prepareOutputDirectory(outputDir, bundleDir) {
  const output = validateOutputDirectory(outputDir, bundleDir)
  await assertNoSymlinkAncestors(output, [ROOT, process.cwd(), bundleDir])
  const marker = path.join(output, OUTPUT_MARKER)
  let existing
  try {
    existing = await fs.lstat(output)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error('smoke output directory must be a real directory')
    }
    const entries = await fs.readdir(output)
    if (entries.length > 0 && !entries.includes(OUTPUT_MARKER)) {
      throw new Error('smoke output directory is non-empty and is not owned by this smoke run')
    }
    if (entries.includes(OUTPUT_MARKER)) {
      if (!(await hasOwnedSmokeMarker(marker))) throw new Error('smoke output directory marker is invalid')
      await fs.rm(output, { recursive: true, force: true })
    }
  }

  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(marker, `${JSON.stringify({ tool: 'papyrus-bundle-smoke', version: 1 })}\n`, { flag: 'wx' })
  return output
}

export function parseArgs(argv) {
  const options = {
    bundleDir: path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle'),
    outputDir: process.env.PAPYRUS_SMOKE_DIR || path.join(os.tmpdir(), 'papyrus-bundle-smoke'),
    graceMs: DEFAULT_GRACE_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--bundle-dir') {
      options.bundleDir = path.resolve(argv[++index] || '')
    } else if (argument === '--output') {
      options.outputDir = path.resolve(argv[++index] || '')
    } else if (argument === '--grace-ms') {
      const value = Number(argv[++index])
      if (!Number.isFinite(value) || value < 1000 || value > 60_000) {
        throw new Error('--grace-ms must be between 1000 and 60000')
      }
      options.graceMs = Math.round(value)
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/smoke-tauri-bundle.mjs [--bundle-dir path] [--output path] [--grace-ms ms]')
      return null
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }

  return options
}

async function walkFiles(rootDir) {
  const result = []
  const visit = async (current) => {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const candidate = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(candidate)
      else if (entry.isFile()) result.push(candidate)
    }
  }
  await visit(rootDir)
  return result
}

async function walkDirectories(rootDir) {
  const result = []
  const visit = async (current) => {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const candidate = path.join(current, entry.name)
      result.push(candidate)
      await visit(candidate)
    }
  }
  await visit(rootDir)
  return result
}

export async function findBundleArtifacts(bundleDir, platform = process.platform) {
  const files = await walkFiles(bundleDir)
  const byName = (name) => files.find((file) => path.basename(file).toLowerCase() === name)
  if (platform === 'win32') {
    return {
      installer: files.find((file) => /\\nsis\\[^\\]+-setup\.exe$/i.test(file)) ||
        files.find((file) => /-setup\.exe$/i.test(file)),
    }
  }
  if (platform === 'darwin') {
    const directories = await walkDirectories(bundleDir)
    return {
      dmg: files.find((file) => file.toLowerCase().endsWith('.dmg')),
      app: directories.find((directory) => directory.toLowerCase().endsWith('.app')),
    }
  }
  return {
    appImage: files.find((file) => file.toLowerCase().endsWith('.appimage')),
    deb: files.find((file) => file.toLowerCase().endsWith('.deb')),
    binary: byName('papyrus'),
  }
}

export function requireBundleArtifacts(artifacts, platform) {
  if (platform === 'win32') {
    if (!artifacts.installer) throw new Error('Windows NSIS installer was not found')
    return artifacts
  }

  if (platform === 'darwin') {
    if (!artifacts.app) throw new Error('macOS Papyrus.app bundle was not found')
    if (!artifacts.dmg) throw new Error('macOS DMG was not found')
    return artifacts
  }

  if (!artifacts.appImage) throw new Error('Linux AppImage was not found')
  if (!artifacts.deb) throw new Error('Linux DEB was not found')
  return artifacts
}

export function requireExecutableMetadata(stat, label, platform = process.platform) {
  if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) {
    throw new Error(`${label} is not a regular file`)
  }
  if (platform !== 'win32' && (Number(stat.mode) & 0o111) === 0) {
    throw new Error(`${label} is not executable`)
  }
  return stat
}

export async function requireExecutableFile(filePath, label, platform = process.platform) {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw new Error(`${label} was not found or could not be inspected`)
  }
  requireExecutableMetadata(stat, label, platform)
  return filePath
}

export function processGroupTarget(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('process id must be a positive integer')
  return platform === 'win32' ? pid : -pid
}

export function processSpawnOptions(platform = process.platform) {
  return { detached: platform !== 'win32', windowsHide: true }
}

export async function buildIsolatedEnvironment(outputDir) {
  const runtimeDir = path.join(outputDir, 'runtime')
  const homeDir = path.join(runtimeDir, 'home')
  await fs.mkdir(homeDir, { recursive: true })
  const env = {
    ...process.env,
    PAPYRUS_SMOKE: '1',
    HOME: homeDir,
    APPDATA: path.join(runtimeDir, 'appdata'),
    LOCALAPPDATA: path.join(runtimeDir, 'localappdata'),
    XDG_CONFIG_HOME: path.join(runtimeDir, 'config'),
    XDG_DATA_HOME: path.join(runtimeDir, 'data'),
    XDG_CACHE_HOME: path.join(runtimeDir, 'cache'),
    WEBVIEW2_USER_DATA_FOLDER: path.join(runtimeDir, 'webview2'),
    WEBKIT_DISABLE_COMPOSITING_MODE: '1',
  }
  await Promise.all(
    [env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.WEBVIEW2_USER_DATA_FOLDER]
      .map((directory) => fs.mkdir(directory, { recursive: true })),
  )
  return { env, runtimeDir }
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk}`
  return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      ...processSpawnOptions(process.platform),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(async () => {
          if (settled) return
          timedOut = true
          await terminateProcess(child)
          if (!settled) {
            settled = true
            resolve({ code: null, signal: 'timeout', stdout, stderr })
          }
        }, options.timeoutMs)
      : undefined
    child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => {
      if (timer) clearTimeout(timer)
      if (timedOut) return
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (timer) clearTimeout(timer)
      if (timedOut) return
      if (!settled) {
        settled = true
        resolve({ code, signal, stdout, stderr })
      }
    })
  })
}

async function terminateProcess(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeoutMs: 5000 }).catch(() => undefined)
  } else {
    const signalGroup = (signal) => {
      try {
        process.kill(processGroupTarget(child.pid, process.platform), signal)
        return true
      } catch {
        try {
          child.kill(signal)
          return true
        } catch {
          return false
        }
      }
    }
    signalGroup('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    signalGroup('SIGKILL')
  }
}

async function detachMacVolume(mountPath) {
  let result
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await runCommand('hdiutil', ['detach', mountPath, '-force'], { timeoutMs: 30_000 }).catch((error) => ({
      code: null,
      signal: error instanceof Error ? error.message : String(error),
    }))
    if (result.code === 0) return result
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return result
}

async function observeProcess(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    ...processSpawnOptions(process.platform),
    // GUI wrappers such as xvfb-run and dbus-run-session can outlive the
    // application and keep inherited pipes open. The smoke only needs process
    // liveness, so ignore launch output to guarantee deterministic cleanup.
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
  child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })

  const result = await new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    const timer = setTimeout(() => finish({ alive: child.exitCode === null, code: child.exitCode, signal: null }), options.graceMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      finish({ alive: false, code: null, signal: null, error: error.message })
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      finish({ alive: false, code, signal })
    })
  })
  await terminateProcess(child)
  return { ...result, stdout, stderr }
}

async function findNamedFile(rootDir, name) {
  const files = await walkFiles(rootDir)
  return files.find((file) => path.basename(file).toLowerCase() === name.toLowerCase())
}

async function smokeWindows(bundleDir, outputDir, graceMs) {
  const artifacts = await findBundleArtifacts(bundleDir, 'win32')
  requireBundleArtifacts(artifacts, 'win32')
  const installDir = path.join(outputDir, 'windows-install')
  await fs.mkdir(installDir, { recursive: true })
  let operationError
  try {
    const install = await runCommand(artifacts.installer, ['/S', `/D=${installDir}`], { timeoutMs: 120_000 })
    if (install.code !== 0) throw new Error(`NSIS installer exited with ${install.code ?? install.signal}`)
    const executable = await findNamedFile(installDir, 'papyrus.exe')
    if (!executable) throw new Error('Installed Papyrus.exe was not found')
    const { env } = await buildIsolatedEnvironment(outputDir)
    const launch = await observeProcess(executable, [], { env, graceMs })
    if (!launch.alive) throw new Error(`installed Papyrus.exe exited before smoke window (code=${launch.code ?? 'none'})`)
    return { artifact: artifacts.installer, executable, installCode: install.code, launch }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    let cleanupFailure
    try {
      const uninstall = await runCommand(path.join(installDir, 'uninstall.exe'), ['/S'], { timeoutMs: 30_000 })
      if (uninstall.code !== 0) cleanupFailure = new Error(`Windows uninstall exited with ${uninstall.code ?? uninstall.signal}`)
    } catch (error) {
      cleanupFailure = error
    }
    try {
      await fs.rm(installDir, { recursive: true, force: true })
    } catch (error) {
      cleanupFailure ??= error
    }
    if (cleanupFailure) {
      if (operationError) console.warn(`WARN Windows smoke cleanup failed while preserving original error: ${cleanupFailure.message}`)
      else throw new Error(`Windows smoke cleanup failed: ${cleanupFailure.message}`)
    }
  }
}

async function smokeMac(bundleDir, outputDir, graceMs) {
  const artifacts = await findBundleArtifacts(bundleDir, 'darwin')
  requireBundleArtifacts(artifacts, 'darwin')
  const appExecutable = await findNamedFile(path.join(artifacts.app, 'Contents', 'MacOS'), 'papyrus')
  if (!appExecutable) throw new Error('Papyrus.app executable was not found')
  await requireExecutableFile(appExecutable, 'bundle Papyrus.app executable', 'darwin')
  const appDir = path.join(outputDir, 'macos-app')
  await fs.mkdir(appDir, { recursive: true })
  let sourceApp
  const mountedAt = path.join(outputDir, 'macos-volume')
  let attachAttempted = false
  let operationError
  try {
    await fs.mkdir(mountedAt, { recursive: true })
    attachAttempted = true
    const attach = await runCommand('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountedAt, artifacts.dmg], { timeoutMs: 60_000 })
    if (attach.code !== 0) throw new Error(`hdiutil attach failed with ${attach.code ?? attach.signal}`)
    sourceApp = await findBundleArtifacts(mountedAt, 'darwin').then((value) => value.app)
    if (!sourceApp) throw new Error('DMG did not contain a Papyrus.app bundle')
    const copy = await runCommand('ditto', [sourceApp, path.join(appDir, 'Papyrus.app')], { timeoutMs: 60_000 })
    if (copy.code !== 0) throw new Error(`ditto failed with ${copy.code ?? copy.signal}`)
    sourceApp = path.join(appDir, 'Papyrus.app')
    const executable = await findNamedFile(path.join(sourceApp, 'Contents', 'MacOS'), 'papyrus')
    if (!executable) throw new Error('DMG did not contain a runnable Papyrus.app executable')
    await requireExecutableFile(executable, 'DMG Papyrus.app executable', 'darwin')
    const { env: appEnv } = await buildIsolatedEnvironment(path.join(outputDir, 'macos-app-runtime'))
    const { env: dmgEnv } = await buildIsolatedEnvironment(path.join(outputDir, 'macos-dmg-runtime'))
    const appLaunch = await observeProcess(appExecutable, [], { env: appEnv, graceMs })
    if (!appLaunch.alive) throw new Error(`bundle Papyrus.app exited before smoke window (code=${appLaunch.code ?? 'none'})`)
    const dmgLaunch = await observeProcess(executable, [], { env: dmgEnv, graceMs })
    if (!dmgLaunch.alive) throw new Error(`DMG Papyrus.app exited before smoke window (code=${dmgLaunch.code ?? 'none'})`)
    return {
      artifact: artifacts.dmg,
      app: artifacts.app,
      dmg: artifacts.dmg,
      appExecutable,
      executable,
      appLaunch,
      dmgLaunch,
      launch: dmgLaunch,
    }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    if (attachAttempted) {
      const detach = await detachMacVolume(mountedAt)
      if (!operationError && detach.code !== 0) {
        throw new Error(`hdiutil detach failed with ${detach.code ?? detach.signal}`)
      }
      if (operationError && detach.code !== 0) {
        console.warn(`WARN hdiutil detach failed while preserving original error: ${detach.code ?? detach.signal}`)
      }
    }
  }
}

async function smokeLinux(bundleDir, outputDir, graceMs) {
  const artifacts = await findBundleArtifacts(bundleDir, 'linux')
  requireBundleArtifacts(artifacts, 'linux')
  const extractDir = path.join(outputDir, 'linux-deb')
  let debInfo
  await fs.mkdir(extractDir, { recursive: true })
  debInfo = await runCommand('dpkg-deb', ['--info', artifacts.deb], { timeoutMs: 30_000 })
  if (debInfo.code !== 0) throw new Error(`dpkg-deb --info failed with ${debInfo.code ?? debInfo.signal}`)
  const extract = await runCommand('dpkg-deb', ['--extract', artifacts.deb, extractDir], { timeoutMs: 60_000 })
  if (extract.code !== 0) throw new Error(`dpkg-deb --extract failed with ${extract.code ?? extract.signal}`)
  const debBinary = await findNamedFile(path.join(extractDir, 'usr', 'bin'), 'papyrus')
  if (!debBinary) throw new Error('Linux DEB did not contain a Papyrus binary')
  await requireExecutableFile(artifacts.appImage, 'Linux AppImage', 'linux')
  await requireExecutableFile(debBinary, 'Linux DEB Papyrus binary', 'linux')
  const appImage = artifacts.appImage
  const launchTarget = async (target, targetArgs) => {
    const runtimeName = target === appImage ? 'linux-appimage-runtime' : 'linux-deb-runtime'
    const { env } = await buildIsolatedEnvironment(path.join(outputDir, runtimeName))
    const runner = process.env.DISPLAY
      ? ['dbus-run-session', '--', target, ...targetArgs]
      : ['xvfb-run', '-a', 'dbus-run-session', '--', target, ...targetArgs]
    const command = runner.shift()
    return observeProcess(command, runner, { env, graceMs })
  }
  const appImageLaunch = await launchTarget(appImage, ['--appimage-extract-and-run'])
  if (!appImageLaunch.alive) throw new Error(`Linux AppImage exited before smoke window (code=${appImageLaunch.code ?? 'none'})`)
  const debLaunch = await launchTarget(debBinary, [])
  if (!debLaunch.alive) throw new Error(`Linux DEB binary exited before smoke window (code=${debLaunch.code ?? 'none'})`)
  return {
    artifact: appImage,
    appImage,
    deb: artifacts.deb,
    debBinary,
    debInfo,
    appImageLaunch,
    debLaunch,
    launch: appImageLaunch,
  }
}

export async function runBundleSmoke(options) {
  const outputDir = await prepareOutputDirectory(options.outputDir, options.bundleDir)
  const platform = process.platform
  const smoke = platform === 'win32'
    ? smokeWindows
    : platform === 'darwin'
      ? smokeMac
      : smokeLinux
  const result = await smoke(options.bundleDir, outputDir, options.graceMs)
  const summary = { status: 'pass', platform, bundleDir: options.bundleDir, outputDir, ...result }
  await fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) return
  try {
    const summary = await runBundleSmoke(options)
    console.log(`PASS hosted bundle smoke (${summary.platform}; process alive for ${options.graceMs}ms)`)
  } catch (error) {
    const summary = {
      status: 'fail',
      platform: process.platform,
      bundleDir: options.bundleDir,
      error: error instanceof Error ? error.message : String(error),
    }
    try {
      const outputDir = validateOutputDirectory(options.outputDir, options.bundleDir)
      await assertNoSymlinkAncestors(outputDir, [ROOT, process.cwd(), options.bundleDir])
      const marker = path.join(outputDir, OUTPUT_MARKER)
      const outputStat = await fs.lstat(outputDir)
      if (outputStat.isDirectory() && !outputStat.isSymbolicLink() && await hasOwnedSmokeMarker(marker)) {
        await fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
      }
    } catch {
      // Never create or mutate an unvalidated failure-output path.
    }
    console.error(`FAIL hosted bundle smoke: ${summary.error}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
