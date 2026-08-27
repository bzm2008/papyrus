import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'

const script = path.join(process.cwd(), 'scripts', 'build-papyrus-update-manifest.mjs')

async function runManifest(artifacts) {
  const output = path.join(artifacts, 'latest.json')
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--artifacts', artifacts, '--version', '1.1.0', '--output', output], { cwd: process.cwd(), stdio: 'pipe' })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

test('manifest builder rejects a signed Linux AppImage when the binary is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papyrus-manifest-'))
  try {
    const assets = {
      'Papyrus_1.1.0_x64-setup.exe': 'windows-x86_64',
      'Papyrus_1.1.0_x86_64.app.tar.gz': 'darwin-x86_64',
      'Papyrus_1.1.0_aarch64.app.tar.gz': 'darwin-aarch64',
    }
    for (const file of Object.keys(assets)) {
      await fs.writeFile(path.join(root, file), 'asset')
      await fs.writeFile(path.join(root, `${file}.sig`), 'signature')
    }
    await fs.writeFile(path.join(root, 'Papyrus_1.1.0.AppImage.sig'), 'signature')
    const result = await runManifest(root)
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /missing signed updater asset|AppImage/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
