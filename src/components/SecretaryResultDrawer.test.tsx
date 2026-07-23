import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SecretaryResultDrawer } from './SecretaryResultDrawer'

describe('SecretaryResultDrawer', () => {
  it('moves focus into the result dialog and returns it after Escape', async () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = '查看成果'
    document.body.append(trigger)
    trigger.focus()

    render(
      <SecretaryResultDrawer open onClose={onClose}>
        <button type="button">成果内容</button>
      </SecretaryResultDrawer>,
    )

    const dialog = screen.getByRole('dialog', { name: '秘书成果' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭秘书成果' })))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('keeps Tab focus within the dialog', async () => {
    render(
      <SecretaryResultDrawer open onClose={vi.fn()}>
        <button type="button">第一个成果操作</button>
        <button type="button">最后一个成果操作</button>
      </SecretaryResultDrawer>,
    )

    const dialog = screen.getByRole('dialog', { name: '秘书成果' })
    const close = screen.getByRole('button', { name: '关闭秘书成果' })
    const last = screen.getByRole('button', { name: '最后一个成果操作' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
