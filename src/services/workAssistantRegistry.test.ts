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

  it('excludes unavailable tools even when their toolset and platform are enabled', () => {
    const tools = enabledToolDefinitions({
      platform: 'windows',
      enabledToolsets: ['desktop'],
      availability: { desktop: false },
    })

    expect(tools.map((tool) => tool.name)).not.toContain('desktop_status')
  })

  it('keeps unpaired browser sessions limited to public extraction and project archiving', () => {
    const tools = enabledToolDefinitions({
      platform: 'windows',
      enabledToolsets: ['browser', 'project'],
      availability: { browser: true, project: true },
      availableToolNames: ['web_extract', 'web_archive'],
    })

    expect(tools.map((tool) => tool.name)).toEqual(['web_extract', 'web_archive'])
    expect(tools.find((tool) => tool.name === 'web_archive')).toMatchObject({
      toolset: 'project',
      executor: 'project',
    })
  })

  it('exposes tab tools only after the native registry reports them available', () => {
    const tools = enabledToolDefinitions({
      platform: 'windows',
      enabledToolsets: ['browser', 'project'],
      availability: { browser: true, project: true },
      availableToolNames: ['web_extract', 'web_archive', 'browser_snapshot', 'browser_submit'],
    })

    expect(tools.map((tool) => tool.name)).toEqual([
      'web_extract',
      'web_archive',
      'browser_snapshot',
      'browser_submit',
    ])
    expect(tools.find((tool) => tool.name === 'browser_submit')?.executor).toBe('browser_bridge')
  })

  it('does not hide native workspace tools when capability names use family ids', () => {
    const tools = enabledToolDefinitions({
      platform: 'windows',
      enabledToolsets: ['workspace', 'desktop'],
      availability: { workspace: true, desktop: true },
      availableToolNames: ['file_copy', 'desktop_status'],
    })
    expect(tools.map((tool) => tool.name)).toContain('workspace_scan')
    expect(tools.map((tool) => tool.name)).toContain('desktop_status')
  })

  it('declares strict object schemas and bounds batch plans', () => {
    for (const tool of WORK_ASSISTANT_TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    }

    const plan = WORK_ASSISTANT_TOOLS.find((tool) => tool.name === 'file_plan_batch')
    if (!plan) {
      throw new Error('file_plan_batch tool definition is missing')
    }

    expect(plan.inputSchema).toMatchObject({
      required: ['rootId', 'conflictPolicy', 'operations'],
      properties: {
        rootId: { type: 'string', minLength: 1 },
        conflictPolicy: { enum: ['skip', 'rename', 'overwrite'] },
        operations: { type: 'array', minItems: 1, maxItems: 200 },
      },
    })

    const properties = plan.inputSchema.properties
    if (!properties || typeof properties !== 'object') {
      throw new Error('file_plan_batch input schema properties are missing')
    }

    const operations = properties.operations
    if (!operations || typeof operations !== 'object' || !('items' in operations)) {
      throw new Error('file_plan_batch operations schema is incomplete')
    }

    expect(operations.items).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: ['copy', 'move', 'rename', 'create_directory', 'trash'] },
        source: { type: 'string', minLength: 1 },
        destination: { type: 'string', minLength: 1 },
      },
    })

    const apply = WORK_ASSISTANT_TOOLS.find((tool) => tool.name === 'file_apply_batch')
    expect(apply?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ['previewId'],
      properties: { previewId: { type: 'string', minLength: 1 } },
    })
    expect(apply?.inputSchema.properties).not.toHaveProperty('operations')

    const downloads = WORK_ASSISTANT_TOOLS.find((tool) => tool.name === 'downloads_scan')
    expect(downloads).toMatchObject({
      toolset: 'workspace',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['rootId'],
        properties: { rootId: { type: 'string', minLength: 1 } },
      },
    })
  })
})
