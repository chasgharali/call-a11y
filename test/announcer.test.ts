import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAnnouncer } from '../src'

const polite = (a: ReturnType<typeof createAnnouncer>) => a.regions.polite.textContent
const assertive = (a: ReturnType<typeof createAnnouncer>) => a.regions.assertive.textContent

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('regions', () => {
  it('creates a polite status region and an assertive alert region, both atomic', () => {
    const announcer = createAnnouncer()
    const { polite: p, assertive: a } = announcer.regions

    expect(p.getAttribute('role')).toBe('status')
    expect(p.getAttribute('aria-live')).toBe('polite')
    expect(p.getAttribute('aria-atomic')).toBe('true')
    expect(a.getAttribute('role')).toBe('alert')
    expect(a.getAttribute('aria-live')).toBe('assertive')
    expect(a.getAttribute('aria-atomic')).toBe('true')
    expect(document.body.contains(p) && document.body.contains(a)).toBe(true)
  })

  it('hides the regions visually without removing them from the accessibility tree', () => {
    const { regions } = createAnnouncer()
    for (const region of [regions.polite, regions.assertive]) {
      expect(region.style.display).not.toBe('none')
      expect(region.getAttribute('aria-hidden')).toBeNull()
      expect(region.style.position).toBe('absolute')
      expect(region.style.width).toBe('1px')
    }
  })

  it('appends to a container when one is given', () => {
    const container = document.createElement('dialog')
    document.body.append(container)
    const announcer = createAnnouncer({ container })
    expect(container.contains(announcer.regions.polite)).toBe(true)
  })

  it('throws a clear error when there is no DOM', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(() => createAnnouncer()).toThrow(/needs a DOM/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('placing messages', () => {
  it('waits for the regions to be registered before the first message', () => {
    const announcer = createAnnouncer({ readyMs: 100 })
    announcer.announce('Sam joined')

    expect(polite(announcer)).toBe('')
    vi.advanceTimersByTime(99)
    expect(polite(announcer)).toBe('')
    vi.advanceTimersByTime(1)
    expect(polite(announcer)).toBe('Sam joined')
  })

  it('routes polite to the status region and assertive to the alert region', () => {
    const announcer = createAnnouncer({ readyMs: 0 })
    announcer.announce('Sam joined')
    announcer.announce('Recording started', { politeness: 'assertive' })

    expect(polite(announcer)).toBe('Sam joined')
    expect(assertive(announcer)).toBe('Recording started')
  })

  it('ignores empty and whitespace-only messages', () => {
    const onAnnounce = vi.fn()
    const announcer = createAnnouncer({ readyMs: 0, onAnnounce })
    announcer.announce('')
    announcer.announce('   ')
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('places every message as a fresh element, so a repeat is still a DOM addition', () => {
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400 })
    announcer.announce('Reconnecting', { politeness: 'assertive' })
    const first = announcer.regions.assertive.firstElementChild

    vi.advanceTimersByTime(400)
    announcer.announce('Reconnecting', { politeness: 'assertive' })
    const second = announcer.regions.assertive.firstElementChild

    expect(second?.textContent).toBe('Reconnecting')
    expect(second).not.toBe(first)
  })

  it('reports each placed message to onAnnounce', () => {
    const onAnnounce = vi.fn()
    const announcer = createAnnouncer({ readyMs: 0, onAnnounce })
    announcer.announce('Sam joined')
    announcer.announce('Reconnecting', { politeness: 'assertive' })
    expect(onAnnounce).toHaveBeenCalledWith('Sam joined', 'polite')
    expect(onAnnounce).toHaveBeenCalledWith('Reconnecting', 'assertive')
  })
})

describe('pacing', () => {
  it('spaces messages in one region by minGapMs', () => {
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400 })
    announcer.announce('One')
    announcer.announce('Two')

    expect(polite(announcer)).toBe('One')
    vi.advanceTimersByTime(399)
    expect(polite(announcer)).toBe('One')
    vi.advanceTimersByTime(1)
    expect(polite(announcer)).toBe('Two')
  })

  it('does not make the assertive region wait for the polite one', () => {
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400 })
    announcer.announce('One')
    announcer.announce('Reconnecting', { politeness: 'assertive' })
    expect(assertive(announcer)).toBe('Reconnecting')
  })

  it('lets a newer message with the same key replace one that is still waiting', () => {
    const spoken: string[] = []
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400, onAnnounce: (m) => spoken.push(m) })

    announcer.announce('Sam joined')
    announcer.announce('Microphone off', { key: 'microphone' })
    announcer.announce('Microphone on', { key: 'microphone' })
    announcer.announce('Microphone off', { key: 'microphone' })
    vi.advanceTimersByTime(2000)

    expect(spoken).toEqual(['Sam joined', 'Microphone off'])
  })

  it('does not take back a message that has already been placed', () => {
    const spoken: string[] = []
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400, onAnnounce: (m) => spoken.push(m) })

    announcer.announce('Microphone off', { key: 'microphone' })
    announcer.announce('Microphone on', { key: 'microphone' })
    vi.advanceTimersByTime(2000)

    expect(spoken).toEqual(['Microphone off', 'Microphone on'])
  })

  it('does not queue the same words twice while both are waiting', () => {
    const spoken: string[] = []
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400, onAnnounce: (m) => spoken.push(m) })

    announcer.announce('Sam joined')
    announcer.announce('Priya joined')
    announcer.announce('Priya joined')
    vi.advanceTimersByTime(2000)

    expect(spoken).toEqual(['Sam joined', 'Priya joined'])
  })

  it('drops the oldest waiting messages past maxQueue rather than falling behind', () => {
    const spoken: string[] = []
    const announcer = createAnnouncer({
      readyMs: 0,
      minGapMs: 400,
      maxQueue: 2,
      onAnnounce: (m) => spoken.push(m),
    })

    for (const name of ['A', 'B', 'C', 'D', 'E']) announcer.announce(`${name} joined`)
    vi.advanceTimersByTime(5000)

    // A was placed at once; of the four that waited, only the newest two stay.
    expect(spoken).toEqual(['A joined', 'D joined', 'E joined'])
  })
})

describe('clearing', () => {
  it('removes a message from its region after clearAfterMs', () => {
    const announcer = createAnnouncer({ readyMs: 0, clearAfterMs: 8000 })
    announcer.announce('Sam joined')
    vi.advanceTimersByTime(7999)
    expect(polite(announcer)).toBe('Sam joined')
    vi.advanceTimersByTime(1)
    expect(polite(announcer)).toBe('')
  })

  it('does not clear a newer message when an older message expires', () => {
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400, clearAfterMs: 1000 })
    announcer.announce('One')
    vi.advanceTimersByTime(600)
    announcer.announce('Two')
    vi.advanceTimersByTime(600) // One's timer would have fired at 1000
    expect(polite(announcer)).toBe('Two')
  })

  it('keeps messages when clearAfterMs is 0', () => {
    const announcer = createAnnouncer({ readyMs: 0, clearAfterMs: 0 })
    announcer.announce('Sam joined')
    vi.advanceTimersByTime(60_000)
    expect(polite(announcer)).toBe('Sam joined')
  })

  it('clear() drops what is queued and empties both regions', () => {
    const spoken: string[] = []
    const announcer = createAnnouncer({ readyMs: 0, minGapMs: 400, onAnnounce: (m) => spoken.push(m) })
    announcer.announce('One')
    announcer.announce('Two')
    announcer.announce('Recording started', { politeness: 'assertive' })

    announcer.clear()
    vi.advanceTimersByTime(2000)

    expect(polite(announcer)).toBe('')
    expect(assertive(announcer)).toBe('')
    expect(spoken).toEqual(['One', 'Recording started'])
  })

  it('destroy() removes the regions and later calls do nothing', () => {
    const onAnnounce = vi.fn()
    const announcer = createAnnouncer({ readyMs: 0, onAnnounce })
    const { polite: region } = announcer.regions

    announcer.destroy()
    announcer.announce('Sam joined')
    announcer.destroy() // idempotent

    expect(document.body.contains(region)).toBe(false)
    expect(onAnnounce).not.toHaveBeenCalled()
  })

  it('destroy() before the regions are ready cancels the first message', () => {
    const onAnnounce = vi.fn()
    const announcer = createAnnouncer({ readyMs: 100, onAnnounce })
    announcer.announce('Sam joined')
    announcer.destroy()
    vi.advanceTimersByTime(1000)
    expect(onAnnounce).not.toHaveBeenCalled()
  })
})
