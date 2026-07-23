import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createEmptyWorkAssistantRun, type AssistantApprovalRequest, type AssistantToolCall } from '../services/workAssistantProtocol'
import type { AgentTodo, FlowMessage, FlowTrace, SecretaryPlanDraft } from '../stores/useAppStore'
import { SecretaryContextDrawer, SecretaryTimeline } from './SecretaryTimeline'

const message = (patch: Partial<FlowMessage> = {}): FlowMessage => ({
  id: 'message-1',
  role: 'user',
  content: '你好，铭荼',
  createdAt: 100,
  ...patch,
})

const toolCall = (patch: Partial<AssistantToolCall> = {}): AssistantToolCall => ({
  id: 'tool-1',
  runId: 'run-1',
  name: 'workspace_scan',
  intent: '检查项目资料',
  arguments: { token: 'do-not-show', path: 'project/brief.md' },
  status: 'completed',
  startedAt: 300,
  ...patch,
})

const approval = (patch: Partial<AssistantApprovalRequest> = {}): AssistantApprovalRequest => ({
  id: 'approval-1',
  revision: '1',
  risk: 'reversible',
  title: '移动资料到项目目录',
  targetSummary: '项目资料',
  impactSummary: '移动 2 个文件',
  reversible: true,
  expiresAt: 10_000,
  runId: 'run-1',
  toolCallId: 'tool-1',
  reason: '需要你的确认',
  allowedChoices: ['once', 'deny'],
  ...patch,
})

const todo = (patch: Partial<AgentTodo> = {}): AgentTodo => ({
  id: 'todo-1',
  title: '不应显示',
  detail: 'simple greeting must remain quiet',
  status: 'pending',
  agentId: 'writer',
  createdAt: 200,
  updatedAt: 200,
  ...patch,
})

const trace = (patch: Partial<FlowTrace> = {}): FlowTrace => ({
  id: 'trace-1',
  kind: 'tool',
  title: '项目扫描',
  detail: 'secret internal trace details',
  status: 'completed',
  startedAt: 320,
  ...patch,
})

const plan = (patch: Partial<SecretaryPlanDraft> = {}): SecretaryPlanDraft => ({
  id: 'plan-1',
  request: '整理访谈素材',
  executionPrompt: '整理访谈素材',
  planText: '1. 汇总资料\n2. 写出大纲',
  status: 'draft',
  feedback: [],
  createdAt: 200,
  updatedAt: 200,
  ...patch,
})

describe('SecretaryTimeline', () => {
  it('keeps a simple greeting as a quiet conversation without todos or tools', () => {
    render(
      <SecretaryTimeline
        messages={[message(), message({ id: 'reply-1', role: 'assistant', content: '你好，我在。', createdAt: 120 })]}
        todos={[todo()]}
        traces={[trace()]}
        runState="idle"
      />,
    )

    expect(screen.getByText('你好，我在。')).toBeInTheDocument()
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument()
    expect(screen.queryByText('项目扫描')).not.toBeInTheDocument()
  })

  it('places streaming secretary prose before later tool activity and keeps tool detail collapsed', () => {
    render(
      <SecretaryTimeline
        messages={[
          message(),
          message({ id: 'reply-1', role: 'assistant', content: '我先检查现有资料。', createdAt: 200 }),
        ]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', messageText: '我先检查现有资料。', toolCalls: { 'tool-1': toolCall() } }}
      />,
    )

    const entries = screen.getAllByTestId('secretary-timeline-entry')
    expect(entries.map((entry) => entry.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('我先检查现有资料。'),
      expect.stringContaining('检查项目资料'),
    ]))
    expect(entries.findIndex((entry) => entry.textContent?.includes('我先检查现有资料。')))
      .toBeLessThan(entries.findIndex((entry) => entry.textContent?.includes('检查项目资料')))
    expect(screen.queryByText('do-not-show')).not.toBeInTheDocument()
    expect(screen.queryByText('project/brief.md')).not.toBeInTheDocument()
  })

  it('shows one redacted computer-assistant delta with a streaming cursor', () => {
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'running',
          lastActivityAt: 240,
          messageText: '我已整理好访谈结构。\nToken: secret-run-token',
        }}
      />,
    )

    expect(screen.getByTestId('secretary-work-assistant-message')).toHaveTextContent('我已整理好访谈结构。')
    expect(screen.getByTestId('secretary-stream-cursor')).toBeInTheDocument()
    expect(screen.queryByText('secret-run-token')).not.toBeInTheDocument()
  })

  it('redacts sensitive JSON fields and element tokens from computer-assistant deltas', () => {
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'running',
          lastActivityAt: 240,
          messageText: '{"token":"secret-run-token","authorization":"Bearer secret-auth","apiKey":"secret-api-key","password":"secret-password"} elementToken: secret-element\n已完成。',
        }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('已完成。')
    expect(entry).toHaveTextContent('token: [已隐藏]')
    expect(entry).toHaveTextContent('authorization: [已隐藏]')
    expect(entry).toHaveTextContent('apiKey: [已隐藏]')
    expect(entry).toHaveTextContent('password: [已隐藏]')
    expect(entry).toHaveTextContent('elementToken: [已隐藏]')
    expect(entry).not.toHaveTextContent('secret-run-token')
    expect(entry).not.toHaveTextContent('secret-auth')
    expect(entry).not.toHaveTextContent('secret-api-key')
    expect(entry).not.toHaveTextContent('secret-password')
    expect(entry).not.toHaveTextContent('secret-element')
  })

  it('redacts quoted compound token fields from computer-assistant deltas', () => {
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'running',
          lastActivityAt: 240,
          messageText: '{"accessToken":"message-access-token","refresh_token":"message-refresh-token","id-token":"message-id-token"}',
        }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('accessToken: [已隐藏]')
    expect(entry).toHaveTextContent('refresh_token: [已隐藏]')
    expect(entry).toHaveTextContent('id-token: [已隐藏]')
    expect(entry).not.toHaveTextContent('message-access-token')
    expect(entry).not.toHaveTextContent('message-refresh-token')
    expect(entry).not.toHaveTextContent('message-id-token')
  })

  it('redacts complete whitespace-containing authorization, cookie, token, and bearer credentials', () => {
    const credentialText = [
      'authorization: Basic primary secret value',
      'Authorization Basic direct credential secret',
      'cookie: cookie secret with spaces',
      'token: multi word token secret',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature',
      '已完成。',
    ].join('\n')
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', messageText: credentialText }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('authorization: [已隐藏]')
    expect(entry).toHaveTextContent('Authorization: [已隐藏]')
    expect(entry).toHaveTextContent('cookie: [已隐藏]')
    expect(entry).toHaveTextContent('token: [已隐藏]')
    expect(entry).toHaveTextContent('Bearer [已隐藏]')
    expect(entry).toHaveTextContent('已完成。')
    const credentialFragments = [
      'primary secret value',
      'direct credential secret',
      'cookie secret with spaces',
      'multi word token secret',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature',
    ]
    credentialFragments.forEach((fragment) => expect(entry).not.toHaveTextContent(fragment))
  })

  it('redacts standalone Basic credentials in assistant deltas and failed run errors', () => {
    render(
      <SecretaryTimeline
        messages={[message({ content: '整理这份资料' })]}
        runState="error"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'failed',
          messageText: 'Basic message-secret-value',
          error: '连接失败，Basic error-secret-value',
        }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('Basic [已隐藏]')
    expect(entry).not.toHaveTextContent('message-secret-value')
    expect(screen.getByText('连接失败，Basic [已隐藏]')).toBeInTheDocument()
    expect(screen.queryByText('error-secret-value')).not.toBeInTheDocument()
  })

  it('preserves ordinary basic and bearer prose while still redacting credential-shaped values', () => {
    const ordinaryProse = [
      '这是一个 basic 计划，先整理资料。',
      'Bearer 是授权方案的名称，不是凭证。',
    ].join('\n')
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', messageText: ordinaryProse }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('这是一个 basic 计划，先整理资料。')
    expect(entry).toHaveTextContent('Bearer 是授权方案的名称，不是凭证。')
  })

  it('redacts quoted and bare sensitive field variants without leaking value fragments', () => {
    const credentialText = [
      '{"secret":"quoted secret","passcode":"quoted passcode","api_key":"quoted underscore","api-key":"quoted dash","cookie":"quoted cookie"}',
      'secret: bare secret phrase',
      'passcode: bare passcode phrase',
      'api_key: bare underscore phrase',
      'api-key: bare dash phrase',
      'cookie: bare cookie phrase',
    ].join('\n')
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', messageText: credentialText }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('secret: [已隐藏]')
    expect(entry).toHaveTextContent('passcode: [已隐藏]')
    expect(entry).toHaveTextContent('api_key: [已隐藏]')
    expect(entry).toHaveTextContent('api-key: [已隐藏]')
    expect(entry).toHaveTextContent('cookie: [已隐藏]')
    const credentialFragments = [
      'quoted secret',
      'quoted passcode',
      'quoted underscore',
      'quoted dash',
      'quoted cookie',
      'secret phrase',
      'passcode phrase',
      'underscore phrase',
      'dash phrase',
      'cookie phrase',
    ]
    credentialFragments.forEach((fragment) => expect(entry).not.toHaveTextContent(fragment))
  })

  it('caps displayed computer-assistant text at 4000 characters', () => {
    const longReply = 'x'.repeat(4_001)
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', messageText: longReply }}
      />,
    )

    const entry = screen.getByTestId('secretary-work-assistant-message')
    expect(entry).toHaveTextContent('x'.repeat(4_000))
    expect(entry).not.toHaveTextContent('x'.repeat(4_001))
  })

  it('does not repeat a computer-assistant delta already present in Flow messages', () => {
    render(
      <SecretaryTimeline
        messages={[message(), message({ id: 'reply-1', role: 'assistant', content: '我已整理好访谈结构。', createdAt: 240 })]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', lastActivityAt: 240, messageText: '我已整理好访谈结构。' }}
      />,
    )

    expect(screen.getAllByText('我已整理好访谈结构。')).toHaveLength(1)
    expect(screen.queryByTestId('secretary-work-assistant-message')).not.toBeInTheDocument()
  })

  it('redacts a computer-assistant delta after it is merged into Flow messages', () => {
    const response = '已整理好访谈结构。 elementToken: secret-element'
    render(
      <SecretaryTimeline
        messages={[message(), message({ id: 'reply-1', role: 'assistant', content: response, createdAt: 240 })]}
        runState="running"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'running', lastActivityAt: 240, messageText: response }}
      />,
    )

    const renderedMessage = screen.getByText('已整理好访谈结构。 elementToken: [已隐藏]')
    const entry = renderedMessage.closest('[data-testid="secretary-timeline-entry"]')
    expect(entry).not.toBeNull()
    expect(entry).toHaveTextContent('已整理好访谈结构。 elementToken: [已隐藏]')
    expect(entry).not.toHaveTextContent('secret-element')
    expect(screen.queryByTestId('secretary-work-assistant-message')).not.toBeInTheDocument()
  })

  it('retains a redacted computer-assistant partial reply after cancellation or failure', () => {
    const { rerender } = render(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="idle"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'cancelled',
          lastActivityAt: 260,
          messageText: '已完成摘要。\npassword: should-not-leak',
        }}
      />,
    )
    expect(screen.getByTestId('secretary-work-assistant-message')).toHaveTextContent('电脑助手 · 已停止')
    expect(screen.getByTestId('secretary-work-assistant-message')).toHaveTextContent('已完成摘要。')
    expect(screen.queryByText('should-not-leak')).not.toBeInTheDocument()

    rerender(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="error"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'failed', lastActivityAt: 270, messageText: '已完成摘要。' }}
      />,
    )
    expect(screen.getByTestId('secretary-work-assistant-message')).toHaveTextContent('电脑助手 · 未完成')
    expect(screen.getByText('已完成摘要。')).toBeInTheDocument()
  })

  it('renders an approval inline on the same timeline and exposes only safe approval context', () => {
    const onApprove = vi.fn()
    render(
      <SecretaryTimeline
        messages={[message()]}
        runState="running"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'awaiting_approval',
          toolCalls: {
            'tool-1': toolCall({ status: 'awaiting_approval', preview: approval() }),
          },
        }}
        onApprove={onApprove}
      />,
    )

    expect(screen.getByRole('button', { name: '执行一次' })).toBeInTheDocument()
    expect(screen.getByText('移动 2 个文件')).toBeInTheDocument()
    expect(screen.queryByText('do-not-show')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '执行一次' }))
    expect(onApprove).toHaveBeenCalledWith('approval-1', 'once')
  })

  it('keeps the public plan and its execution controls in the timeline', () => {
    const onExecutePlan = vi.fn()
    const onCancelPlan = vi.fn()
    render(
      <SecretaryTimeline
        messages={[message()]}
        planDraft={plan()}
        runState="idle"
        onExecutePlan={onExecutePlan}
        onCancelPlan={onCancelPlan}
      />,
    )

    expect(screen.getByText('公开计划')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))
    fireEvent.click(screen.getByRole('button', { name: '取消计划' }))
    expect(onExecutePlan).toHaveBeenCalledTimes(1)
    expect(onCancelPlan).toHaveBeenCalledTimes(1)
  })

  it('retains the original request when the run fails or is cancelled', () => {
    const { rerender } = render(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="error"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'failed', error: '网络暂时不可用' }}
      />,
    )
    expect(screen.getByText('把访谈整理成大纲')).toBeInTheDocument()
    expect(screen.getByText('网络暂时不可用')).toBeInTheDocument()

    rerender(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="idle"
        workAssistantRun={{ ...createEmptyWorkAssistantRun('run-1'), status: 'cancelled' }}
      />,
    )
    expect(screen.getByText('把访谈整理成大纲')).toBeInTheDocument()
    expect(screen.getByText('本次执行已停止')).toBeInTheDocument()
  })

  it('redacts credentials in failed computer-assistant status messages', () => {
    render(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="error"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'failed',
          error: '连接失败，authorization: Bearer secret-token',
        }}
      />,
    )

    expect(screen.getByText('连接失败，authorization: [已隐藏]')).toBeInTheDocument()
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument()
  })

  it('redacts compound token fields in failed computer-assistant status messages', () => {
    render(
      <SecretaryTimeline
        messages={[message({ content: '把访谈整理成大纲' })]}
        runState="error"
        workAssistantRun={{
          ...createEmptyWorkAssistantRun('run-1'),
          status: 'failed',
          error: '连接失败，{"refreshToken":"failed-refresh-token"}',
        }}
      />,
    )

    expect(screen.getByText('连接失败，{refreshToken: [已隐藏]}')).toBeInTheDocument()
    expect(screen.queryByText('failed-refresh-token')).not.toBeInTheDocument()
  })

  it('closes the narrow project drawer from the keyboard and returns focus to its trigger', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = '项目上下文'
    document.body.append(trigger)
    trigger.focus()

    render(
      <SecretaryContextDrawer
        open
        activeSection="project"
        onSectionChange={vi.fn()}
        onClose={onClose}
      >
        <div>项目内容</div>
      </SecretaryContextDrawer>,
    )

    expect(screen.getByRole('dialog', { name: '项目上下文' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: '项目上下文' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
