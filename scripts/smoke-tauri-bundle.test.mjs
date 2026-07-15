import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { findBundleArtifacts, parseArgs } from './smoke-tauri-bundle.mjs'

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
    await fs.writeFile(path.join(root, 'nsis', 'Papyrus_0.1.2_x64-setup.exe'), '')
    await fs.mkdir(path.join(root, 'macos', 'Papyrus.app', 'Contents', 'MacOS'), { recursive: true })
    await fs.writeFile(path.join(root, 'macos', 'Papyrus.app', 'Contents', 'MacOS', 'papyrus'), '')
    await fs.mkdir(path.join(root, 'dmg'), { recursive: true })
    await fs.writeFile(path.join(root, 'dmg', 'Papyrus_0.1.2_aarch64.dmg'), '')
    await fs.mkdir(path.join(root, 'appimage'), { recursive: true })
    await fs.writeFile(path.join(root, 'appimage', 'Papyrus_0.1.2_amd64.AppImage'), '')
    await fs.mkdir(path.join(root, 'deb'), { recursive: true })
    await fs.writeFile(path.join(root, 'deb', 'Papyrus_0.1.2_amd64.deb'), '')
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
