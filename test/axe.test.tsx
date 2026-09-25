import { act, render } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import {
  AnnouncerProvider,
  CaptionLogView,
  ToggleButton,
  useCaptionLog,
  type CaptionLog,
} from '../src/react'

/**
 * axe-core finds structural problems: missing names, bad ARIA, focus traps.
 * It cannot say what a screen reader will speak, and it cannot compute colour
 * contrast in jsdom, so that rule is off. These runs are a floor, not a
 * conformance claim.
 */
async function violations(node: HTMLElement) {
  const results = await axe.run(node, {
    rules: {
      'color-contrast': { enabled: false }, // jsdom has no layout or paint
      region: { enabled: false }, // a component fragment is not a page
    },
  })
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)
}

describe('axe-core', () => {
  it('finds nothing wrong with a call toolbar, captions and the live regions together', async () => {
    let log!: CaptionLog
    function Room() {
      log = useCaptionLog()
      return (
        <main>
          <h1>Weekly review</h1>
          <div role="toolbar" aria-label="Call controls">
            <ToggleButton label="Mute" pressed onPressedChange={() => {}} icon={<svg width="16" height="16" />} />
            <ToggleButton label="Camera" pressed={false} onPressedChange={() => {}} icon={<svg width="16" height="16" />} />
            <ToggleButton label="Raise hand" pressed={false} onPressedChange={() => {}} showLabel />
          </div>
          <CaptionLogView log={log} />
        </main>
      )
    }
    const { container } = render(
      <AnnouncerProvider>
        <Room />
      </AnnouncerProvider>,
    )
    act(() => {
      log.push({ id: '1', text: 'Good morn', final: false, speaker: 'Sam', speakerId: 's', time: 0 })
      log.push({ id: '2', text: 'Hello everyone.', speaker: 'Priya', speakerId: 'p', time: 100 })
    })

    // Run on the whole document so the announcer's own regions are checked too.
    expect(await violations(document.body)).toEqual([])
    expect(container.querySelector('[role="log"]')).not.toBeNull()
  })

  it('finds nothing wrong with the empty caption state', async () => {
    function Room() {
      const log = useCaptionLog()
      return <CaptionLogView log={log} />
    }
    render(<Room />)
    expect(await violations(document.body)).toEqual([])
  })

  it('does catch a toggle without a name, so the check is not vacuous', async () => {
    const { container } = render(
      <button type="button" aria-pressed="false">
        <svg width="16" height="16" />
      </button>,
    )
    const found = await violations(container)
    expect(found.some((line) => line.startsWith('button-name'))).toBe(true)
  })
})
