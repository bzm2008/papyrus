import { describe, expect, it } from 'vitest'

import { approvalChoices, effectiveRisk, scopeAllows } from './workAssistantPolicy'

describe('effectiveRisk', () => {
  it('uses the higher preview risk and fails closed for unknown input', () => {
    expect(effectiveRisk('read', 'reversible')).toBe('reversible')
    expect(effectiveRisk('high', 'read')).toBe('high')
    expect(effectiveRisk('read', 'unexpected')).toBe('blocked')
  })
})

describe('approvalChoices', () => {
  it('returns the exact allowed choices for every risk level', () => {
    expect(approvalChoices('read')).toEqual([])
    expect(approvalChoices('reversible')).toEqual(['once', 'run', 'deny'])
    expect(approvalChoices('high')).toEqual(['once', 'deny'])
    expect(approvalChoices('blocked')).toEqual(['deny'])
  })
})

describe('scopeAllows', () => {
  const boundedScope = {
    toolName: 'file_apply_batch',
    rootId: 'workspace-a',
    targetParent: 'workspace-a/drafts',
    conflictPolicy: 'rename',
    operationKind: 'copy',
    maxOperations: 4,
  } as const

  it('allows an equal or narrower matching scope', () => {
    expect(scopeAllows(boundedScope, { ...boundedScope, maxOperations: 3 })).toBe(true)
  })

  it('rejects a changed target directory or a larger operation bound', () => {
    expect(scopeAllows(boundedScope, { ...boundedScope, targetParent: 'workspace-a/archive' })).toBe(false)
    expect(scopeAllows(boundedScope, { ...boundedScope, maxOperations: 5 })).toBe(false)
  })

  it.each([
    { operationKind: 'trash' },
    { conflictPolicy: 'overwrite' },
    { toolName: 'desktop_open_app' },
    { toolName: 'browser_download' },
    { toolName: 'external_navigation' },
    { toolName: 'send' },
    { toolName: 'publish' },
    { toolName: 'submit' },
    { operationKind: 'delete' },
  ])('rejects dangerous run-scoped operation %#', (unsafeChange) => {
    expect(scopeAllows(boundedScope, { ...boundedScope, ...unsafeChange })).toBe(false)
  })
})
