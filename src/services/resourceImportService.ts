import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import mammoth from 'mammoth'
import { estimateTokens } from './tokenizer'
import { useAppStore, type ImportedResource, type ImportedResourceType } from '../stores/useAppStore'

type ProjectFileEntry = {
  name: string
  path: string
  kind: 'file' | 'folder'
  extension: string
}

export async function importResourceFiles() {
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: 'Writing resources',
        extensions: ['txt', 'md', 'docx', 'html', 'htm'],
      },
    ],
  })

  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []

  if (!paths.length) {
    return
  }

  const resources = await Promise.all(paths.map((path) => readResourceFile(path)))
  useAppStore.getState().addResources(resources.filter(Boolean) as ImportedResource[])
}

export async function openProjectFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
  })

  if (!selected || Array.isArray(selected)) {
    return
  }

  const entries = await invoke<ProjectFileEntry[]>('scan_project_folder', { path: selected })
  const fileEntries = entries.filter((entry) => entry.kind === 'file')
  const folderResources: ImportedResource[] = entries
    .filter((entry) => entry.kind === 'folder')
    .slice(0, 24)
    .map((entry) => createResource(entry.path, entry.name, 'folder', '项目文件夹'))
  const fileResources = await Promise.all(
    fileEntries.slice(0, 48).map((entry) => readResourceFile(entry.path)),
  )

  useAppStore
    .getState()
    .addResources([...folderResources, ...(fileResources.filter(Boolean) as ImportedResource[])])
}

export function insertResourceIntoDocument(resource: ImportedResource) {
  useAppStore.getState().setPendingDocumentPatch({
    operation: 'append_section',
    title: `插入资料：${resource.name}`,
    content: resource.content,
  })
}

async function readResourceFile(path: string): Promise<ImportedResource | null> {
  const name = filenameFromPath(path)
  const type = typeFromPath(path)

  try {
    if (type === 'docx') {
      const bytes = await invoke<number[]>('read_binary_file', { path })
      const arrayBuffer = new Uint8Array(bytes).buffer
      const result = await mammoth.extractRawText({ arrayBuffer })
      return createResource(path, name, type, result.value)
    }

    const raw = await invoke<string>('read_text_file', { path })
    const content = type === 'html' ? stripHtml(raw) : raw
    return createResource(path, name, type, content)
  } catch (error) {
    useAppStore.getState().addFlowTrace({
      kind: 'tool',
      title: '资源导入失败',
      detail: `${name}：${error instanceof Error ? error.message : '无法读取文件'}`,
      status: 'error',
      toolName: 'resource.import',
      endedAt: Date.now(),
    })
    return null
  }
}

function createResource(
  path: string,
  name: string,
  type: ImportedResourceType,
  content: string,
): ImportedResource {
  const normalized = content.trim()

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `resource-${Date.now()}`,
    name,
    path,
    type,
    content: normalized,
    tokenCount: estimateTokens(normalized),
    includedInContext: type !== 'folder',
    importedAt: Date.now(),
  }
}

function filenameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function typeFromPath(path: string): ImportedResourceType {
  const extension = path.split('.').at(-1)?.toLowerCase()

  if (extension === 'txt' || extension === 'md' || extension === 'docx' || extension === 'html') {
    return extension
  }

  if (extension === 'htm') {
    return 'html'
  }

  return 'unknown'
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
