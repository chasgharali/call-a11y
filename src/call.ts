import type { AnnounceOptions, Politeness } from './announcer'

/** Anything that can speak a message: an `Announcer`, or your own wrapper. */
export interface AnnounceTarget {
  announce(message: string, options?: AnnounceOptions): void
}

/** Where a change to the local microphone or camera came from. */
export type ActionSource = 'control' | 'shortcut' | 'remote'

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'

/**
 * Every sentence the call announcer can say. Replace any of them to translate
 * or reword; anything you leave out keeps its English default.
 *
 * `names` are the people to name and `others` is how many more there were, so a
 * translation can build its own list. `count` is the total in a batch.
 */
export interface CallMessages {
  joined(names: readonly string[], others: number): string
  left(names: readonly string[], others: number): string
  handRaised(names: readonly string[], others: number): string
  /** Used instead of `joined` in a large call, where names are left out. */
  joinedCount(count: number, total: number | undefined): string
  leftCount(count: number, total: number | undefined): string
  microphone(on: boolean): string
  camera(on: boolean): string
  screenShare(on: boolean, who: string | undefined): string
  recording(on: boolean): string
  connection(state: ConnectionState): string
}

export interface CallAnnouncerOptions {
  /**
   * How long to collect joins, leaves and raised hands before saying them
   * once. `0` says each one immediately. Default 1200.
   */
  batchMs?: number
  /** The same window in a large call. Default 5000. */
  largeBatchMs?: number
  /** At or above this many participants, names are dropped and only counts are said. Default 20. */
  largeCallThreshold?: number
  /** How many names to speak before "and N others". Default 3. */
  maxNames?: number
  /**
   * When a change comes from pressing the toggle button itself, the button's
   * own state change is normally spoken by the screen reader, so announcing it
   * as well can be a repeat. Behaviour differs between screen readers, and the
   * default errs toward saying it twice rather than not at all. Set `skip` if
   * your own testing shows doubling. Changes from a shortcut or from someone
   * else (`remote`) are always announced.
   */
  controlChanges?: 'announce' | 'skip'
  /** Locale for joining names into a list ("A, B and C"). Default `en`. */
  locale?: string
  messages?: Partial<CallMessages>
}

export interface CallAnnouncer {
  participantJoined(name: string): void
  participantLeft(name: string): void
  handRaised(name: string): void
  /** Tell the announcer how many people are in the call; drives large-call mode. */
  setParticipantCount(count: number): void
  /** Your own microphone. */
  microphoneChanged(on: boolean, source?: ActionSource): void
  /** Your own camera. */
  cameraChanged(on: boolean, source?: ActionSource): void
  /** Someone started or stopped sharing. Leave `who` out for yourself. */
  screenShareChanged(on: boolean, who?: string): void
  /** Assertive on start: recording is a consent question and should be heard now. */
  recordingChanged(on: boolean): void
  /** Assertive on `reconnecting` and `disconnected`. */
  connectionChanged(state: ConnectionState): void
  /** Say anything else. */
  say(message: string, politeness?: Politeness): void
  /** Release everything waiting in a batch now. */
  flush(): void
  /** Cancel timers and forget what is waiting. Safe to keep using afterwards. */
  dispose(): void
}

type BatchKind = 'joined' | 'left' | 'handRaised'

export function defaultMessages(locale = 'en'): CallMessages {
  const list = (names: readonly string[], others: number): string => {
    const parts = [...names]
    if (others > 0) parts.push(`${others} ${others === 1 ? 'other' : 'others'}`)
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
  }
  const people = (count: number): string => `${count} ${count === 1 ? 'person' : 'people'}`
  const inCall = (total: number | undefined): string =>
    total === undefined ? '' : `, ${total} in the call`

  return {
    joined: (names, others) => `${list(names, others)} joined`,
    left: (names, others) => `${list(names, others)} left`,
    handRaised: (names, others) =>
      names.length + others === 1
        ? `${list(names, others)} raised a hand`
        : `${list(names, others)} raised hands`,
    joinedCount: (count, total) => `${people(count)} joined${inCall(total)}`,
    leftCount: (count, total) => `${people(count)} left${inCall(total)}`,
    microphone: (on) => (on ? 'Microphone on' : 'Microphone off'),
    camera: (on) => (on ? 'Camera on' : 'Camera off'),
    screenShare: (on, who) =>
      who === undefined
        ? on
          ? 'You started sharing your screen'
          : 'You stopped sharing your screen'
        : on
          ? `${who} started sharing their screen`
          : `${who} stopped sharing their screen`,
    recording: (on) => (on ? 'Recording started' : 'Recording stopped'),
    connection: (state) =>
      state === 'connected'
        ? 'Reconnected'
        : state === 'reconnecting'
          ? 'Reconnecting'
          : 'Disconnected from the call',
  }
}

export function createCallAnnouncer(
  target: AnnounceTarget,
  options: CallAnnouncerOptions = {},
): CallAnnouncer {
  const messages: CallMessages = {
    ...defaultMessages(options.locale),
    ...options.messages,
  }
  const batchMs = options.batchMs ?? 1200
  const largeBatchMs = options.largeBatchMs ?? 5000
  const largeCallThreshold = options.largeCallThreshold ?? 20
  const maxNames = Math.max(1, options.maxNames ?? 3)
  const skipControlChanges = options.controlChanges === 'skip'

  let participantCount: number | undefined
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  const pending: Record<BatchKind, string[]> = { joined: [], left: [], handRaised: [] }

  const isLarge = (): boolean =>
    participantCount !== undefined && participantCount >= largeCallThreshold

  function say(message: string, politeness: Politeness = 'polite', key?: string): void {
    target.announce(message, key === undefined ? { politeness } : { politeness, key })
  }

  function flush(): void {
    if (batchTimer !== undefined) {
      clearTimeout(batchTimer)
      batchTimer = undefined
    }
    const large = isLarge()

    for (const kind of ['joined', 'left'] as const) {
      const names = pending[kind]
      pending[kind] = []
      if (names.length === 0) continue
      if (large) {
        say(
          kind === 'joined'
            ? messages.joinedCount(names.length, participantCount)
            : messages.leftCount(names.length, participantCount),
        )
      } else {
        const named = names.slice(0, maxNames)
        const others = names.length - named.length
        say(kind === 'joined' ? messages.joined(named, others) : messages.left(named, others))
      }
    }

    const hands = pending.handRaised
    pending.handRaised = []
    if (hands.length > 0) {
      const named = hands.slice(0, maxNames)
      say(messages.handRaised(named, hands.length - named.length))
    }
  }

  function enqueue(kind: BatchKind, name: string): void {
    const windowMs = isLarge() ? largeBatchMs : batchMs
    if (windowMs <= 0) {
      pending[kind] = [name]
      flush()
      return
    }

    // A person who leaves and comes straight back (a network blip) is not news,
    // and neither is one who joins and leaves inside the same window.
    const opposite = kind === 'joined' ? 'left' : kind === 'left' ? 'joined' : undefined
    if (opposite) {
      const at = pending[opposite].indexOf(name)
      if (at !== -1) {
        pending[opposite].splice(at, 1)
        return
      }
    }
    if (!pending[kind].includes(name)) pending[kind].push(name)

    // A fixed window from the first event, not a debounce: in a busy call a
    // debounce could hold the announcement back indefinitely.
    batchTimer ??= setTimeout(flush, windowMs)
  }

  return {
    participantJoined: (name) => enqueue('joined', name),
    participantLeft: (name) => enqueue('left', name),
    handRaised: (name) => enqueue('handRaised', name),

    setParticipantCount(count) {
      participantCount = count
    },

    microphoneChanged(on, source = 'control') {
      if (skipControlChanges && source === 'control') return
      say(messages.microphone(on), 'polite', 'microphone')
    },

    cameraChanged(on, source = 'control') {
      if (skipControlChanges && source === 'control') return
      say(messages.camera(on), 'polite', 'camera')
    },

    screenShareChanged: (on, who) => say(messages.screenShare(on, who)),

    recordingChanged: (on) => say(messages.recording(on), on ? 'assertive' : 'polite', 'recording'),

    connectionChanged: (state) =>
      say(messages.connection(state), state === 'connected' ? 'polite' : 'assertive', 'connection'),

    say: (message, politeness = 'polite') => say(message, politeness),

    flush,

    dispose() {
      if (batchTimer !== undefined) clearTimeout(batchTimer)
      batchTimer = undefined
      pending.joined = []
      pending.left = []
      pending.handRaised = []
    },
  }
}
