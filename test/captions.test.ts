import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptionLog, type AnnounceTarget } from '../src'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function spoken() {
  const said: Array<{ message: string; politeness: string | undefined }> = []
  const announcer: AnnounceTarget = {
    announce: (message, options) => said.push({ message, politeness: options?.politeness }),
  }
  return { said, announcer, messages: () => said.map((s) => s.message) }
}

describe('turning results into turns', () => {
  it('replaces an unsettled result with the next version of it, then settles it', () => {
    const log = createCaptionLog()
    log.push({ id: 'u1', text: 'hel', final: false, speaker: 'Sam', time: 0 })
    log.push({ id: 'u1', text: 'hello wor', final: false, time: 100 })
    expect(log.getSnapshot().turns).toMatchObject([{ speaker: 'Sam', text: '', interim: 'hello wor' }])

    log.push({ id: 'u1', text: 'Hello world.', final: true, time: 200 })
    expect(log.getSnapshot().turns).toMatchObject([{ speaker: 'Sam', text: 'Hello world.', interim: '' }])
  })

  it('reads consecutive utterances by one speaker as one paragraph', () => {
    const log = createCaptionLog({ mergeWithinMs: 4000 })
    log.push({ id: '1', text: 'Good morning.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Shall we start?', speaker: 'Sam', speakerId: 's', time: 2500 })
    expect(log.getSnapshot().turns).toHaveLength(1)
    expect(log.getSnapshot().turns[0]?.text).toBe('Good morning. Shall we start?')
  })

  it('starts a new turn when the speaker changes', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hi.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Hello.', speaker: 'Priya', speakerId: 'p', time: 500 })
    log.push({ id: '3', text: 'How are you?', speaker: 'Sam', speakerId: 's', time: 900 })
    expect(log.getSnapshot().turns.map((t) => [t.speaker, t.text])).toEqual([
      ['Sam', 'Hi.'],
      ['Priya', 'Hello.'],
      ['Sam', 'How are you?'],
    ])
  })

  it('starts a new turn after a long pause by the same speaker', () => {
    const log = createCaptionLog({ mergeWithinMs: 4000 })
    log.push({ id: '1', text: 'One.', speaker: 'Sam', time: 0 })
    log.push({ id: '2', text: 'Two.', speaker: 'Sam', time: 4001 })
    expect(log.getSnapshot().turns).toHaveLength(2)
  })

  it('groups on the speaker id when there is one, so a renamed speaker stays one turn', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'One.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Two.', speaker: 'Samuel', speakerId: 's', time: 100 })
    expect(log.getSnapshot().turns).toHaveLength(1)
  })

  it('withdraws an unsettled result when the recogniser sends it back empty', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'uh', final: false, time: 0 })
    log.push({ id: '1', text: '', final: false, time: 1 })
    expect(log.getSnapshot().turns).toEqual([])
  })

  it('ignores an empty settled result', () => {
    const log = createCaptionLog()
    const listener = vi.fn()
    log.subscribe(listener)
    log.push({ id: '1', text: '   ', final: true, time: 0 })
    expect(log.getSnapshot().turns).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not let a late unsettled version undo a settled one', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hello.', final: true, time: 0 })
    log.push({ id: '1', text: 'Hell', final: false, time: 5 })
    expect(log.getSnapshot().turns[0]).toMatchObject({ text: 'Hello.', interim: '' })
  })

  it('lets a revised settled caption keep its place', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Meet at ten.', speaker: 'Sam', time: 0 })
    log.push({ id: '2', text: 'Bring the deck.', speaker: 'Sam', time: 100 })
    log.push({ id: '1', text: 'Meet at two.', speaker: 'Sam', time: 200 })
    expect(log.getSnapshot().turns[0]?.text).toBe('Meet at two. Bring the deck.')
  })

  it('keeps at most maxSegments, dropping the oldest', () => {
    const log = createCaptionLog({ maxSegments: 3, mergeWithinMs: 0 })
    for (let i = 1; i <= 5; i++) log.push({ id: String(i), text: `line ${i}`, time: i * 10_000 })
    expect(log.getSnapshot().turns.map((t) => t.text)).toEqual(['line 3', 'line 4', 'line 5'])
  })

  it('stamps segments with the clock when no time is given', () => {
    const log = createCaptionLog({ now: () => 12_345 })
    log.push({ id: '1', text: 'Hi.' })
    expect(log.getSnapshot().turns[0]?.time).toBe(12_345)
  })
})

describe('subscribing', () => {
  it('returns the same snapshot until something changes', () => {
    const log = createCaptionLog()
    const before = log.getSnapshot()
    expect(log.getSnapshot()).toBe(before)

    log.push({ id: '1', text: 'Hi.', time: 0 })
    const after = log.getSnapshot()
    expect(after).not.toBe(before)
    expect(log.getSnapshot()).toBe(after)
  })

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const log = createCaptionLog()
    const listener = vi.fn()
    const unsubscribe = log.subscribe(listener)

    log.push({ id: '1', text: 'Hi', final: false, time: 0 })
    log.push({ id: '1', text: 'Hi.', final: true, time: 1 })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    log.push({ id: '2', text: 'More.', time: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('clear() empties the log and tells subscribers', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hi.', time: 0 })
    const listener = vi.fn()
    log.subscribe(listener)
    log.clear()
    expect(log.getSnapshot().turns).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('transcript', () => {
  it('writes settled text one turn per line, without unsettled text', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hi.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Hello.', speaker: 'Priya', speakerId: 'p', time: 100 })
    log.push({ id: '3', text: 'still talk', final: false, speaker: 'Priya', speakerId: 'p', time: 200 })
    expect(log.toText()).toBe('Sam: Hi.\nPriya: Hello.')
  })

  it('can include a clock time per turn', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hi.', speaker: 'Sam', time: new Date(2026, 8, 26, 9, 5, 7).getTime() })
    expect(log.toText({ timestamps: true, locale: 'en-GB' })).toBe('[09:05:07] Sam: Hi.')
  })

  it('leaves out the speaker when there is none', () => {
    const log = createCaptionLog()
    log.push({ id: '1', text: 'Hi.', time: 0 })
    expect(log.toText()).toBe('Hi.')
  })
})

describe('speaking captions', () => {
  it('says nothing by default', () => {
    const { announcer, said } = spoken()
    const log = createCaptionLog({ announcer })
    log.push({ id: '1', text: 'Hello.', speaker: 'Sam', time: 0 })
    vi.advanceTimersByTime(5000)
    expect(said).toEqual([])
  })

  it('never speaks unsettled text, only what has settled', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final', announceBatchMs: 1000 })
    log.push({ id: '1', text: 'hel', final: false, speaker: 'Sam', time: 0 })
    log.push({ id: '1', text: 'hello wor', final: false, speaker: 'Sam', time: 50 })
    vi.advanceTimersByTime(2000)
    expect(messages()).toEqual([])

    log.push({ id: '1', text: 'Hello world.', final: true, speaker: 'Sam', time: 100 })
    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['Sam: Hello world.'])
  })

  it('joins nearby captions from one speaker into one message, politely', () => {
    const { announcer, said } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final', announceBatchMs: 1000 })
    log.push({ id: '1', text: 'Good morning.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Shall we start?', speaker: 'Sam', speakerId: 's', time: 300 })
    vi.advanceTimersByTime(1000)
    expect(said).toEqual([{ message: 'Sam: Good morning. Shall we start?', politeness: 'polite' }])
  })

  it('names each speaker in a batch that has more than one', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final' })
    log.push({ id: '1', text: 'Hi.', speaker: 'Sam', speakerId: 's', time: 0 })
    log.push({ id: '2', text: 'Hello.', speaker: 'Priya', speakerId: 'p', time: 100 })
    log.push({ id: '3', text: 'Ready?', speaker: 'Sam', speakerId: 's', time: 200 })
    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['Sam: Hi.', 'Priya: Hello.', 'Sam: Ready?'])
  })

  it('does not read your own speech back to you', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final', skipSpeakerId: 'me' })
    log.push({ id: '1', text: 'Testing.', speaker: 'Asghar', speakerId: 'me', time: 0 })
    log.push({ id: '2', text: 'Hello.', speaker: 'Priya', speakerId: 'p', time: 100 })
    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['Priya: Hello.'])
  })

  it('speaks a caption once even when its settled text is revised', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final' })
    log.push({ id: '1', text: 'Meet at ten.', speaker: 'Sam', time: 0 })
    vi.advanceTimersByTime(1000)
    log.push({ id: '1', text: 'Meet at two.', speaker: 'Sam', time: 1500 })
    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['Sam: Meet at ten.'])
  })

  it('says a caption with no speaker as plain text', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final' })
    log.push({ id: '1', text: 'Hello.', time: 0 })
    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['Hello.'])
  })

  it('does nothing, and does not throw, when asked to speak without an announcer', () => {
    const log = createCaptionLog({ announce: 'final' })
    log.push({ id: '1', text: 'Hello.', time: 0 })
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })

  it('drops what is waiting on clear() and dispose()', () => {
    const { announcer, messages } = spoken()
    const log = createCaptionLog({ announcer, announce: 'final' })
    log.push({ id: '1', text: 'Hello.', time: 0 })
    log.clear()
    vi.advanceTimersByTime(5000)
    expect(messages()).toEqual([])

    log.push({ id: '2', text: 'Again.', time: 0 })
    log.dispose()
    vi.advanceTimersByTime(5000)
    expect(messages()).toEqual([])
  })
})
