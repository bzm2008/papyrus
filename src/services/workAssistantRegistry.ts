import type { AssistantRiskLevel, DesktopPlatform } from './workAssistantProtocol'

export type AssistantToolset = 'workspace' | 'desktop' | 'browser' | 'project'
export type AssistantToolExecutor = 'native' | 'project' | 'browser_bridge'

export type AssistantSchemaNode = {
  type: 'object' | 'array' | 'string'
  additionalProperties?: false
  properties?: Record<string, AssistantSchemaNode>
  required?: readonly string[]
  enum?: readonly string[]
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  items?: AssistantSchemaNode
}

export type AssistantToolManifest = {
  name: string
  toolset: AssistantToolset
  executor: AssistantToolExecutor
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
  /**
   * Capability names returned by the native registry. Toolsets are useful for
   * grouping, but a browser registry intentionally exposes read-only web tools
   * before a tab is paired. Keep this filter optional for older callers/tests.
   */
  availableToolNames?: readonly string[]
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

const previewReferenceSchema = (): AssistantSchemaNode => ({
  type: 'object',
  additionalProperties: false,
  properties: { previewId: { type: 'string', minLength: 1 } },
  required: ['previewId'],
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
  { name: 'workspace_list', toolset: 'workspace', executor: 'native', description: 'List available workspace roots.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: emptyObjectSchema() },
  { name: 'workspace_scan', toolset: 'workspace', executor: 'native', description: 'Scan a workspace root for files and folders.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: workspaceRootSchema() },
  { name: 'file_search', toolset: 'workspace', executor: 'native', description: 'Search file names and contents in a workspace root.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { rootId: { type: 'string', minLength: 1 }, query: { type: 'string', minLength: 1 } }, required: ['rootId', 'query'] } },
  { name: 'file_inspect', toolset: 'workspace', executor: 'native', description: 'Inspect a file in a workspace root.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: fileSchema() },
  { name: 'file_plan_batch', toolset: 'workspace', executor: 'native', description: 'Preview a bounded batch of workspace file operations.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: batchSchema() },
  { name: 'file_apply_batch', toolset: 'workspace', executor: 'native', description: 'Apply an existing opaque file-operation preview.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: previewReferenceSchema() },
  { name: 'file_open', toolset: 'workspace', executor: 'native', description: 'Open a workspace file in the system default application.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: fileSchema() },
  { name: 'downloads_scan', toolset: 'workspace', executor: 'native', description: 'Scan an authorized Downloads root.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: workspaceRootSchema() },
  { name: 'desktop_status', toolset: 'desktop', executor: 'native', description: 'Read desktop integration status.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: emptyObjectSchema() },
  { name: 'desktop_open_url', toolset: 'desktop', executor: 'native', description: 'Open a URL using the system default browser.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1 } }, required: ['url'] } },
  { name: 'desktop_open_app', toolset: 'desktop', executor: 'native', description: 'Launch an installed desktop application.', defaultRisk: 'high', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: false, inputSchema: { type: 'object', additionalProperties: false, properties: { appId: { type: 'string', minLength: 1 } }, required: ['appId'] } },
  { name: 'desktop_reveal_file', toolset: 'desktop', executor: 'native', description: 'Reveal a workspace file in the system file manager.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: fileSchema() },
]

const browserElementSchema = () => ({
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    elementToken: { type: 'string' as const, minLength: 1 },
    pageRevision: { type: 'string' as const, minLength: 1 },
    snapshotId: { type: 'string' as const, minLength: 1 },
  },
  required: ['elementToken', 'pageRevision'] as const,
})

export const BROWSER_ASSISTANT_TOOLS: readonly AssistantToolManifest[] = [
  { name: 'web_extract', toolset: 'browser', executor: 'native', description: 'Extract readable text and source links from a public web page.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1 } }, required: ['url'] } },
  { name: 'web_archive', toolset: 'project', executor: 'project', description: 'Archive verified web text into the active Papyrus project resources.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { extractId: { type: 'string', minLength: 1 }, resourceName: { type: 'string', minLength: 1, maxLength: 240 }, url: { type: 'string', minLength: 1 }, title: { type: 'string', maxLength: 240 }, text: { type: 'string', minLength: 1, maxLength: 100000 }, canonicalUrl: { type: 'string', minLength: 1 } }, required: ['extractId', 'resourceName'] } },
  { name: 'browser_open', toolset: 'browser', executor: 'browser_bridge', description: 'Open a public URL in the paired browser tab.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', minLength: 1 } }, required: [] } },
  { name: 'browser_snapshot', toolset: 'browser', executor: 'browser_bridge', description: 'Read an accessibility-limited snapshot of the paired tab.', defaultRisk: 'read', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: false, reversible: true, inputSchema: { type: 'object', additionalProperties: false, properties: { pageRevision: { type: 'string', minLength: 1 } }, required: [] } },
  { name: 'browser_fill_draft', toolset: 'browser', executor: 'browser_bridge', description: 'Fill a normal, non-sensitive field as a user-visible draft.', defaultRisk: 'reversible', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { ...browserElementSchema(), properties: { ...browserElementSchema().properties, value: { type: 'string', maxLength: 2000 } }, required: ['elementToken', 'pageRevision', 'value'] } },
  { name: 'browser_click', toolset: 'browser', executor: 'browser_bridge', description: 'Click a normal semantic element in the paired tab.', defaultRisk: 'high', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: false, inputSchema: browserElementSchema() },
  { name: 'browser_download', toolset: 'browser', executor: 'browser_bridge', description: 'Trigger a confirmed ordinary download in the paired tab.', defaultRisk: 'high', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: true, inputSchema: { ...browserElementSchema(), properties: { ...browserElementSchema().properties, directoryRootId: { type: 'string', minLength: 1 } } } },
  { name: 'browser_submit', toolset: 'browser', executor: 'browser_bridge', description: 'Submit a normal form after a one-time confirmation.', defaultRisk: 'high', supportedPlatforms: ALL_DESKTOP_PLATFORMS, previewRequired: true, reversible: false, inputSchema: browserElementSchema() },
]

export const ALL_WORK_ASSISTANT_TOOLS: readonly AssistantToolManifest[] = [
  ...WORK_ASSISTANT_TOOLS,
  ...BROWSER_ASSISTANT_TOOLS,
]

export function enabledToolDefinitions(input: EnabledToolDefinitionsInput): readonly AssistantToolManifest[] {
  return ALL_WORK_ASSISTANT_TOOLS.filter((tool) => (
    tool.supportedPlatforms.includes(input.platform)
    && input.enabledToolsets.includes(tool.toolset)
    && input.availability[tool.toolset] === true
    // Native workspace/desktop capabilities are reported by capability family
    // (for example file_copy), while browser/project tools are reported by
    // their exact model-facing name. Do not hide core secretary tools merely
    // because the native registry does not enumerate every wrapper name.
    && (input.availableToolNames === undefined
      || (tool.toolset !== 'browser' && tool.toolset !== 'project')
      || input.availableToolNames.includes(tool.name))
  ))
}
