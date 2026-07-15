import { describe, expect, it } from 'vitest'

import {
  classifyBrowserPage,
  limitBrowserSnapshot,
  riskForBrowserAction,
} from './browserBridgePolicy'

describe('browser bridge policy', () => {
  it('blocks sensitive pages before exposing fields', () => {
    const page = classifyBrowserPage({
      url: 'https://example.com/account/security',
      title: '账户安全验证',
      text: '请输入密码和验证码',
    })
    expect(page.sensitive).toBe(true)
    expect(page.reason).toContain('安全')
  })

  it('bounds snapshots and strips sensitive controls', () => {
    const snapshot = limitBrowserSnapshot({
      url: 'https://example.com',
      title: 'Example',
      text: 'x'.repeat(20_000),
      elements: [
        { token: 'password', role: 'textbox', name: '密码', inputType: 'password', hasValue: true },
        { token: 'title', role: 'textbox', name: '标题', hasValue: true },
        { token: 'submit', role: 'button', name: '保存', hasValue: false },
      ],
    })
    expect(snapshot.text.length).toBeLessThanOrEqual(12_000)
    expect(snapshot.elements.some((item) => item.inputType === 'password')).toBe(false)
    expect(snapshot.elements.some((item) => item.token === 'submit')).toBe(true)
    expect(snapshot.elements[0]).not.toHaveProperty('value')
    expect(snapshot.elements[0]).toHaveProperty('hasValue')
    expect(snapshot.elements[0].hasValue).toBe(true)
  })

  it.each([
    ['https://example.com/verify', 'Verify', 'Enter your one-time code (OTP)'],
    ['https://example.com/autocomplete', 'Checkout', 'autocomplete cc-number'],
    ['https://example.com/password', 'Password', 'new-password current-password'],
    ['https://example.com/pay', 'Checkout', 'Enter card number and bank account'],
    ['http://router.example/admin', 'Admin console', 'Router administration login'],
    ['https://example.com/meta', 'Metadata', 'cloud metadata service credentials'],
  ])('classifies sensitive browser surfaces: %s', (url, title, text) => {
    expect(classifyBrowserPage({ url, title, text }).sensitive).toBe(true)
  })

  it('requires approval for normal submit and blocks dangerous pages', () => {
    expect(riskForBrowserAction('browser_submit', false)).toBe('high')
    expect(riskForBrowserAction('browser_fill_draft', false)).toBe('reversible')
    expect(riskForBrowserAction('browser_click', true)).toBe('blocked')
  })

  it('classifies click semantics conservatively', () => {
    expect(riskForBrowserAction('browser_click', false, 'Next page')).toBe('reversible')
    expect(riskForBrowserAction('browser_click', false, 'Publish article')).toBe('high')
    expect(riskForBrowserAction('browser_click', false, 'Delete account')).toBe('blocked')
    expect(riskForBrowserAction('browser_click', false, 'Unknown control')).toBe('high')
  })
})
