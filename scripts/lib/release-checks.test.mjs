import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { REQUIRED_COMMANDS, runReleaseChecks } from './release-checks.mjs'

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-release-check-'))
  await fs.mkdir(path.join(rootDir, 'src-tauri'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'src-tauri', 'src'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'dist-browser-bridge'), { recursive: true })
  await fs.mkdir(path.join(rootDir, 'docs', 'testing'), { recursive: true })
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    app: { security: { csp: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } },
  }))
  await fs.writeFile(path.join(rootDir, 'src-tauri', 'src', 'lib.rs'), REQUIRED_COMMANDS.map((command) => `work_assistant::${command},`).join('\n'))
  await fs.writeFile(path.join(rootDir, 'dist-browser-bridge', 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
    host_permissions: ['http://127.0.0.1/*'],
  }))
  await fs.writeFile(path.join(rootDir, 'README.md'), 'Papyrus Work Assistant and Browser Bridge release notes')
  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
    scripts: {
      'ci:desktop': 'npm run lint && npm run release:assistant-check',
      'browser:package': 'npm run browser:build && node scripts/package-browser-bridge.mjs',
      'check:browser': 'npm run test:browser && npm run browser:build && cargo test --manifest-path src-tauri/Cargo.toml --locked browser_bridge && cargo test --manifest-path src-tauri/Cargo.toml --locked web_extract',
    },
  }))
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
