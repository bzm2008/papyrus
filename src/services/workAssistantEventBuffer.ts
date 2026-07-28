import type { WorkAssistantEvent } from './workAssistantProtocol'

type MessageDeltaEvent = Extract<WorkAssistantEvent, { type: 'message.delta' }>

type QueuedDelta = {
  runId: string
  messageId: string
  text: string
  at: number
}

/**
 * Ephemeral UI buffer for high-frequency assistant text deltas.
 *
 * It intentionally accepts only message.delta events and copies only the run
 * id, message id, text delta, and timestamp. Tool arguments, screenshots,
 * approval requests, and tokens are never copied into this in-memory buffer;
 * it has no persistence or logging path.
 */
export class WorkAssistantDeltaBuffer {
  private readonly queuedByRun = new Map<string, Map<string, QueuedDelta>>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly dispatch: (event: MessageDeltaEvent) => void
  private readonly flushIntervalMs: number

  constructor(
    dispatch: (event: MessageDeltaEvent) => void,
    flushIntervalMs = Math.ceil(1000 / 30),
  ) {
    this.dispatch = dispatch
    this.flushIntervalMs = flushIntervalMs
  }

  queue(event: MessageDeltaEvent) {
    const queuedByMessage = this.queuedByRun.get(event.runId) ?? new Map<string, QueuedDelta>()
    const queued = queuedByMessage.get(event.messageId) ?? {
      runId: event.runId,
      messageId: event.messageId,
      text: '',
      at: event.at,
    }
    queued.text += event.delta
    queued.at = event.at
    queuedByMessage.set(event.messageId, queued)
    this.queuedByRun.set(event.runId, queuedByMessage)
    this.schedule()
  }

  flushRun(runId: string) {
    const queuedByMessage = this.queuedByRun.get(runId)
    if (!queuedByMessage) return
    this.queuedByRun.delete(runId)
    this.clearTimerIfIdle()
    for (const queued of queuedByMessage.values()) this.dispatchQueued(queued)
  }

  flushAll() {
    const queued = [...this.queuedByRun.values()].flatMap((entries) => [...entries.values()])
    this.queuedByRun.clear()
    this.clearTimerIfIdle()
    for (const entry of queued) this.dispatchQueued(entry)
  }

  private dispatchQueued(queued: QueuedDelta) {
    this.dispatch({
      type: 'message.delta',
      runId: queued.runId,
      messageId: queued.messageId,
      delta: queued.text,
      at: queued.at,
    })
  }

  private clearTimerIfIdle() {
    if (this.queuedByRun.size > 0) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule() {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flushAll()
    }, this.flushIntervalMs)
  }
}
