import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'

const root = process.cwd()
const extension = path.join(root, 'apps', 'browser-bridge')

function chromiumExtensionIdFromPublicKey(key) {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)
  return [...digest].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))).join('')
}

test('Browser Bridge manifest is MV3 and uses activeTab injection', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'))
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, packageJson.version)
  assert.ok(manifest.permissions.includes('activeTab'))
  assert.ok(manifest.permissions.includes('scripting'))
  assert.ok(!manifest.permissions.includes('downloads'))
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*'])
  assert.ok(!manifest.host_permissions.some((value) => value.includes('*://*/*') || value.includes('localhost')))
  assert.equal(manifest.content_scripts, undefined)
})

test('Browser Bridge native allowlist matches the bundled Chromium extension key', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'))
  const nativeBridge = await fs.readFile(path.join(root, 'src-tauri', 'src', 'work_assistant', 'browser_bridge.rs'), 'utf8')
  assert.equal(typeof manifest.key, 'string')
  const extensionId = chromiumExtensionIdFromPublicKey(manifest.key)

  assert.match(nativeBridge, new RegExp(`BROWSER_BRIDGE_CHROMIUM_DEVELOPMENT_EXTENSION_ID: &str = "${extensionId}"`))
})

test('Firefox ESR manifest is explicit and keeps the constrained bridge permissions', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.firefox-esr.json'), 'utf8'))
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, packageJson.version)
  assert.equal(manifest.background?.service_worker, 'service_worker.js')
  assert.equal(manifest.browser_specific_settings?.gecko?.id, 'browser-bridge@papyrus.scallion')
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*'])
  assert.ok(!manifest.host_permissions.some((value) => value.includes('*://*/*') || value.includes('localhost')))
})

test('Browser Bridge build emits a separate Firefox ESR manifest output', async () => {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build-browser-bridge.mjs')], { cwd: root, stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
  })
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist-browser-bridge', 'firefox-esr', 'manifest.json'), 'utf8'))
  assert.equal(manifest.browser_specific_settings?.gecko?.id, 'browser-bridge@papyrus.scallion')
})

test('Browser Bridge JavaScript files pass syntax checks', async () => {
  for (const file of ['popup.js', 'service_worker.js', 'content_script.js']) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--check', path.join(extension, file)], { stdio: 'pipe' })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${file}: ${stderr}`)))
    })
  }
})
