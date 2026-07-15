import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cargoArgs = process.argv.slice(2)
const command = process.platform === 'win32' ? 'powershell' : 'cargo'
const args = process.platform === 'win32'
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'scripts', 'with-portable-msvc.ps1'), ...cargoArgs]
  : [...cargoArgs, '--manifest-path', path.join(projectRoot, 'src-tauri', 'Cargo.toml')]

const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
