import { expect, test } from '@playwright/test'

import {
  elementByName,
  installProductionBridge,
  request,
  snapshot,
  staleResult,
  type ProductionActionResult,
} from './bridge-fixture'

test.describe('Browser Bridge production content script', () => {
  test('fills input, textarea, and contenteditable drafts with input/change events', async ({ page }) => {
    await installProductionBridge(page)

    let current = await snapshot(page)
    const title = elementByName(current, 'Title')
    let result = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: title.token,
      value: 'Quarterly plan',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(true)
    expect(await page.locator('#title').inputValue()).toBe('Quarterly plan')

    current = await snapshot(page)
    const defaultInput = elementByName(current, 'Default input')
    result = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: defaultInput.token,
      value: 'Default text input',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(true)
    expect(await page.locator('#default-input').inputValue()).toBe('Default text input')

    current = await snapshot(page)
    const summary = elementByName(current, 'Summary')
    result = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: summary.token,
      value: 'A concise summary',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(true)
    expect(await page.locator('#summary').inputValue()).toBe('A concise summary')

    current = await snapshot(page)
    const notes = current.elements.find((element) => element.name === 'Notes')
    expect(notes, 'contenteditable must be present in the production snapshot').toBeTruthy()
    result = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: notes!.token,
      value: 'Notes from the meeting',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(true)
    await expect(page.locator('#notes')).toHaveText('Notes from the meeting')

    await expect.poll(() => page.evaluate(() => window.__events)).toEqual({
      title: { input: 1, change: 1 },
      summary: { input: 1, change: 1 },
      notes: { input: 1, change: 1 },
    })

    await page.locator('#title').fill('private draft value')
    const noValues = await snapshot(page)
    expect(noValues.elements.find((element) => element.name === 'Title')).not.toHaveProperty('value')
    expect(noValues.elements.find((element) => element.name === 'Title')).toMatchObject({ hasValue: true })
    expect(noValues.elements.some((element) => element.name === 'Hidden field')).toBe(false)
  })

  test('clicks a controlled element and rejects disabled controls', async ({ page }) => {
    await installProductionBridge(page)
    const current = await snapshot(page)
    const next = elementByName(current, 'Next')
    const clickResult = await request<ProductionActionResult>(page, 'click', {
      elementToken: next.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(clickResult.ok).toBe(true)
    await expect(page.locator('#clicked')).toHaveText('clicked')

    // The click changed the page revision; actions must use a fresh snapshot.
    const afterClick = await snapshot(page)
    const disabled = elementByName(afterClick, 'Disabled field')
    const disabledResult = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: disabled.token,
      value: 'must not change',
      pageRevision: afterClick.pageRevision,
      snapshotId: afterClick.snapshotId,
    })
    expect(disabledResult.ok).toBe(false)
    expect(disabledResult.errorCode).toMatch(/disabled|restricted|blocked/)
    expect(await page.locator('#disabled-input').inputValue()).toBe('')
  })

  test('invalidates an old snapshot when a field value changes without a navigation', async ({ page }) => {
    await installProductionBridge(page)
    const current = await snapshot(page)
    const title = elementByName(current, 'Title')

    const fillResult = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: title.token,
      value: 'Changed after preview',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(fillResult.ok).toBe(true)

    const staleClick = await request<ProductionActionResult>(page, 'click', {
      elementToken: title.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(staleClick.errorCode).toMatch(/stale_page|stale_snapshot/)
  })

  test('triggers a normal download and submits an ordinary form', async ({ page }) => {
    await installProductionBridge(page)

    let current = await snapshot(page)
    const downloadElement = elementByName(current, 'Download report')
    const downloadPromise = page.waitForEvent('download')
    const downloadResult = await request<ProductionActionResult>(page, 'download', {
      elementToken: downloadElement.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    const download = await downloadPromise
    expect(downloadResult.ok).toBe(true)
    expect(download.suggestedFilename()).toBe('sample.txt')

    current = await snapshot(page)
    const submit = elementByName(current, 'Save draft')
    const submitResult = await request<ProductionActionResult>(page, 'submit', {
      elementToken: submit.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(submitResult.ok).toBe(true)
    await expect(page.locator('#submitted')).toHaveText('submitted')
  })

  test('rejects actions made with a stale snapshot without re-resolving an element', async ({ page }) => {
    await installProductionBridge(page)
    const current = await snapshot(page)
    const next = elementByName(current, 'Next')
    await page.locator('#next').evaluate((node) => { node.textContent = 'Next after navigation' })

    const result = await request<ProductionActionResult>(page, 'click', {
      elementToken: next.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(staleResult(result)).toBe(true)
    expect(await page.locator('#clicked')).toHaveText('')
  })

  test('invalidates an old snapshot when a link target query changes', async ({ page }) => {
    await installProductionBridge(page)
    const current = await snapshot(page)
    const external = elementByName(current, 'External reference')

    await page.locator('#external').evaluate((node) => {
      node.setAttribute('href', 'https://example.com/?target=changed')
      node.addEventListener('click', (event) => event.preventDefault(), { once: true })
    })

    const result = await request<ProductionActionResult>(page, 'click', {
      elementToken: external.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(staleResult(result)).toBe(true)
  })

  test('marks sensitive pages and blocks password, OTP, payment, and account-security actions', async ({ page }) => {
    await installProductionBridge(page, '/restricted.html')
    const current = await snapshot(page)
    expect(current.sensitive).toBe(true)
    expect(current.sensitiveReason).toBeTruthy()
    expect(current.elements.some((element) => /password|otp|card|验证码|支付|安全/i.test(`${element.name} ${element.inputType ?? ''}`))).toBe(false)
    expect(current.elements.some((element) => element.name === 'Hidden field')).toBe(false)

    const ordinary = current.elements.find((element) => element.name === 'Ordinary field')
    expect(ordinary).toBeTruthy()
    const result = await request<ProductionActionResult>(page, 'fillDraft', {
      elementToken: ordinary!.token,
      value: 'blocked',
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toMatch(/restricted|blocked/)
    expect(await page.locator('#ordinary').inputValue()).toBe('')
  })

  test('blocks irreversible account-deletion semantics even after the approval boundary', async ({ page }) => {
    await installProductionBridge(page)
    await page.locator('#save-draft').evaluate((node) => {
      node.textContent = 'Delete account'
      node.setAttribute('aria-label', 'Delete account')
    })
    const current = await snapshot(page)
    const send = elementByName(current, 'Delete account')
    const result = await request<ProductionActionResult>(page, 'submit', {
      elementToken: send.token,
      pageRevision: current.pageRevision,
      snapshotId: current.snapshotId,
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('blocked')
    expect(await page.locator('#submitted').textContent()).toBe('')
  })
})
