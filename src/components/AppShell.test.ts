import { describe, expect, it } from 'vitest'

import { shouldShowLegacyLeftSidebar } from './secretaryWorkspaceLayout'

describe('shouldShowLegacyLeftSidebar', () => {
  it('lets secretary mode own the left rail while retaining it for three-column writing mode', () => {
    expect(shouldShowLegacyLeftSidebar('flow', 3)).toBe(false)
    expect(shouldShowLegacyLeftSidebar('companion', 3)).toBe(true)
    expect(shouldShowLegacyLeftSidebar('companion', 2)).toBe(false)
  })
})
