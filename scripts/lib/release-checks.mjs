import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Commands that form the native work-assistant boundary.  Keep this list in one place so the
 * release gate and CI cannot silently drift apart when a command is added to the application.
 */
export const REQUIRED_COMMANDS = [
  'work_assistant_capabilities',
  'work_assistant_list_roots',
  'work_assistant_preview',
  'work_assistant_approve',
  'work_assistant_execute',
  'work_assistant_web_extract',
  'work_assistant_browser_status',
  'work_assistant_browser_start_pairing',
  'work_assistant_browser_snapshot',
  'work_assistant_browser_cancel_run',
  'work_assistant_browser_execute_action',
  'work_assistant_doctor',
]

const FORBIDDEN_EXTENSION_PERMISSIONS = new Set([
  '<all_urls>',
  'cookies',
  'history',
  'debugger',
  'clipboardread',
  'clipboardwrite',
  'nativemessaging',
])

const EXPECTED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' asset: data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]

const DEFAULT_DOCS = [
  'docs/BROWSER_BRIDGE.md',
  'docs/testing/WORK_ASSISTANT_PLATFORM_MATRIX.md',
  'docs/testing/WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md',
]

const RELEASE_WORKFLOWS = [
  '.github/workflows/desktop-ci.yml',
  '.github/workflows/desktop-packages.yml',
]

const PLATFORM_MARKERS = {
  windows: ['windows-latest'],
  macos: ['macos-latest'],
  linux: ['ubuntu-24.04', 'ubuntu-latest'],
}

// Runner names alone do not prove that a workflow exercises the release boundary. Keep these
// markers deliberately small and platform-neutral so the checker works on Windows, macOS, and
// Linux without introducing a YAML parser dependency. The workflow files remain human-readable
// YAML; this is a fail-closed assertion over the commands and artifact policy that must be present.
const WORKFLOW_SEMANTIC_MARKERS = {
  '.github/workflows/desktop-ci.yml': [
    ['run for certification branches', "branches: [main, 'feat/**', 'feature/**']"],
    ['install JavaScript dependencies', 'npm ci'],
    ['run the aggregate desktop checks', 'npm run ci:desktop'],
    ['run Rust tests', 'cargo test --manifest-path src-tauri/Cargo.toml'],
    ['run the Rust check', 'cargo check --manifest-path src-tauri/Cargo.toml'],
    ['install Chromium dependencies on Linux', 'npx playwright install --with-deps chromium'],
    ['install Chromium on macOS and Windows', 'npx playwright install chromium'],
    ['run the real Chromium browser tests', 'npm run test:browser:e2e'],
    ['run the Windows portable check', 'npm run tauri:check:portable'],
    ['install the Linux native dependencies', 'sudo apt-get install -y libwebkit2gtk-4.1-dev'],
  ],
  '.github/workflows/desktop-packages.yml': [
    ['be manually dispatchable', 'workflow_dispatch:'],
    ['map Windows to the NSIS smoke overlay', 'config: src-tauri/ci/windows.json'],
    ['map macOS to the app/DMG smoke overlay', 'config: src-tauri/ci/macos.json'],
    ['map Linux to the DEB/AppImage smoke overlay', 'config: src-tauri/ci/linux.json'],
    ['name the Windows smoke artifact', 'artifact: papyrus-windows-smoke'],
    ['name the macOS smoke artifact', 'artifact: papyrus-macos-smoke'],
    ['name the Linux smoke artifact', 'artifact: papyrus-linux-smoke'],
    ['install JavaScript dependencies', 'npm ci'],
    ['run the aggregate desktop checks', 'npm run ci:desktop'],
    ['run the real Chromium browser tests', 'npm run test:browser:e2e'],
    ['run the Browser Bridge packaging step', 'npm run browser:package'],
    ['build the selected Tauri overlay', 'npm run tauri -- build --config'],
    ['resolve the checked-out commit', 'git rev-parse HEAD'],
    ['upload smoke artifacts', 'uses: actions/upload-artifact@v4'],
    ['retain smoke artifacts for seven days', 'retention-days: 7'],
    ['upload the Tauri bundle directory', 'src-tauri/target/release/bundle'],
    ['exclude the case-colliding Linux AppDir icon', '!src-tauri/target/release/bundle/appimage/Papyrus.AppDir/papyrus.png'],
    ['upload the Browser Bridge ZIP', 'artifacts/browser-bridge/*.zip'],
    ['use the checked-out commit SHA in artifact names', 'name: ${{ matrix.artifact }}-${{ steps.packaged.outputs.sha }}'],
    ['document the protected signing boundary', 'protected release workflow with credentials'],
    ['state that unsigned smoke artifacts are not production releases', 'unsigned smoke artifacts are'],
    ['state that smoke artifacts are never presented as production releases', 'never presented as production releases'],
  ],
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

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
  if (text === null) return { value: null, error: null }
  try {
    return { value: JSON.parse(text), error: null }
  } catch (error) {
    return { value: null, error: `${relativePath}: invalid JSON (${error.message})` }
  }
}

async function pathExists(rootDir, relativePath) {
  try {
    await fs.access(path.join(rootDir, relativePath))
    return true
  } catch {
    return false
  }
}

async function findManifest(rootDir) {
  const outputDir = path.join(rootDir, 'dist-browser-bridge')
  try {
    const files = await fs.readdir(outputDir, { withFileTypes: true })
    for (const entry of files) {
      if (entry.isFile() && entry.name === 'manifest.json') return path.join(outputDir, entry.name)
    }
    // Some extension bundlers place the manifest one level below the output directory.  Keep
    // the walk bounded so a malformed build cannot make a release check traverse the repository.
    for (const entry of files) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const candidate = path.join(outputDir, entry.name, 'manifest.json')
      if (await pathExists(rootDir, path.relative(rootDir, candidate))) return candidate
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return null
}

function flattenManifestPermissions(manifest) {
  const values = []
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'permissions' || key === 'host_permissions' || key === 'optional_permissions') {
        if (Array.isArray(child)) values.push(...child.filter((item) => typeof item === 'string'))
      }
      visit(child)
    }
  }
  visit(manifest)
  return values
}

function checkManifestPermissions(manifest, manifestPath) {
  const failures = []
  const permissions = flattenManifestPermissions(manifest)
  const forbidden = permissions.filter((permission) =>
    FORBIDDEN_EXTENSION_PERMISSIONS.has(permission.toLowerCase()),
  )
  for (const permission of forbidden) {
    failures.push(`extension manifest ${manifestPath} requests forbidden permission ${permission}`)
  }
  const hostPermissions = []
  const collectHosts = (value) => {
    if (!isObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'host_permissions' && Array.isArray(child)) {
        hostPermissions.push(...child.filter((item) => typeof item === 'string'))
      }
      collectHosts(child)
    }
  }
  collectHosts(manifest)
  if (hostPermissions.some((permission) => permission === '<all_urls>')) {
    failures.push(`extension manifest ${manifestPath} requests <all_urls>`)
  }
  return failures
}

async function checkExtensionOutput(rootDir) {
  const failures = []
  const outputDir = path.join(rootDir, 'dist-browser-bridge')
  try {
    const stat = await fs.stat(outputDir)
    if (!stat.isDirectory()) failures.push('dist-browser-bridge is not a directory')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      failures.push('missing browser bridge build output: dist-browser-bridge')
      return failures
    }
    throw error
  }

  const manifestPath = await findManifest(rootDir)
  if (!manifestPath) {
    failures.push('missing browser bridge manifest.json in dist-browser-bridge')
    return failures
  }
  const relativeManifest = path.relative(rootDir, manifestPath)
  const { value, error } = await readJson(rootDir, relativeManifest)
  if (error) failures.push(error)
  else {
    failures.push(...checkManifestPermissions(value, relativeManifest))
    const packageJson = await readJson(rootDir, 'package.json')
    if (packageJson.error) {
      failures.push(packageJson.error)
    } else if (typeof packageJson.value?.version !== 'string' || !packageJson.value.version.trim()) {
      failures.push('package.json.version is required to validate Browser Bridge output')
    } else if (value?.version !== packageJson.value.version) {
      failures.push(`Browser Bridge manifest ${relativeManifest} version must match package.json.version (${packageJson.value.version})`)
    }
  }
  return failures
}

async function checkCsp(rootDir) {
  const failures = []
  const { value, error } = await readJson(rootDir, 'src-tauri/tauri.conf.json')
  if (error) return [error]
  const csp = value?.app?.security?.csp
  if (typeof csp !== 'string' || csp.trim() === '' || csp.trim().toLowerCase() === 'null') {
    return ['src-tauri/tauri.conf.json must define a non-null application CSP']
  }
  for (const directive of EXPECTED_CSP_DIRECTIVES) {
    if (!csp.includes(directive)) failures.push(`application CSP is missing directive: ${directive}`)
  }
  if (/connect-src[^;]*\bwss?:/i.test(csp)) {
    failures.push('application CSP must not expose WebSocket connect-src; Browser Bridge stays in Rust')
  }
  return failures
}

async function checkCommands(rootDir) {
  const text = await readText(rootDir, 'src-tauri/src/lib.rs')
  if (text === null) return ['missing src-tauri/src/lib.rs command registration']
  return REQUIRED_COMMANDS.filter((command) => !text.includes(`work_assistant::${command}`))
    .map((command) => `missing native command registration: ${command}`)
}

async function checkDocumentation(rootDir) {
  const failures = []
  for (const relativePath of DEFAULT_DOCS) {
    if (!(await pathExists(rootDir, relativePath))) failures.push(`missing release documentation: ${relativePath}`)
  }
  const readme = await readText(rootDir, 'README.md')
  if (!readme || !/browser bridge|电脑助手|work assistant/i.test(readme)) {
    failures.push('README.md must document the work assistant/browser bridge release boundary')
  }
  return failures
}

async function checkWorkflow(rootDir, relativePath, requiredMarkers) {
  const text = await readText(rootDir, relativePath)
  if (text === null) return [`missing release workflow: ${relativePath}`]
  const failures = []
  for (const [platform, markers] of Object.entries(requiredMarkers)) {
    if (!markers.some((marker) => text.includes(marker))) {
      failures.push(`${relativePath} is missing ${platform} runner entry`)
    }
  }
  return failures
}

async function checkWorkflowSemantics(rootDir, relativePath, requiredMarkers) {
  const text = await readText(rootDir, relativePath)
  if (text === null) return []
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ')
  return requiredMarkers
    .filter(([, marker]) => !normalizedText.includes(marker.toLowerCase().replace(/\s+/g, ' ')))
    .map(([description, marker]) => `${relativePath} must ${description} (missing: ${marker})`)
}

async function checkReleaseScripts(rootDir) {
  const { value, error } = await readJson(rootDir, 'package.json')
  if (error) return [error]
  if (!value) return ['missing release script manifest: package.json']
  const scripts = value.scripts
  if (!isObject(scripts)) return ['package.json must define npm scripts for release checks']
  const failures = []
  if (typeof scripts['ci:desktop'] !== 'string' || !scripts['ci:desktop'].includes('npm run release:assistant-check')) {
    failures.push('package.json ci:desktop must invoke the release-phase assistant checker')
  }
  if (typeof scripts['browser:package'] !== 'string' || !scripts['browser:package'].includes('package-browser-bridge.mjs')) {
    failures.push('package.json browser:package must invoke deterministic Browser Bridge packaging')
  }
  if (
    typeof scripts['check:browser'] !== 'string' ||
    !scripts['check:browser'].includes('browser_bridge && cargo test') ||
    !scripts['check:browser'].includes('web_extract')
  ) {
    failures.push('package.json check:browser must run separate browser_bridge and web_extract Rust tests')
  }
  return failures
}

async function checkReleaseWorkflows(rootDir) {
  const failures = []
  failures.push(...await checkWorkflow(rootDir, RELEASE_WORKFLOWS[0], PLATFORM_MARKERS))
  failures.push(...await checkWorkflow(rootDir, RELEASE_WORKFLOWS[1], PLATFORM_MARKERS))
  failures.push(...await checkWorkflowSemantics(rootDir, RELEASE_WORKFLOWS[0], WORKFLOW_SEMANTIC_MARKERS[RELEASE_WORKFLOWS[0]]))
  failures.push(...await checkWorkflowSemantics(rootDir, RELEASE_WORKFLOWS[1], WORKFLOW_SEMANTIC_MARKERS[RELEASE_WORKFLOWS[1]]))
  failures.push(...await checkReleaseScripts(rootDir))
  const overlays = {
    'src-tauri/ci/windows.json': ['nsis'],
    'src-tauri/ci/macos.json': ['app', 'dmg'],
    'src-tauri/ci/linux.json': ['deb', 'appimage'],
  }
  for (const [relativePath, targets] of Object.entries(overlays)) {
    const { value, error } = await readJson(rootDir, relativePath)
    if (error) {
      failures.push(error)
      continue
    }
    if (!value) {
      failures.push(`missing package overlay: ${relativePath}`)
      continue
    }
    if (value?.bundle?.createUpdaterArtifacts !== false) {
      failures.push(`${relativePath} must disable updater artifacts for smoke builds`)
    }
    const actualTargets = value?.bundle?.targets
    if (!Array.isArray(actualTargets) || targets.some((target) => !actualTargets.includes(target))) {
      failures.push(`${relativePath} must include bundle targets: ${targets.join(', ')}`)
    }
  }
  return failures
}

/**
 * Run release checks without mutating the repository.  `phase=local` validates the application
 * and browser artifact; `phase=release` additionally requires the complete CI/package matrix.
 */
export async function runReleaseChecks({ rootDir = process.cwd(), phase = 'local' } = {}) {
  if (!['local', 'release'].includes(phase)) {
    return { phase, failures: [`unknown release check phase: ${phase}`] }
  }
  const failures = []
  failures.push(...await checkCsp(rootDir))
  failures.push(...await checkCommands(rootDir))
  failures.push(...await checkExtensionOutput(rootDir))
  failures.push(...await checkDocumentation(rootDir))
  if (phase === 'release') failures.push(...await checkReleaseWorkflows(rootDir))
  return { phase, failures }
}

export const _internal = {
  checkManifestPermissions,
  flattenManifestPermissions,
  checkCsp,
  checkCommands,
  checkDocumentation,
  checkWorkflowSemantics,
  checkReleaseScripts,
  checkReleaseWorkflows,
}
