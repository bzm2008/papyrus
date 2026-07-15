#!/usr/bin/env node

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { ZipArchive } from 'archiver'

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function listFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = path.resolve(currentDir, entry.name)
    if (!isWithin(rootDir, absolutePath)) throw new Error(`browser bridge path escapes build directory: ${absolutePath}`)
    const stat = await fs.lstat(absolutePath)
    if (stat.isSymbolicLink()) throw new Error(`browser bridge build must not contain symlinks: ${absolutePath}`)
    if (stat.isDirectory()) {
      files.push(...await listFiles(rootDir, absolutePath))
    } else if (stat.isFile()) {
      const realPath = await fs.realpath(absolutePath)
      if (!isWithin(rootDir, realPath)) throw new Error(`browser bridge file resolves outside build directory: ${absolutePath}`)
      files.push({ absolutePath, relativePath: path.relative(rootDir, absolutePath).split(path.sep).join('/') })
    } else {
      throw new Error(`unsupported browser bridge filesystem entry: ${absolutePath}`)
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function zipFiles(files, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    const appendAll = async () => {
      try {
        for (const file of files) {
          const contents = await fs.readFile(file.absolutePath)
          archive.append(contents, { name: file.relativePath, date: new Date(0), mode: 0o644 })
        }
        await archive.finalize()
      } catch (error) {
        archive.destroy()
        reject(error)
      }
    }
    void appendAll()
  })
}

async function parseArgs(argv) {
  let rootDir = process.cwd()
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') {
      rootDir = path.resolve(argv[index + 1] ?? '')
      index += 1
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      console.log('Usage: node scripts/package-browser-bridge.mjs [--root path]')
      return null
    } else {
      throw new Error(`unknown argument: ${argv[index]}`)
    }
  }
  return rootDir
}

const rootDir = await parseArgs(process.argv.slice(2))
if (rootDir === null) process.exit(0)

try {
  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'))
  const version = typeof packageJson.version === 'string' && packageJson.version.trim() ? packageJson.version.trim() : null
  if (!version) throw new Error('package.json.version is required for Browser Bridge packaging')

  const buildDir = path.resolve(rootDir, 'dist-browser-bridge')
  const artifactDir = path.resolve(rootDir, 'artifacts', 'browser-bridge')
  const expectedArtifactDir = path.resolve(rootDir, 'artifacts', 'browser-bridge')
  if (artifactDir !== expectedArtifactDir || !isWithin(rootDir, artifactDir)) throw new Error('refusing to delete an unexpected artifact path')
  const buildEntry = await fs.lstat(buildDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (buildEntry?.isSymbolicLink()) throw new Error('dist-browser-bridge must not be a symlink')
  const artifactEntry = await fs.lstat(artifactDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (artifactEntry?.isSymbolicLink()) throw new Error('artifacts/browser-bridge must not be a symlink')
  const buildStat = await fs.stat(buildDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!buildStat?.isDirectory()) throw new Error('missing dist-browser-bridge; run browser:build first')

  await fs.rm(artifactDir, { recursive: true, force: true })
  await fs.mkdir(artifactDir, { recursive: true })
  const files = await listFiles(buildDir)
  if (files.length === 0) throw new Error('dist-browser-bridge contains no files')
  const archivePath = path.join(artifactDir, `Papyrus-Browser-Bridge_${version}.zip`)
  await zipFiles(files, archivePath)
  const archiveStat = await fs.stat(archivePath)
  if (archiveStat.size < 1) throw new Error('Browser Bridge archive is empty')
  console.log(`PASS packaged ${files.length} files -> ${path.relative(rootDir, archivePath)}`)
} catch (error) {
  console.error(`FAIL browser bridge package: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
