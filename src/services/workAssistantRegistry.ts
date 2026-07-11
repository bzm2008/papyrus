import type { AssistantRiskLevel, DesktopPlatform } from './workAssistantProtocol'

export type AssistantToolset = 'workspace' | 'desktop' | 'browser' | 'project'

export type AssistantSchemaNode = {
  type: 'object' | 'array' | 'string'
  additionalProperties?: false
  properties?: Record<string, AssistantSchemaNode>
  required?: readonly string[]
  enum?: readonly string[]
  minLength?: number
  minItems?: number
  maxItems?: number
  items?: AssistantSchemaNode
}

export type AssistantToolManifest = {
  name: string
  toolset: AssistantToolset
  description: string
  defaultRisk: AssistantRiskLevel
  supportedPlatforms: readonly DesktopPlatform[]
  previewRequired: boolean
  reversible: boolean
  inputSchema: AssistantSchemaNode
}

export type EnabledToolDefinitionsInput = {
  platform: DesktopPlatform
  enabledToolsets: readonly AssistantToolset[]
  availability: Partial<Record<AssistantToolset, boolean>>
}

const ALL_DESKTOP_PLATFORMS = ['windows', 'macos', 'linux'] as const satisfies readonly DesktopPlatform[]

const emptyObjectSchema = (): AssistantSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties: {},
})

const workspaceRootSchema = (): AssistantSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    rootId: { type: 'string', minLength: 1 },
  },
  required: ['rootId'],
})

const fileSchema = (): AssistantSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    rootId: { type: 'string', minLength: 1 },
    path: { type: 'string', minLength: 1 },
  },
  required: ['rootId', 'path'],
})

const batchSchema = (): AssistantSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    rootId: { type: 'string', minLength: 1 },
    conflictPolicy: { type: 'string', enum: ['skip', 'rename', 'overwrite'] },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['copy', 'move', 'rename', 'create_directory', 'trash'] },
          source: { type: 'string', minLength: 1 },
          destination: { type: 'string', minLength: 1 },
        },
        required: ['kind'],
      },
    },
  },
  required: ['rootId', 'conflictPolicy', 'operations'],
})

export const WORK_ASSISTANT_TOOLS: readonly AssistantToolManifest[] = [
  { name: 'workspace_list', toolset: 'workspace', description: 'List available workspace roots.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: emptyObjectSchema() },
  { name: 'workspace_scan', toolset: 'workspace', description: 'Scan a workspace root for files and folders.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: workspaceRootSchema() },
  { name: 'file_search', toolset: 'workspace', description: 'Search file names and contents in a workspace root.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { rootId: { type: 'string', minLength: 1 }, query: { type: 'string', minLength: 1 } }, required: ['rootId', 'query'] } },
  { name: 'file_inspect', toolset: 'workspace', description: 'Inspect a file in a workspace root.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: fileSchema() },
  { name: 'file_plan_batch', toolset: 'workspace', description: 'Preview a bounded batch of workspace file operations.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: batchSchema() },
  { name: 'file_apply_batch', toolset: 'workspace', description: 'Apply a previewed bounded batch of workspace file operations.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: batchSchema() },
  { name: 'file_open', toolset: 'workspace', description: 'Open a workspace file in the system default application.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: fileSchema() },
  { name: 'downloads_scan', toolset: 'desktop', description: 'Scan the local Downloads folder.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: emptyObjectSchema() },
  { name: 'desktop_status', toolset: 'desktop', description: 'Read desktop integration status.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: emptyObjectSchema() },
  { name: 'desktop_open_url', toolset: 'desktop', description: 'Open a URL using the system default browser.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1 } }, required: ['url'] } },
  { name: 'desktop_open_app', toolset: 'desktop', description: 'Launch an installed desktop application.', defaultRisk: 'high', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: false, inputSchema: { type: 'object', additionalProperties: false, properties: { appId: { type: 'string', minLength: 1 } }, required: ['appId'] } },
  { name: 'desktop_reveal_file', toolset: 'desktop', description: 'Reveal a workspace file in the system file manager.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: fileSchema() },
]

export function enabledToolDefinitions(input: EnabledToolDefinitionsInput): readonly AssistantToolManifest[] {
  return WORK_ASSISTANT_TOOLS.filter((tool) => (
    tool.supportedPlatforms.includes(input.platform)
    && input.enabledToolsets.includes(tool.toolset)
    && input.availability[tool.toolset] === true
  ))
}
