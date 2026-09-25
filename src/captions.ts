import type { AnnounceTarget } from './call'

/**
 * One piece of recognised speech, as a speech-to-text engine emits it.
 *
 * Streaming recognisers send the same utterance many times while it is being
 * spoken and then a last, settled version. Give every version of one utterance
 * the same `id`, with `final: false` until it is settled.
 */
export interface CaptionSegment {
  id: string
  text: string
  /** `false` while the recogniser may still change its mind. Default `true`. */
  final?: boolean
  /** Name shown to the reader. */
  speaker?: string
  /** Stable id for the speaker. Turns are grouped on this, or on `speaker` if it is absent. */
  speakerId?: string
  /** Milliseconds since the epoch. Default: now. */
  time?: number
}

/** Consecutive utterances by one speaker, read as one paragraph. */
export interface CaptionTurn {
  /** The id of the first segment in the turn. */
  id: string
  speaker: string | undefined
  speakerId: string | undefined
  time: number
  /** Settled text. */
  text: string
  /** Text the recogniser has not settled yet. Empty when there is none. */
  interim: string
}

export interface CaptionSnapshot {
  readonly turns: readonly CaptionTurn[]
}

export interface CaptionLogOptions {
  /** Utterances by one speaker closer together than this are one turn. Default 4000. */
  mergeWithinMs?: number
  /** Oldest segments are dropped beyond this many, so a long call does not grow without bound. Default 500. */
  maxSegments?: number
  /**
   * Whether settled captions are also spoken through the announcer.
   *
   * `off` (default): captions are on screen and in a readable log, and nothing
   * is pushed at the reader. Most screen reader users can hear the call, so a
   * second voice reading the captions on top of it is noise.
   *
   * `final`: each settled caption is spoken, batched per speaker. Right for a
   * reader who cannot hear the call, for example a deaf-blind user on a
   * braille display. Unsettled text is never spoken, in either mode: it changes
   * too fast to be read aloud.
   */
  announce?: 'off' | 'final'
  /** Required for `announce: 'final'`. */
  announcer?: AnnounceTarget
  /** Settled captions from one speaker within this window are spoken as one message. Default 1000. */
  announceBatchMs?: number
  /** Do not speak this speaker's captions, typically the local user: you know what you just said. */
  skipSpeakerId?: string
  /** Clock, for tests. */
  now?: () => number
}

export interface CaptionLog {
  push(segment: CaptionSegment): void
  clear(): void
  /** Same object until something changes. Shaped for React's `useSyncExternalStore`. */
  getSnapshot(): CaptionSnapshot
  subscribe(listener: () => void): () => void
  /** Settled captions as plain text, one turn per line, for saving or copying. */
  toText(options?: { timestamps?: boolean; locale?: string }): string
  /** Cancel timers and listeners. */
  dispose(): void
}

interface StoredSegment {
  id: string
  text: string
  final: boolean
  speaker: string | undefined
  speakerId: string | undefined
  time: number
}

const speakerKey = (segment: { speakerId: string | undefined; speaker: string | undefined }) =>
  segment.speakerId ?? segment.speaker

export function createCaptionLog(options: CaptionLogOptions = {}): CaptionLog {
  const mergeWithinMs = options.mergeWithinMs ?? 4000
  const maxSegments = Math.max(1, options.maxSegments ?? 500)
  const announceMode = options.announce ?? 'off'
  const announceBatchMs = options.announceBatchMs ?? 1000
  const now = options.now ?? Date.now

  const segments = new Map<string, StoredSegment>()
  const listeners = new Set<() => void>()
  let snapshot: CaptionSnapshot | undefined

  let pendingSpeech: Array<{ speaker: string | undefined; key: string | undefined; text: string }> = []
  let speechTimer: ReturnType<typeof setTimeout> | undefined

  function changed(): void {
    snapshot = undefined
    for (const listener of [...listeners]) listener()
  }

  function flushSpeech(): void {
    speechTimer = undefined
    const announcer = options.announcer
    const items = pendingSpeech
    pendingSpeech = []
    if (!announcer) return

    // Adjacent captions from one speaker read as one sentence stream.
    let index = 0
    while (index < items.length) {
      const first = items[index]!
      const words = [first.text]
      index += 1
      while (index < items.length && items[index]!.key === first.key) {
        words.push(items[index]!.text)
        index += 1
      }
      const spoken = words.join(' ')
      announcer.announce(first.speaker ? `${first.speaker}: ${spoken}` : spoken, {
        politeness: 'polite',
      })
    }
  }

  function queueSpeech(segment: StoredSegment): void {
    if (announceMode !== 'final' || !options.announcer) return
    if (options.skipSpeakerId !== undefined && speakerKey(segment) === options.skipSpeakerId) return
    pendingSpeech.push({ speaker: segment.speaker, key: speakerKey(segment), text: segment.text })
    speechTimer ??= setTimeout(flushSpeech, announceBatchMs)
  }

  function buildTurns(): CaptionTurn[] {
    const turns: CaptionTurn[] = []
    let finals: string[] = []
    let interims: string[] = []
    let current: { first: StoredSegment; last: StoredSegment } | undefined

    const close = () => {
      if (!current) return
      turns.push({
        id: current.first.id,
        speaker: current.first.speaker,
        speakerId: current.first.speakerId,
        time: current.first.time,
        text: finals.join(' '),
        interim: interims.join(' '),
      })
      finals = []
      interims = []
      current = undefined
    }

    for (const segment of segments.values()) {
      const continues =
        current !== undefined &&
        speakerKey(current.first) === speakerKey(segment) &&
        segment.time - current.last.time <= mergeWithinMs
      if (!continues) close()
      current = { first: current?.first ?? segment, last: segment }
      ;(segment.final ? finals : interims).push(segment.text)
    }
    close()
    return turns
  }

  function getSnapshot(): CaptionSnapshot {
    snapshot ??= { turns: buildTurns() }
    return snapshot
  }

  return {
    push(input) {
      const text = input.text.trim()
      const final = input.final ?? true

      if (!text) {
        // A recogniser clearing an unsettled result withdraws it. An empty
        // settled result carries nothing.
        if (!final && segments.get(input.id)?.final === false) {
          segments.delete(input.id)
          changed()
        }
        return
      }

      const existing = segments.get(input.id)
      // A late unsettled version of something already settled must not undo it.
      if (existing?.final && !final) return
      const wasFinal = existing?.final ?? false
      const stored: StoredSegment = {
        id: input.id,
        text,
        final,
        speaker: input.speaker ?? existing?.speaker,
        speakerId: input.speakerId ?? existing?.speakerId,
        time: existing?.time ?? input.time ?? now(),
      }
      // Re-setting keeps the original position, so a revised caption does not
      // jump to the end.
      segments.set(input.id, stored)

      while (segments.size > maxSegments) {
        const oldest = segments.keys().next().value
        if (oldest === undefined) break
        segments.delete(oldest)
      }

      if (final && !wasFinal) queueSpeech(stored)
      changed()
    },

    clear() {
      segments.clear()
      pendingSpeech = []
      if (speechTimer !== undefined) clearTimeout(speechTimer)
      speechTimer = undefined
      changed()
    },

    getSnapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    toText({ timestamps = false, locale } = {}) {
      const lines: string[] = []
      for (const turn of getSnapshot().turns) {
        if (!turn.text) continue
        const stamp = timestamps
          ? `[${new Date(turn.time).toLocaleTimeString(locale, { hour12: false })}] `
          : ''
        lines.push(`${stamp}${turn.speaker ? `${turn.speaker}: ` : ''}${turn.text}`)
      }
      return lines.join('\n')
    },

    dispose() {
      if (speechTimer !== undefined) clearTimeout(speechTimer)
      speechTimer = undefined
      pendingSpeech = []
      listeners.clear()
    },
  }
}
