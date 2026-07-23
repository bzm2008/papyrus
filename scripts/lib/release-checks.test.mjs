import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { _internal, REQUIRED_COMMANDS, runReleaseChecks } from './release-checks.mjs'

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-release-check-'))
  await fs.mkdir(path.join(rootDir, 'src-tauri'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'src-tauri', 'src'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'dist-browser-bridge'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'docs', 'testing'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    version: '0.1.2',
    app: { security: { csp: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } },
    plugins: { updater: { endpoints: ['https://sca-hub.cn/api/papyrus/update'] } },
  }))
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'Cargo.toml'), '[package]\nversion = "0.1.2"\n')
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'src', 'lib.rs'), REQUIRED_COMMANDS.map((command) => `work_assistant::${command},`).join('\n'))
  await fs.writeFile(path.join(rootDir, 'dist-browser-bridge', 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    version: '0.1.2',
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    host_permissions: ['http://127.0.0.1/*'],
  }))
  await fs.writeFile(path.join(rootDir, 'README.md'), 'Papyrus Work Assistant and Browser Bridge release notes')
  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
    version: '0.1.2',
    scripts: {
      'ci:desktop': 'npm run lint && npm run release:assistant-check',
      'browser:package': 'npm run browser:build && node scripts/package-browser-bridge.mjs',
      'check:browser': 'npm run test:browser && npm run browser:build && cargo test --manifest-path src-tauri/Cargo.toml --locked browser_bridge && cargo test --manifest-path src-tauri/Cargo.toml --locked web_extract',
    },
  }))
  await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
    version: '0.1.2',
    packages: { '': { version: '0.1.2' } },
  }))
  await fs.mkdir(path.join(rootDir, 'apps', 'browser-bridge'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'apps', 'browser-bridge', 'manifest.json'), JSON.stringify({ version: '0.1.2' }))
  await fs.mkdir(path.join(rootDir, 'apps', 'wps-word-addin'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'apps', 'wps-word-addin', 'vite.config.ts'), 'const version = packageJson.version\n')
  await fs.mkdir(path.join(rootDir, 'os-integration', 'debian13'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'os-integration', 'debian13', 'README.md'), 'Papyrus 0.1.2\n')
  await fs.writeFile(path.join(rootDir, 'os-integration', 'debian13', 'install-papyrus.sh'), '# Papyrus 0.1.2\n')
  await fs.writeFile(path.join(rootDir, 'os-integration', 'debian13', 'SHA256SUMS'), 'deadbeef  Papyrus_0.1.1_amd64.deb\n')
  await fs.mkdir(path.join(rootDir, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'scripts', 'check-papyrus-release.ps1'), '$ExpectedVersion = (Get-Content package.json | ConvertFrom-Json).version\n')
  await fs.writeFile(path.join(rootDir, 'scripts', 'build-papyrus-update-manifest.mjs'), 'notes: `Papyrus ${version}`\n')
  for (const relativePath of ['docs/BROWSER_BRIDGE.md', 'docs/testing/WORK_ASSISTANT_PLATFORM_MATRIX.md', 'docs/testing/WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md']) {
    await fs.writeFile(path.join(rootDir, relativePath), '# release evidence')
  }
  await fs.mkdir(path.join(rootDir, '.github', 'workflows'), { recursive: true })
  const desktopWorkflow = `
    on:
      push:
        branches: [main, 'feat/**', 'feature/**']
    matrix: { os: [windows-latest, macos-latest, ubuntu-24.04] }
    - run: npm ci
    - run: npm run ci:desktop
    - run: cargo test --manifest-path src-tauri/Cargo.toml
    - run: cargo check --manifest-path src-tauri/Cargo.toml
    - run: sudo apt-get install -y libwebkit2gtk-4.1-dev
    - run: npm run tauri:check:portable
    - run: npx playwright install --with-deps chromium
    - run: npx playwright install chromium
    - run: npm run test:browser:e2e
  `
  const packageWorkflow = `
    on: { workflow_dispatch: }
    matrix: { os: [windows-latest, macos-latest, ubuntu-24.04] }
    config: src-tauri/ci/windows.json
    artifact: papyrus-windows-smoke
    config: src-tauri/ci/macos.json
    artifact: papyrus-macos-smoke
    config: src-tauri/ci/linux.json
    artifact: papyrus-linux-smoke
    - id: packaged
      run: echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
    - run: npm ci
    - run: npm run ci:desktop
    - run: npm run test:browser:e2e
    - run: npm run browser:package
    - run: npm run tauri -- build --config \${{ matrix.config }}
    - uses: actions/upload-artifact@v4
      with:
        name: \${{ matrix.artifact }}-\${{ steps.packaged.outputs.sha }}
        retention-days: 7
        path: |
          src-tauri/target/release/bundle
          artifacts/browser-bridge/*.zip
    # Production signing runs only in a protected release workflow with credentials.
    # Unsigned smoke artifacts are never presented as production releases.
  `
  await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-ci.yml'), desktopWorkflow)
  await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-packages.yml'), packageWorkflow)
  await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-release.yml'), `
    - run: node scripts/write-debian-checksums.mjs --artifacts release-assets
    - run: npm run browser:build
    - run: npm run release:assistant-check:local
    - run: npm run release:verify-local -- --artifacts release-assets
    - name: Create release
      run: gh release create v0.1.2
    - run: gh release upload v0.1.2
    - run: ./scripts/check-papyrus-release.ps1
  `)
  await fs.mkdir(path.join(rootDir, 'src-tauri', 'ci'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'ci', 'windows.json'), JSON.stringify({ bundle: { targets: ['nsis'], createUpdaterArtifacts: false } }))
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'ci', 'macos.json'), JSON.stringify({ bundle: { targets: ['app', 'dmg'], createUpdaterArtifacts: false } }))
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'ci', 'linux.json'), JSON.stringify({ bundle: { targets: ['deb', 'appimage'], createUpdaterArtifacts: false } }))
  return rootDir
}

async function cleanup(rootDir) {
  await fs.rm(rootDir, { recursive: true, force: true })
}

test('release checks pass for a complete fixture in both phases', async () => {
  const rootDir = await fixture()
  try {
    assert.deepEqual((await runReleaseChecks({ rootDir, phase: 'local' })).failures, [])
    assert.deepEqual((await runReleaseChecks({ rootDir, phase: 'release' })).failures, [])
  } finally {
    await cleanup(rootDir)
  }
})

test('missing extension output fails closed', async () => {
  const rootDir = await fixture()
  try {
    await fs.rm(path.join(rootDir, 'dist-browser-bridge'), { recursive: true, force: true })
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('missing browser bridge build output')))
  } finally {
    await cleanup(rootDir)
  }
})

test('forbidden extension permissions fail closed', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'dist-browser-bridge', 'manifest.json'), JSON.stringify({ permissions: ['cookies'], host_permissions: ['<all_urls>'] }))
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('forbidden permission cookies')))
    assert.ok(report.failures.some((failure) => failure.includes('<all_urls>')))
  } finally {
    await cleanup(rootDir)
  }
})

test('extension output version must match the application package version', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'dist-browser-bridge', 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      version: '0.1.1',
      permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
      host_permissions: ['http://127.0.0.1/*'],
    }))
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('version must match package.json.version')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release checks fail when a desktop version or client OTA endpoint drifts', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
      version: '0.1.1',
      app: { security: { csp: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } },
      plugins: { updater: { endpoints: ['https://scallion.uno/api/papyrus/update'] } },
    }))

    const report = await runReleaseChecks({ rootDir, phase: 'local' })

    assert.ok(report.failures.some((failure) => failure.includes('src-tauri/tauri.conf.json version must match package.json.version')))
    assert.ok(report.failures.some((failure) => failure.includes('client updater must only target https://sca-hub.cn/api/papyrus/update')))
  } finally {
    await cleanup(rootDir)
  }
})

test('OTA endpoint validation requires matching signed HTTPS assets for every platform', () => {
  const canonical = {
    version: '1.1.0',
    platforms: {
      'windows-x86_64': { url: 'https://example.test/Papyrus_1.1.0_x64-setup.exe', signature: 'windows-signature' },
      'linux-x86_64': { url: 'https://example.test/Papyrus_1.1.0_amd64.AppImage', signature: 'linux-signature' },
      'darwin-x86_64': { url: 'https://example.test/Papyrus_1.1.0_x64.app.tar.gz', signature: 'mac-signature' },
      'darwin-aarch64': { url: 'https://example.test/Papyrus_1.1.0_aarch64.app.tar.gz', signature: 'arm-signature' },
    },
  }
  assert.deepEqual(_internal.validateOtaEndpointPair({
    expectedVersion: '1.1.0',
    canonical,
    legacy: structuredClone(canonical),
  }), [])

  const failures = _internal.validateOtaEndpointPair({
    expectedVersion: '1.1.0',
    canonical,
    legacy: {
      version: '1.0.0',
      platforms: {
        'windows-x86_64': { url: 'http://example.test/Papyrus_1.0.0_x64-setup.exe', signature: '' },
      },
    },
  })
  assert.ok(failures.some((failure) => failure.includes('legacy OTA manifest version must match package.json.version')))
  assert.ok(failures.some((failure) => failure.includes('legacy OTA manifest is missing signed HTTPS asset for linux-x86_64')))
})

test('null CSP fails closed', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ app: { security: { csp: null } } }))
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('non-null application CSP')))
  } finally {
    await cleanup(rootDir)
  }
})

test('missing native command registration fails closed', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'src-tauri', 'src', 'lib.rs'), REQUIRED_COMMANDS.slice(0, -1).map((command) => `work_assistant::${command},`).join('\n'))
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('work_assistant_doctor')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase requires all platform workflow entries and overlays', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-ci.yml'), 'windows-latest')
    await fs.rm(path.join(rootDir, 'src-tauri', 'ci', 'linux.json'))
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('desktop-ci.yml is missing macos runner entry')))
    assert.ok(report.failures.some((failure) => failure.includes('desktop-ci.yml is missing linux runner entry')))
    assert.ok(report.failures.some((failure) => failure.includes('missing package overlay: src-tauri/ci/linux.json')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase fails when a workflow has runners but misses required release steps', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-packages.yml'), 'windows-latest macos-latest ubuntu-24.04')
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('desktop-packages.yml must be manually dispatchable')))
    assert.ok(report.failures.some((failure) => failure.includes('desktop-packages.yml must upload smoke artifacts')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase requires the production workflow to run the static release gate', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-release.yml'), '- run: npm run browser:build\n')
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('desktop-release.yml must run the local static release gate')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase requires pre-publish checksum and crypto gates before the remote OTA check', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, '.github', 'workflows', 'desktop-release.yml'), `
      - run: npm run browser:build
      - run: npm run release:assistant-check:local
      - run: gh release upload v0.1.2
      - run: ./scripts/check-papyrus-release.ps1
    `)
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('generate Debian checksums from release assets before creating the GitHub release')))
    assert.ok(report.failures.some((failure) => failure.includes('cryptographically verify local signed updater assets before creating the GitHub release')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase requires the remote OTA check after GitHub release upload', async () => {
  const rootDir = await fixture()
  try {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'desktop-release.yml')
    const workflow = await fs.readFile(workflowPath, 'utf8')
    await fs.writeFile(workflowPath, workflow.replace(
      '- run: gh release upload v0.1.2\n    - run: ./scripts/check-papyrus-release.ps1',
      '- run: ./scripts/check-papyrus-release.ps1\n    - run: gh release upload v0.1.2',
    ))
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('verify published canonical and legacy OTA endpoints only after uploading GitHub release assets')))
  } finally {
    await cleanup(rootDir)
  }
})

test('Debian checksum generation hashes the current 1.1.0 release assets', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-debian-checksum-'))
  try {
    const artifactsDir = path.join(rootDir, 'artifacts')
    const bundleDir = path.join(artifactsDir, 'linux-x86_64', 'release', 'bundle')
    await fs.mkdir(bundleDir, { recursive: true })
    await fs.writeFile(path.join(bundleDir, 'Papyrus_1.1.0_amd64.deb'), 'new-debian-release')
    await fs.writeFile(path.join(bundleDir, 'Papyrus_1.1.0_amd64.AppImage'), 'new-appimage-release')

    const { generateDebianChecksums } = await import('../write-debian-checksums.mjs')
    const output = await generateDebianChecksums({ artifactsDir, version: '1.1.0' })

    assert.deepEqual(output.entries.map((entry) => entry.name), [
      'Papyrus_1.1.0_amd64.deb',
      'Papyrus_1.1.0_amd64.AppImage',
    ])
    assert.equal(output.entries[0].sha256, createHash('sha256').update('new-debian-release').digest('hex'))
    assert.match(output.contents, /Papyrus_1\.1\.0_amd64\.deb/)
    assert.doesNotMatch(output.contents, /Papyrus_1\.0\.0/)
  } finally {
    await cleanup(rootDir)
  }
})

test('release checks reject a static checksum file that claims the current release version', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'os-integration', 'debian13', 'SHA256SUMS'), 'deadbeef  Papyrus_0.1.2_amd64.deb\n')
    const report = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(report.failures.some((failure) => failure.includes('SHA256SUMS must not claim the current package version')))
  } finally {
    await cleanup(rootDir)
  }
})

test('the source Debian checksum file remains the verified 1.0.0 historical manifest', async () => {
  const checksums = await fs.readFile(new URL('../../os-integration/debian13/SHA256SUMS', import.meta.url), 'utf8')

  assert.match(checksums, /^2A6ED8AB5AA65172E9624DB9B05FF14208814DD2381E8D27E05197266088D4EE  Papyrus_1\.0\.0_amd64\.deb$/m)
  assert.match(checksums, /^8B86F8CB1F9E6E39F0A3FEF9E7B36C57EB8700F7899AD4FEBD8344D0D05531B4  Papyrus_1\.0\.0_amd64\.AppImage$/m)
  assert.doesNotMatch(checksums, /Papyrus_1\.1\.0_/)
})

test('local release verification rejects an artifact forged with an unchanged updater signature', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const artifact = Buffer.from('signed release artifact')
  const keyId = Buffer.alloc(8, 7)
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const tauriPublicKey = [
    'untrusted comment: minisign public key',
    Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64'),
  ].join('\n')
  const minisignSignature = [
    'untrusted comment: signature from minisign secret key',
    Buffer.concat([Buffer.from('Ed'), keyId, sign(null, artifact, privateKey)]).toString('base64'),
  ].join('\n')

  const { verifyTauriUpdaterSignature } = await import('../verify-papyrus-release.mjs')

  assert.equal(verifyTauriUpdaterSignature({ artifact, signature: minisignSignature, publicKey: tauriPublicKey }), true)
  assert.equal(
    verifyTauriUpdaterSignature({ artifact: Buffer.from('forged release artifact'), signature: minisignSignature, publicKey: tauriPublicKey }),
    false,
  )
})

test('local release verification reads the Ed25519 updater public key from Tauri config', async () => {
  const { parseTauriUpdaterPublicKey, readTauriUpdaterPublicKey } = await import('../verify-papyrus-release.mjs')

  const tauriPublicKey = await readTauriUpdaterPublicKey()

  assert.equal(typeof tauriPublicKey, 'string')
  assert.equal(parseTauriUpdaterPublicKey(tauriPublicKey).asymmetricKeyType, 'ed25519')
})

test('online OTA verification removes downloaded artifacts in a finally block', async () => {
  const checker = await fs.readFile(new URL('../check-papyrus-release.ps1', import.meta.url), 'utf8')

  assert.match(checker, /try\s*\{[\s\S]*?finally\s*\{\s*Remove-Item -LiteralPath \$tempRoot -Recurse -Force -ErrorAction SilentlyContinue\s*\}/)
})

test('release phase fails when the aggregate script bypasses the release checker', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ scripts: { 'ci:desktop': 'npm run lint', 'browser:package': 'node scripts/package-browser-bridge.mjs' } }))
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('ci:desktop must invoke the release-phase assistant checker')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase fails when the browser check omits web extraction coverage', async () => {
  const rootDir = await fixture()
  try {
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
      scripts: {
        'ci:desktop': 'npm run lint && npm run release:assistant-check',
        'browser:package': 'node scripts/package-browser-bridge.mjs',
        'check:browser': 'cargo test --manifest-path src-tauri/Cargo.toml browser_bridge',
      },
    }))
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('check:browser must run separate browser_bridge and web_extract')))
  } finally {
    await cleanup(rootDir)
  }
})

test('release phase fails when smoke artifacts use the triggering SHA instead of checkout SHA', async () => {
  const rootDir = await fixture()
  try {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'desktop-packages.yml')
    const workflow = await fs.readFile(workflowPath, 'utf8')
    await fs.writeFile(workflowPath, workflow
      .replace('git rev-parse HEAD', 'git status --short')
      .replace('steps.packaged.outputs.sha', 'github.sha'))
    const report = await runReleaseChecks({ rootDir, phase: 'release' })
    assert.ok(report.failures.some((failure) => failure.includes('must resolve the checked-out commit')))
    assert.ok(report.failures.some((failure) => failure.includes('must use the checked-out commit SHA in artifact names')))
  } finally {
    await cleanup(rootDir)
  }
})

test('missing documentation and unknown phase are reported', async () => {
  const rootDir = await fixture()
  try {
    await fs.rm(path.join(rootDir, 'docs', 'BROWSER_BRIDGE.md'))
    const missingDocs = await runReleaseChecks({ rootDir, phase: 'local' })
    assert.ok(missingDocs.failures.some((failure) => failure.includes('docs/BROWSER_BRIDGE.md')))
    const unknown = await runReleaseChecks({ rootDir, phase: 'preview' })
    assert.deepEqual(unknown.failures, ['unknown release check phase: preview'])
  } finally {
    await cleanup(rootDir)
  }
})
