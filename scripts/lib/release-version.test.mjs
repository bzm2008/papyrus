import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { inspectReleaseVersion, synchronizeReleaseVersion } from './release-version.mjs'

async function fixture(version = '1.0.0') {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-release-version-'))
  await fs.mkdir(path.join(rootDir, 'src-tauri'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'apps', 'browser-bridge'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ version }, null, 2))
  await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
    name: 'papyrus',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'papyrus', version } },
  }, null, 2))
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), `[package]\nname = "papyrus"\nversion = "${version}"\nedition = "2021"\n`)
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'Cargo.lock'), `version = 4\n\n[[package]]\nname = "papyrus"\nversion = "${version}"\n`)
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ productName: 'Papyrus', version }, null, 2))
  await fs.writeFile(path.join(rootDir, 'apps', 'browser-bridge', 'manifest.json'), JSON.stringify({ manifest_version: 3, version }, null, 2))
  return rootDir
}

async function cleanup(rootDir) {
  await fs.rm(rootDir, { recursive: true, force: true })
}

test('reports release metadata that drifts from package.json', async () => {
  const rootDir = await fixture()
  try {
    const tauriPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')
    await fs.writeFile(tauriPath, JSON.stringify({ productName: 'Papyrus', version: '0.1.2' }, null, 2))

    const report = await inspectReleaseVersion({ rootDir })

    assert.equal(report.version, '1.0.0')
    assert.ok(report.failures.some((failure) => failure.includes('src-tauri/tauri.conf.json version must match package.json.version')))
  } finally {
    await cleanup(rootDir)
  }
})

test('synchronizes every release version mirror from package.json', async () => {
  const rootDir = await fixture('1.0.0')
  try {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
      name: 'papyrus',
      version: '0.1.2',
      lockfileVersion: 3,
      packages: { '': { name: 'papyrus', version: '0.1.2' } },
    }, null, 2))
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), '[package]\nname = "papyrus"\nversion = "0.1.2"\nedition = "2021"\n')
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "papyrus"\nversion = "0.1.2"\n')
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ productName: 'Papyrus', version: '0.1.2' }, null, 2))
    await fs.writeFile(path.join(rootDir, 'apps', 'browser-bridge', 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.1.2' }, null, 2))

    const report = await synchronizeReleaseVersion({ rootDir })

    assert.deepEqual(report.failures, [])
    assert.equal(JSON.parse(await fs.readFile(path.join(rootDir, 'package-lock.json'), 'utf8')).version, '1.0.0')
    assert.match(await fs.readFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8'), /version = "1\.0\.0"/)
    assert.match(await fs.readFile(path.join(rootDir, 'src-tauri', 'Cargo.lock'), 'utf8'), /name = "papyrus"\nversion = "1\.0\.0"/)
    assert.equal(JSON.parse(await fs.readFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8')).version, '1.0.0')
    assert.equal(JSON.parse(await fs.readFile(path.join(rootDir, 'apps', 'browser-bridge', 'manifest.json'), 'utf8')).version, '1.0.0')
  } finally {
    await cleanup(rootDir)
  }
})

test('preserves unrelated JSON formatting while synchronizing a release version', async () => {
  const rootDir = await fixture('1.0.0')
  try {
    const manifestPath = path.join(rootDir, 'apps', 'browser-bridge', 'manifest.json')
    await fs.writeFile(manifestPath, '{\n  "manifest_version": 3,\n  "version": "0.1.2",\n  "permissions": ["tabs", "activeTab"]\n}\n')

    const report = await synchronizeReleaseVersion({ rootDir })

    assert.deepEqual(report.failures, [])
    assert.equal(
      await fs.readFile(manifestPath, 'utf8'),
      '{\n  "manifest_version": 3,\n  "version": "1.0.0",\n  "permissions": ["tabs", "activeTab"]\n}\n',
    )
  } finally {
    await cleanup(rootDir)
  }
})

test('rejects a non-stable package version before changing release metadata', async () => {
  const rootDir = await fixture('1.0.0-beta.1')
  try {
    const report = await synchronizeReleaseVersion({ rootDir })

    assert.ok(report.failures.some((failure) => failure.includes('package.json.version must be a stable numeric release version')))
    assert.match(await fs.readFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8'), /version = "1\.0\.0-beta\.1"/)
  } finally {
    await cleanup(rootDir)
  }
})
