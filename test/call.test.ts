import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnnouncer, createCallAnnouncer, type AnnounceOptions } from '../src'

interface Said {
  message: string
  politeness: string | undefined
  key: string | undefined
}

/** A stand-in for an announcer that records what it is asked to say. */
function recorder() {
  const said: Said[] = []
  return {
    said,
    messages: () => said.map((s) => s.message),
    target: {
      announce(message: string, options?: AnnounceOptions) {
        said.push({ message, politeness: options?.politeness, key: options?.key })
      },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('joins and leaves', () => {
  it('says a single join once the window has passed, not before', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { batchMs: 1200 })
    call.participantJoined('Sam')

    vi.advanceTimersByTime(1199)
    expect(r.messages()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(r.messages()).toEqual(['Sam joined'])
  })

  it('joins two names with "and"', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantJoined('Sam')
    call.participantJoined('Priya')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam and Priya joined'])
  })

  it('names the first few and counts the rest', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { maxNames: 3 })
    for (const name of ['Sam', 'Priya', 'Jo', 'Lee', 'Kim']) call.participantJoined(name)
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam, Priya, Jo, and 2 others joined'])
  })

  it('says "1 other" in the singular', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { maxNames: 2 })
    for (const name of ['Sam', 'Priya', 'Jo']) call.participantJoined(name)
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam, Priya, and 1 other joined'])
  })

  it('says a join once even if the same name arrives twice', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantJoined('Sam')
    call.participantJoined('Sam')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam joined'])
  })

  it('says nothing about someone who drops and comes straight back', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantLeft('Sam')
    call.participantJoined('Sam')
    vi.advanceTimersByTime(5000)
    expect(r.messages()).toEqual([])
  })

  it('says nothing about someone who joins and leaves inside one window', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantJoined('Sam')
    call.participantLeft('Sam')
    vi.advanceTimersByTime(5000)
    expect(r.messages()).toEqual([])
  })

  it('reports joins before leaves when both happen in a window', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantLeft('Jo')
    call.participantJoined('Sam')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam joined', 'Jo left'])
  })

  it('uses a fixed window from the first event, so a busy call cannot hold it back', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { batchMs: 1000 })
    call.participantJoined('A')
    vi.advanceTimersByTime(800)
    call.participantJoined('B')
    vi.advanceTimersByTime(200)
    expect(r.messages()).toEqual(['A and B joined'])
  })

  it('says each event at once when batchMs is 0', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { batchMs: 0 })
    call.participantJoined('Sam')
    call.participantJoined('Priya')
    expect(r.messages()).toEqual(['Sam joined', 'Priya joined'])
  })

  it('flush() releases a waiting batch immediately', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantJoined('Sam')
    call.flush()
    expect(r.messages()).toEqual(['Sam joined'])
    vi.advanceTimersByTime(5000)
    expect(r.messages()).toEqual(['Sam joined'])
  })

  it('dispose() forgets what was waiting and stays usable afterwards', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.participantJoined('Sam')
    call.dispose()
    vi.advanceTimersByTime(5000)
    expect(r.messages()).toEqual([])

    call.participantJoined('Priya')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Priya joined'])
  })
})

describe('large calls', () => {
  it('drops names and says counts once the call reaches the threshold', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { largeCallThreshold: 20 })
    call.setParticipantCount(41)
    for (const name of ['A', 'B', 'C', 'D', 'E']) call.participantJoined(name)
    vi.advanceTimersByTime(5000)
    expect(r.messages()).toEqual(['5 people joined, 41 in the call'])
  })

  it('uses the longer window in a large call', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { largeCallThreshold: 20, largeBatchMs: 5000 })
    call.setParticipantCount(30)
    call.participantLeft('A')
    vi.advanceTimersByTime(4999)
    expect(r.messages()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(r.messages()).toEqual(['1 person left, 30 in the call'])
  })

  it('names people again when the call shrinks below the threshold', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { largeCallThreshold: 20 })
    call.setParticipantCount(12)
    call.participantJoined('Sam')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam joined'])
  })
})

describe('hands', () => {
  it('says one raised hand, and several as a batch', () => {
    const one = recorder()
    const a = createCallAnnouncer(one.target)
    a.handRaised('Sam')
    vi.advanceTimersByTime(1200)
    expect(one.messages()).toEqual(['Sam raised a hand'])

    const many = recorder()
    const b = createCallAnnouncer(many.target)
    b.handRaised('Sam')
    b.handRaised('Priya')
    vi.advanceTimersByTime(1200)
    expect(many.messages()).toEqual(['Sam and Priya raised hands'])
  })
})

describe('your own microphone and camera', () => {
  it('says the new state, keyed so a rapid flip replaces a waiting message', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.microphoneChanged(false)
    call.cameraChanged(true)

    expect(r.said).toEqual([
      { message: 'Microphone off', politeness: 'polite', key: 'microphone' },
      { message: 'Camera on', politeness: 'polite', key: 'camera' },
    ])
  })

  it('announces a change from the toggle button by default', () => {
    const r = recorder()
    createCallAnnouncer(r.target).microphoneChanged(true, 'control')
    expect(r.messages()).toEqual(['Microphone on'])
  })

  it('can skip changes from the toggle button, but never those from a shortcut or from someone else', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { controlChanges: 'skip' })
    call.microphoneChanged(false, 'control')
    call.microphoneChanged(false, 'shortcut')
    call.cameraChanged(false, 'remote')
    call.cameraChanged(true, 'control')
    expect(r.messages()).toEqual(['Microphone off', 'Camera off'])
  })
})

describe('what must be heard now', () => {
  it('says recording started assertively and recording stopped politely', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.recordingChanged(true)
    call.recordingChanged(false)
    expect(r.said.map((s) => [s.message, s.politeness])).toEqual([
      ['Recording started', 'assertive'],
      ['Recording stopped', 'polite'],
    ])
  })

  it('says a dropped connection assertively and the recovery politely, on one key', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.connectionChanged('reconnecting')
    call.connectionChanged('connected')
    call.connectionChanged('disconnected')
    expect(r.said).toEqual([
      { message: 'Reconnecting', politeness: 'assertive', key: 'connection' },
      { message: 'Reconnected', politeness: 'polite', key: 'connection' },
      { message: 'Disconnected from the call', politeness: 'assertive', key: 'connection' },
    ])
  })

  it('says screen sharing by you or by someone else', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.screenShareChanged(true)
    call.screenShareChanged(true, 'Priya')
    call.screenShareChanged(false, 'Priya')
    expect(r.messages()).toEqual([
      'You started sharing your screen',
      'Priya started sharing their screen',
      'Priya stopped sharing their screen',
    ])
  })

  it('say() passes any message through at the chosen politeness', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target)
    call.say('The host ended the call', 'assertive')
    call.say('Chat: hello')
    expect(r.said.map((s) => [s.message, s.politeness])).toEqual([
      ['The host ended the call', 'assertive'],
      ['Chat: hello', 'polite'],
    ])
  })
})

describe('wording', () => {
  it('lets any message be replaced and keeps the defaults for the rest', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, {
      messages: { joined: (names) => `${names.join(' + ')} ist beigetreten` },
    })
    call.participantJoined('Sam')
    call.microphoneChanged(true)
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Microphone on', 'Sam ist beigetreten'])
  })

  it('builds name lists with the requested locale', () => {
    const r = recorder()
    const call = createCallAnnouncer(r.target, { locale: 'de' })
    call.participantJoined('Sam')
    call.participantJoined('Priya')
    vi.advanceTimersByTime(1200)
    expect(r.messages()).toEqual(['Sam und Priya joined'])
  })
})

describe('with a real announcer', () => {
  it('turns a burst of joins into one spoken line in the polite region', () => {
    const announcer = createAnnouncer({ readyMs: 0 })
    const call = createCallAnnouncer(announcer)
    for (const name of ['Sam', 'Priya', 'Jo', 'Lee']) call.participantJoined(name)
    vi.advanceTimersByTime(1200)

    expect(announcer.regions.polite.textContent).toBe('Sam, Priya, Jo, and 1 other joined')
    expect(announcer.regions.assertive.textContent).toBe('')
  })

  it('puts a recording notice in the assertive region', () => {
    const announcer = createAnnouncer({ readyMs: 0 })
    createCallAnnouncer(announcer).recordingChanged(true)
    expect(announcer.regions.assertive.textContent).toBe('Recording started')
  })
})
