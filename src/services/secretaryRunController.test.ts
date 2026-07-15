import { afterEach, describe, expect, it } from 'vitest'

import {
  activeSecretaryRunId,
  cancelSecretaryRun,
  finishSecretaryRun,
  startSecretaryRun,
} from './secretaryRunController'

describe('secretaryRunController', () => {
  afterEach(() => {
    cancelSecretaryRun()
    const activeRunId = activeSecretaryRunId()
    if (activeRunId) finishSecretaryRun(activeRunId)
  })

  it('cancels the previous run when a new run starts', () => {
    const previousSignal = startSecretaryRun('run-1')

    const currentSignal = startSecretaryRun('run-2')

    expect(previousSignal.aborted).toBe(true)
    expect(currentSignal.aborted).toBe(false)
    expect(activeSecretaryRunId()).toBe('run-2')
  })

  it('does not let an old run finish clear the current run', () => {
    startSecretaryRun('run-1')
    startSecretaryRun('run-2')

    finishSecretaryRun('run-1')

    expect(activeSecretaryRunId()).toBe('run-2')
  })

  it('cancels the current run explicitly', () => {
    const signal = startSecretaryRun('run-1')

    cancelSecretaryRun()

    expect(signal.aborted).toBe(true)
    expect(activeSecretaryRunId()).toBe('run-1')
  })
})
