import { useAppStore, type ImportedResource } from '../stores/useAppStore'

export const AUTHORIZED_WORKSPACE_IMPORT_MESSAGE =
  '文件导入现在需要已授权的工作区。请先添加工作区，然后从该工作区选择文件。'

export async function importResourceFiles(): Promise<never> {
  throw new Error(AUTHORIZED_WORKSPACE_IMPORT_MESSAGE)
}

export async function openProjectFolder(): Promise<never> {
  throw new Error(AUTHORIZED_WORKSPACE_IMPORT_MESSAGE)
}

export function insertResourceIntoDocument(resource: ImportedResource) {
  useAppStore.getState().setPendingDocumentPatch({
    operation: 'append_section',
    title: `插入资料：${resource.name}`,
    content: resource.content,
  })
}
