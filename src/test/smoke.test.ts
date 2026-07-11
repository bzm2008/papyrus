import { describe, expect, it } from 'vitest'

describe('desktop test harness', () => {
  it('runs TypeScript tests in jsdom', () => {
    expect(document.createElement('div')).toBeInstanceOf(HTMLDivElement)
  })
})
