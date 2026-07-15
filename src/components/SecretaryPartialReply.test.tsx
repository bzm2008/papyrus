import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createEmptyWorkAssistantRun } from '../services/workAssistantProtocol'
import { shouldShowSecretaryPartialReply } from '../services/secretaryPartialReply'
import { SecretaryPartialReply } from './SecretaryPartialReply'

describe('SecretaryPartialReply', () => {
  it('keeps partial assistant text visible after cancellation', () => {
    render(<SecretaryPartialReply text="已扫描 2 个文件，正在生成整理计划。" />)

    expect(screen.getByTestId('secretary-partial-reply')).toHaveTextContent('电脑助手 · 已取消')
    expect(screen.getByText('已扫描 2 个文件，正在生成整理计划。')).toBeInTheDocument()
  })

  it('does not render an empty partial reply', () => {
    render(<SecretaryPartialReply text="   " />)

    expect(screen.queryByTestId('secretary-partial-reply')).not.toBeInTheDocument()
  })

  it('only exposes a cancelled reply for the active run', () => {
    const run = { ...createEmptyWorkAssistantRun('run-1'), status: 'cancelled' as const, messageText: 'partial' }

    expect(shouldShowSecretaryPartialReply(run, 'run-1')).toBe(true)
    expect(shouldShowSecretaryPartialReply(run, 'run-2')).toBe(false)
    expect(shouldShowSecretaryPartialReply({ ...run, status: 'completed' }, 'run-1')).toBe(false)
    expect(shouldShowSecretaryPartialReply({ ...run, messageText: ' ' }, 'run-1')).toBe(false)
  })
})
