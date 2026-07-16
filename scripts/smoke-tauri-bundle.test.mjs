import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  findBundleArtifacts,
  assertNoSymlinkAncestors,
  prepareOutputDirectory,
  parseArgs,
  processGroupTarget,
  processSpawnOptions,
  readProjectReleaseVersion,
  requireBundleArtifacts,
  requireExecutableMetadata,
  validateOutputDirectory,
} from './smoke-tauri-bundle.mjs'

const CURRENT_RELEASE_VERSION = JSON.parse(
  await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
).version

test('bundle smoke reads the canonical package release version', async () => {
  assert.equal(await readProjectReleaseVersion(), CURRENT_RELEASE_VERSION)
})

test('bundle smoke argument parsing is explicit and bounded', () => {
  const options = parseArgs(['--bundle-dir', 'build/bundle', '--output', 'tmp/smoke', '--grace-ms', '1500'])
  assert.equal(options.graceMs, 1500)
  assert.equal(path.basename(options.bundleDir), 'bundle')
  assert.equal(path.basename(options.outputDir), 'smoke')
  assert.throws(() => parseArgs(['--grace-ms', '99']), /between 1000 and 60000/)
})

test('bundle artifact discovery ignores symlinks and selects platform packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-bundle-artifacts-'))
  try {
    await fs.mkdir(path.join(root, 'nsis'), { recursive: true })
    await fs.writeFile(path.join(root, 'nsis', 'Papyrus_' + CURRENT_RELEASE_VERSION + '_x64-setup.exe'), '')
    await fs.mkdir(path.join(root, 'macos', 'Papyrus.app', 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(root, 'macos', 'Papyrus.app', 'Contents', 'MacOS', 'papyrus'), '')
    await fs.mkdir(path.join(root, 'dmg'), { recursive: true })
    await fs.writeFile(path.join(root, 'dmg', 'Papyrus_' + CURRENT_RELEASE_VERSION + '_aarch64.dmg'), '')
    await fs.mkdir(path.join(root, 'appimage'), { recursive: true })
    await fs.writeFile(path.join(root, 'appimage', 'Papyrus_' + CURRENT_RELEASE_VERSION + '_amd64.AppImage'), '')
    await fs.mkdir(path.join(root, 'deb'), { recursive: true })
    await fs.writeFile(path.join(root, 'deb', 'Papyrus_' + CURRENT_RELEASE_VERSION + '_amd64.deb'), '')
    try {
      await fs.symlink(path.join(root, 'nsis', 'Papyrus_' + CURRENT_RELEASE_VERSION + '_x64-setup.exe'), path.join(root, 'symlink-setup.exe'))
    } catch {
      // Windows test hosts without symlink privileges still exercise regular discovery below.
    }
    const windows = await findBundleArtifacts(root, 'win32')
    const mac = await findBundleArtifacts(root, 'darwin')
    const linux = await findBundleArtifacts(root, 'linux')
    assert.match(windows.installer, /-setup\.exe$/i)
    assert.match(mac.dmg, /\.dmg$/i)
    assert.match(mac.app, /Papyrus\.app$/i)
    assert.match(linux.appImage, /\.appimage$/i)
    assert.match(linux.deb, /\.deb$/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('bundle artifact discovery rejects stale versioned packages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-bundle-version-'))
  try {
    await fs.mkdir(path.join(root, 'nsis'), { recursive: true })
    await fs.mkdir(path.join(root, 'appimage'), { recursive: true })
    await fs.mkdir(path.join(root, 'deb'), { recursive: true })
    await fs.writeFile(path.join(root, 'nsis', 'Papyrus_0.1.2_x64-setup.exe'), '')
    await fs.writeFile(path.join(root, 'nsis', 'Papyrus_1.0.0_x64-setup.exe'), '')
    await fs.writeFile(path.join(root, 'appimage', 'Papyrus_0.1.2_amd64.AppImage'), '')
    await fs.writeFile(path.join(root, 'appimage', 'Papyrus_1.0.0_amd64.AppImage'), '')
    await fs.writeFile(path.join(root, 'deb', 'Papyrus_0.1.2_amd64.deb'), '')
    await fs.writeFile(path.join(root, 'deb', 'Papyrus_1.0.0_amd64.deb'), '')

    const windows = await findBundleArtifacts(root, 'win32', '1.0.0')
    const linux = await findBundleArtifacts(root, 'linux', '1.0.0')
    const missing = await findBundleArtifacts(root, 'win32', '2.0.0')

    assert.match(windows.installer, /Papyrus_1\.0\.0_x64-setup\.exe$/)
    assert.match(linux.appImage, /Papyrus_1\.0\.0_amd64\.AppImage$/)
    assert.match(linux.deb, /Papyrus_1\.0\.0_amd64\.deb$/)
    assert.equal(missing.installer, undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('bundle smoke requires every macOS and Linux target', () => {
  const complete = {
    app: '/bundle/macos/Papyrus.app',
    dmg: '/bundle/dmg/Papyrus.dmg',
    appImage: '/bundle/appimage/Papyrus.AppImage',
    deb: '/bundle/deb/Papyrus.deb',
  }

  assert.deepEqual(requireBundleArtifacts(complete, 'darwin'), complete)
  assert.deepEqual(requireBundleArtifacts(complete, 'linux'), complete)
  assert.throws(() => requireBundleArtifacts({ ...complete, dmg: undefined }, 'darwin'), /DMG was not found/)
  assert.throws(() => requireBundleArtifacts({ ...complete, app: undefined }, 'darwin'), /Papyrus\.app bundle was not found/)
  assert.throws(() => requireBundleArtifacts({ ...complete, appImage: undefined }, 'linux'), /AppImage was not found/)
  assert.throws(() => requireBundleArtifacts({ ...complete, deb: undefined }, 'linux'), /DEB was not found/)
})

test('bundle smoke rejects missing or non-executable static files', () => {
  const regular = { isFile: () => true, mode: 0o755 }
  assert.doesNotThrow(() => requireExecutableMetadata(regular, 'AppImage', 'linux'))
  assert.throws(() => requireExecutableMetadata({ isFile: () => false, mode: 0o755 }, 'DEB', 'linux'), /regular file/)
  assert.throws(() => requireExecutableMetadata({ isFile: () => true, mode: 0o644 }, 'Papyrus.app', 'darwin'), /not executable/)
})

test('bundle smoke uses detached Unix process groups and preserves Windows behavior', () => {
  assert.equal(processGroupTarget(42, 'linux'), -42)
  assert.equal(processGroupTarget(42, 'darwin'), -42)
  assert.equal(processGroupTarget(42, 'win32'), 42)
  assert.deepEqual(processSpawnOptions('linux'), { detached: true, windowsHide: true })
  assert.deepEqual(processSpawnOptions('win32'), { detached: false, windowsHide: true })
})

test('bundle smoke rejects destructive output directory targets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-smoke-output-'))
  const repo = path.join(root, 'repo')
  const bundle = path.join(repo, 'src-tauri', 'target', 'release', 'bundle')
  const safe = path.join(repo, 'artifacts', 'smoke')
  await fs.mkdir(bundle, { recursive: true })
  try {
    assert.equal(validateOutputDirectory(safe, bundle, repo, repo), safe)
    assert.throws(() => validateOutputDirectory(repo, bundle, repo, repo), /protected path/)
    assert.throws(() => validateOutputDirectory(bundle, bundle, repo, repo), /protected path/)
    assert.throws(() => validateOutputDirectory(path.join(bundle, 'nested'), bundle, repo, repo), /inside bundle/)
    assert.throws(() => validateOutputDirectory(path.dirname(repo), bundle, repo, repo), /protected path/)
    assert.throws(() => validateOutputDirectory(path.parse(repo).root, bundle, repo, repo), /filesystem root/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('bundle smoke permits only trusted system-style temporary aliases when the host permits links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-smoke-symlink-'))
  const bundle = path.join(root, 'bundle')
  const systemTempTarget = path.join(root, 'system-temp-target')
  const systemTempAlias = path.join(root, 'system-temp-alias')
  const userControlledTarget = path.join(root, 'user-controlled-target')
  const userControlledLink = path.join(root, 'user-controlled-link')
  const protectedLink = path.join(root, 'protected-link')
  try {
    await fs.mkdir(bundle, { recursive: true })
    await fs.mkdir(systemTempTarget, { recursive: true })
    await fs.mkdir(userControlledTarget, { recursive: true })
    try {
      await fs.symlink(systemTempTarget, systemTempAlias, process.platform === 'win32' ? 'junction' : 'dir')
      await fs.symlink(userControlledTarget, userControlledLink, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }
    await assert.doesNotReject(
      assertNoSymlinkAncestors(path.join(systemTempAlias, 'output'), [], [systemTempAlias]),
    )
    await assert.doesNotReject(
      prepareOutputDirectory(path.join(systemTempAlias, 'approved-output'), bundle, [systemTempAlias]),
    )
    await assert.rejects(
      prepareOutputDirectory(path.join(userControlledLink, 'output'), bundle),
      /untrusted symlink or junction/,
    )

    await fs.symlink(bundle, protectedLink, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(
      assertNoSymlinkAncestors(path.join(protectedLink, 'output'), [bundle], [protectedLink]),
      /protected path/,
    )
    await assert.rejects(
      prepareOutputDirectory(path.join(protectedLink, 'output'), bundle, [protectedLink]),
      /protected path/,
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('bundle smoke only reuses directories carrying its ownership marker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-smoke-marker-'))
  const bundle = path.join(root, 'bundle')
  const output = path.join(root, 'output')
  await fs.mkdir(bundle, { recursive: true })
  try {
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, 'unrelated.txt'), 'keep')
    await assert.rejects(prepareOutputDirectory(output, bundle), /non-empty and is not owned/)
    await fs.rm(output, { recursive: true, force: true })
    await prepareOutputDirectory(output, bundle)
    await fs.writeFile(path.join(output, 'run.txt'), 'old')
    await prepareOutputDirectory(output, bundle)
    assert.equal(await fs.readFile(path.join(output, '.papyrus-bundle-smoke'), 'utf8').then(() => true).catch(() => false), true)
    await assert.rejects(fs.stat(path.join(output, 'run.txt')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
