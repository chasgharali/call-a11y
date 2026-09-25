/**
 * A screen-reader announcer built on two persistent live regions.
 *
 * Three things decide whether a live region is heard at all, and this file
 * exists to get them right once:
 *
 *  1. The region has to exist *before* the message does. Both regions are
 *     created up front and the first message waits a short moment (`readyMs`)
 *     so assistive technology has registered them.
 *  2. Rapid updates to one region can cut each other off. Messages in a region
 *     are spaced by `minGapMs`, and a queued message can be superseded by a
 *     newer one with the same `key` (only the latest microphone state matters).
 *  3. Stale text should not linger where a reader can find it by browsing.
 *     Messages are removed from the region after `clearAfterMs`.
 *
 * Each message is a fresh element rather than new text in an old node, so a
 * repeated message is still a DOM addition.
 *
 * What the tests can and cannot show: they check this DOM behaviour. They do
 * not check what JAWS, NVDA, VoiceOver or TalkBack then say.
 */

export type Politeness = 'polite' | 'assertive'

export interface AnnounceOptions {
  /** `polite` waits for a pause in speech; `assertive` may interrupt. Default `polite`. */
  politeness?: Politeness
  /**
   * Queued messages that share a key replace each other, so a burst of
   * "microphone off / on / off" collapses to the newest one instead of a
   * backlog. A message that has already been placed in the region is not
   * affected.
   */
  key?: string
}

export interface AnnouncerOptions {
  /**
   * Where the regions are appended. Default `document.body`. If your app opens
   * modal dialogs, note that `showModal()` makes everything outside the dialog
   * inert, and an inert live region is silent: create a second announcer with
   * `container` set to the dialog while it is open.
   */
  container?: HTMLElement
  /** Minimum time between two messages in the same region. Default 400. */
  minGapMs?: number
  /** Remove a message from its region after this long. `0` keeps it. Default 8000. */
  clearAfterMs?: number
  /** How long after creation before the first message is placed. Default 100. */
  readyMs?: number
  /**
   * The most messages held per region while waiting. When a burst exceeds it
   * the oldest are dropped: a backlog minutes behind the call is worse than a
   * gap. Default 5.
   */
  maxQueue?: number
  /**
   * Called at the moment a message is placed in a live region. Useful for a
   * visible log, for tests, and for showing sighted developers what a screen
   * reader user is being told.
   */
  onAnnounce?: (message: string, politeness: Politeness) => void
}

export interface Announcer {
  /** Queue a message. Empty or whitespace-only messages are ignored. */
  announce(message: string, options?: AnnounceOptions): void
  /** Drop everything queued and empty both regions. */
  clear(): void
  /** Remove the regions from the DOM. Later calls do nothing. */
  destroy(): void
  /** The two live regions, for inspection and testing. */
  readonly regions: Readonly<Record<Politeness, HTMLElement>>
}

interface QueueItem {
  message: string
  key: string | undefined
}

interface Lane {
  region: HTMLElement
  queue: QueueItem[]
  busy: boolean
  gapTimer: ReturnType<typeof setTimeout> | undefined
  clearTimer: ReturnType<typeof setTimeout> | undefined
}

const HIDDEN_STYLE: Record<string, string> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  border: '0',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  'clip-path': 'inset(50%)',
  'white-space': 'nowrap',
}

function visuallyHide(element: HTMLElement): void {
  // Inline, so the announcer works without importing any stylesheet. Never
  // display:none or aria-hidden: either removes the region from the
  // accessibility tree and it would announce nothing.
  for (const [property, value] of Object.entries(HIDDEN_STYLE)) {
    element.style.setProperty(property, value)
  }
}

function createRegion(doc: Document, politeness: Politeness): HTMLElement {
  const region = doc.createElement('div')
  // role and aria-live are both set on purpose: some screen reader and browser
  // pairs only honour one of them.
  region.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status')
  region.setAttribute('aria-live', politeness)
  region.setAttribute('aria-atomic', 'true')
  region.setAttribute('data-call-a11y-region', politeness)
  visuallyHide(region)
  return region
}

export function createAnnouncer(options: AnnouncerOptions = {}): Announcer {
  const container = options.container ?? (typeof document === 'undefined' ? undefined : document.body)
  if (!container) {
    throw new Error(
      'call-a11y: createAnnouncer needs a DOM. Call it in the browser, for example inside useEffect.',
    )
  }
  const doc = container.ownerDocument

  const minGapMs = options.minGapMs ?? 400
  const clearAfterMs = options.clearAfterMs ?? 8000
  const readyMs = options.readyMs ?? 100
  const maxQueue = Math.max(1, options.maxQueue ?? 5)

  const root = doc.createElement('div')
  root.setAttribute('data-call-a11y-announcer', '')
  visuallyHide(root)

  const lanes: Record<Politeness, Lane> = {
    polite: newLane(createRegion(doc, 'polite')),
    assertive: newLane(createRegion(doc, 'assertive')),
  }
  root.append(lanes.polite.region, lanes.assertive.region)
  container.append(root)

  let ready = readyMs <= 0
  let destroyed = false
  const readyTimer = ready
    ? undefined
    : setTimeout(() => {
        ready = true
        pump('polite')
        pump('assertive')
      }, readyMs)

  function newLane(region: HTMLElement): Lane {
    return { region, queue: [], busy: false, gapTimer: undefined, clearTimer: undefined }
  }

  function place(politeness: Politeness, message: string): void {
    const lane = lanes[politeness]
    const node = doc.createElement('div')
    node.textContent = message
    lane.region.replaceChildren(node)
    options.onAnnounce?.(message, politeness)

    // A newer message takes over the region, so the older message's timer must
    // not fire and wipe it.
    if (lane.clearTimer !== undefined) clearTimeout(lane.clearTimer)
    if (clearAfterMs > 0) {
      lane.clearTimer = setTimeout(() => lane.region.replaceChildren(), clearAfterMs)
    }
  }

  function pump(politeness: Politeness): void {
    if (destroyed || !ready) return
    const lane = lanes[politeness]
    if (lane.busy) return
    const next = lane.queue.shift()
    if (!next) return
    place(politeness, next.message)
    lane.busy = true
    lane.gapTimer = setTimeout(() => {
      lane.busy = false
      pump(politeness)
    }, minGapMs)
  }

  return {
    announce(message, announceOptions = {}) {
      if (destroyed) return
      const text = message.trim()
      if (!text) return
      const politeness = announceOptions.politeness ?? 'polite'
      const key = announceOptions.key
      const lane = lanes[politeness]

      if (key !== undefined) {
        lane.queue = lane.queue.filter((item) => item.key !== key)
      }
      // The same words twice in a row while both wait add nothing.
      if (lane.queue.some((item) => item.message === text)) return

      lane.queue.push({ message: text, key })
      while (lane.queue.length > maxQueue) lane.queue.shift()
      pump(politeness)
    },

    clear() {
      for (const lane of Object.values(lanes)) {
        lane.queue = []
        lane.region.replaceChildren()
        if (lane.clearTimer !== undefined) clearTimeout(lane.clearTimer)
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      if (readyTimer !== undefined) clearTimeout(readyTimer)
      for (const lane of Object.values(lanes)) {
        if (lane.gapTimer !== undefined) clearTimeout(lane.gapTimer)
        if (lane.clearTimer !== undefined) clearTimeout(lane.clearTimer)
        lane.queue = []
      }
      root.remove()
    },

    regions: { polite: lanes.polite.region, assertive: lanes.assertive.region },
  }
}
