import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'

const root = process.cwd()
const extension = path.join(root, 'apps', 'browser-bridge')

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
