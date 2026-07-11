import { describe, expect, it } from 'vitest'

import { WORK_ASSISTANT_TOOLS, enabledToolDefinitions } from './workAssistantRegistry'

describe('WORK_ASSISTANT_TOOLS', () => {
  it('contains only the controlled workspace and desktop tools', () => {
    expect(WORK_ASSISTANT_TOOLS.map((tool) => tool.name)).toEqual([
      'workspace_list',
      'workspace_scan',
      'file_search',
      'file_inspect',
      'file_plan_batch',
      'file_apply_batch',
      'file_open',
      'downloads_scan',
      'desktop_status',
      'desktop_open_url',
      'desktop_open_app',
      'desktop_reveal_file',
    ])
  })

  it('filters tools by platform, enabled toolsets, and availability', () => {
    const tools = enabledToolDefinitions({
      platform: 'linux',
      enabledToolsets: ['workspace', 'project'],
      availability: { workspace: true, desktop: true, browser: false, project: true },
    })

    expect(tools.map((tool) => tool.name)).toContain('workspace_scan')
    expect(tools.map((tool) => tool.name)).not.toContain('desktop_open_app')
    expect(tools.map((tool) => tool.name)).not.toContain('browser_snapshot')
  })

  it('declares strict object schemas and bounds batch plans', () => {
    for (const tool of WORK_ASSISTANT_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }

    const plan = WORK_ASSISTANT_TOOLS.find((tool) => tool.name === 'file_plan_batch')
    expect(plan?.inputSchema).toMatchObject({
      required: ['rootId', 'conflictPolicy', 'operations'],
      properties: {
        rootId: { type: 'string', minLength: 1 },
        conflictPolicy: { enum: ['skip', 'rename', 'overwrite'] },
        operations: { type: 'array', minItems: 1, maxItems: 200 },
      },
    })
    expect(plan?.inputSchema.properties.operations.items).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: ['copy', 'move', 'rename', 'create_directory', 'trash'] },
        source: { type: 'string', minLength: 1 },
        destination: { type: 'string', minLength: 1 },
      },
    })
  })
})
