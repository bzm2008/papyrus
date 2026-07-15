#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_GRACE_MS = 10_000
const MAX_OUTPUT = 128 * 1024

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
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM')
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
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (timer) clearTimeout(timer)
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
    child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

async function observeProcess(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
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
  if (!artifacts.installer) throw new Error('Windows NSIS installer was not found')
  const installDir = path.join(outputDir, 'windows-install')
  await fs.mkdir(installDir, { recursive: true })
  try {
    const install = await runCommand(artifacts.installer, ['/S', `/D=${installDir}`], { timeoutMs: 120_000 })
    if (install.code !== 0) throw new Error(`NSIS installer exited with ${install.code ?? install.signal}`)
    const executable = await findNamedFile(installDir, 'papyrus.exe')
    if (!executable) throw new Error('Installed Papyrus.exe was not found')
    const { env } = await buildIsolatedEnvironment(outputDir)
    const launch = await observeProcess(executable, [], { env, graceMs })
    if (!launch.alive) throw new Error(`installed Papyrus.exe exited before smoke window (code=${launch.code ?? 'none'})`)
    return { artifact: artifacts.installer, executable, installCode: install.code, launch }
  } finally {
    await runCommand(path.join(installDir, 'uninstall.exe'), ['/S'], { timeoutMs: 30_000 }).catch(() => undefined)
    await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function smokeMac(bundleDir, outputDir, graceMs) {
  const artifacts = await findBundleArtifacts(bundleDir, 'darwin')
  const appDir = path.join(outputDir, 'macos-app')
  await fs.mkdir(appDir, { recursive: true })
  let sourceApp = artifacts.app
  let mountedAt
  if (artifacts.dmg) {
    mountedAt = path.join(outputDir, 'macos-volume')
    await fs.mkdir(mountedAt, { recursive: true })
    const attach = await runCommand('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountedAt, artifacts.dmg], { timeoutMs: 60_000 })
    if (attach.code !== 0) throw new Error(`hdiutil attach failed with ${attach.code ?? attach.signal}`)
    sourceApp = await findBundleArtifacts(mountedAt, 'darwin').then((value) => value.app)
    if (!sourceApp) throw new Error('DMG did not contain a Papyrus.app bundle')
    const copy = await runCommand('ditto', [sourceApp, path.join(appDir, 'Papyrus.app')], { timeoutMs: 60_000 })
    if (copy.code !== 0) throw new Error(`ditto failed with ${copy.code ?? copy.signal}`)
    sourceApp = path.join(appDir, 'Papyrus.app')
  }
  if (!sourceApp) throw new Error('macOS app or DMG was not found')
  const executable = await findNamedFile(path.join(sourceApp, 'Contents', 'MacOS'), 'papyrus')
  if (!executable) throw new Error('Papyrus.app executable was not found')
  const { env } = await buildIsolatedEnvironment(outputDir)
  try {
    const launch = await observeProcess(executable, [], { env, graceMs })
    if (!launch.alive) throw new Error(`Papyrus.app exited before smoke window (code=${launch.code ?? 'none'})`)
    return { artifact: artifacts.dmg || artifacts.app, executable, launch }
  } finally {
    if (mountedAt) await runCommand('hdiutil', ['detach', mountedAt, '-force'], { timeoutMs: 30_000 }).catch(() => undefined)
  }
}

async function smokeLinux(bundleDir, outputDir, graceMs) {
  const artifacts = await findBundleArtifacts(bundleDir, 'linux')
  if (!artifacts.appImage && !artifacts.deb) throw new Error('Linux AppImage or DEB was not found')
  const extractDir = path.join(outputDir, 'linux-deb')
  let debInfo
  if (artifacts.deb) {
    await fs.mkdir(extractDir, { recursive: true })
    debInfo = await runCommand('dpkg-deb', ['--info', artifacts.deb], { timeoutMs: 30_000 })
    if (debInfo.code !== 0) throw new Error(`dpkg-deb --info failed with ${debInfo.code ?? debInfo.signal}`)
    const extract = await runCommand('dpkg-deb', ['--extract', artifacts.deb, extractDir], { timeoutMs: 60_000 })
    if (extract.code !== 0) throw new Error(`dpkg-deb --extract failed with ${extract.code ?? extract.signal}`)
  }
  const appImage = artifacts.appImage
  const debBinary = artifacts.deb ? await findNamedFile(path.join(extractDir, 'usr', 'bin'), 'papyrus') : undefined
  if (!appImage && !debBinary) throw new Error('Linux package did not contain a runnable Papyrus binary')
  const { env } = await buildIsolatedEnvironment(outputDir)
  const target = appImage || debBinary
  const targetArgs = appImage ? ['--appimage-extract-and-run'] : []
  const runner = process.env.DISPLAY
    ? ['dbus-run-session', '--', target, ...targetArgs]
    : ['xvfb-run', '-a', 'dbus-run-session', '--', target, ...targetArgs]
  const command = runner.shift()
  const launch = await observeProcess(command, runner, { env, graceMs })
  if (!launch.alive) throw new Error(`Linux bundle exited before smoke window (code=${launch.code ?? 'none'})`)
  return { artifact: target, appImage, deb: artifacts.deb, debInfo, launch }
}

export async function runBundleSmoke(options) {
  await fs.rm(options.outputDir, { recursive: true, force: true })
  await fs.mkdir(options.outputDir, { recursive: true })
  const platform = process.platform
  const smoke = platform === 'win32'
    ? smokeWindows
    : platform === 'darwin'
      ? smokeMac
      : smokeLinux
  const result = await smoke(options.bundleDir, options.outputDir, options.graceMs, env)
  const summary = { status: 'pass', platform, bundleDir: options.bundleDir, ...result }
  await fs.writeFile(path.join(options.outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options === null) return
  try {
    const summary = await runBundleSmoke(options)
    console.log(`PASS hosted bundle smoke (${summary.platform}; process alive for ${options.graceMs}ms)`)
  } catch (error) {
    await fs.mkdir(options.outputDir, { recursive: true }).catch(() => undefined)
    const summary = {
      status: 'fail',
      platform: process.platform,
      bundleDir: options.bundleDir,
      error: error instanceof Error ? error.message : String(error),
    }
    await fs.writeFile(path.join(options.outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`).catch(() => undefined)
    console.error(`FAIL hosted bundle smoke: ${summary.error}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
