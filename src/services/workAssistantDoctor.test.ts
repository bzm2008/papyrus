import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getWorkAssistantDoctor,
  resetWorkAssistantDoctorInvokerForTests,
  setWorkAssistantDoctorInvokerForTests,
} from './workAssistantDoctor'

describe('workAssistantDoctor', () => {
  afterEach(() => {
    resetWorkAssistantDoctorInvokerForTests()
  })

  it('returns structured native checks without exposing a stack trace', async () => {
    const report = {
      platform: 'windows',
      architecture: 'x86_64',
      generatedAt: 42,
      checks: [{ id: 'loopback_port', label: '回环端口', status: 'ok' as const, message: '可绑定' }],
    }
    const invoker = vi.fn(async () => report)
    setWorkAssistantDoctorInvokerForTests(invoker)

    await expect(getWorkAssistantDoctor()).resolves.toEqual(report)
    expect(invoker).toHaveBeenCalledTimes(1)
  })

  it('propagates a structured native failure for the caller to render safely', async () => {
    setWorkAssistantDoctorInvokerForTests(async () => {
      throw { code: 'protocol', message: 'doctor unavailable', recoverable: true }
    })

    await expect(getWorkAssistantDoctor()).rejects.toMatchObject({ code: 'protocol' })
  })
})
