import { StrictMode, useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnnouncerProvider,
  CaptionLogView,
  ToggleButton,
  useAnnouncer,
  useCallAnnouncer,
  useCaptionLog,
  useShortcuts,
  type CaptionLog,
} from '../src/react'

const politeText = () =>
  document.querySelector('[data-call-a11y-region="polite"]')?.textContent ?? null
const assertiveText = () =>
  document.querySelector('[data-call-a11y-region="assertive"]')?.textContent ?? null
const announcerRoots = () => document.querySelectorAll('[data-call-a11y-announcer]').length

afterEach(() => {
  vi.useRealTimers()
})

describe('AnnouncerProvider', () => {
  it('creates the live regions when the call screen mounts and removes them when it goes', () => {
    const { unmount } = render(<AnnouncerProvider>content</AnnouncerProvider>)
    expect(announcerRoots()).toBe(1)
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull()
    expect(document.querySelector('[role="alert"][aria-live="assertive"]')).not.toBeNull()

    unmount()
    expect(announcerRoots()).toBe(0)
  })

  it('leaves exactly one set of regions under StrictMode, which mounts twice', () => {
    render(
      <StrictMode>
        <AnnouncerProvider>content</AnnouncerProvider>
      </StrictMode>,
    )
    expect(announcerRoots()).toBe(1)
  })

  it('speaks a message a child sent before the regions existed', () => {
    vi.useFakeTimers()
    // Child effects run before the provider's own effect, so this message is
    // sent before the regions exist.
    function Early() {
      const { announce } = useAnnouncer()
      useEffect(() => announce('Call connected'), [announce])
      return null
    }
    render(
      <AnnouncerProvider readyMs={0}>
        <Early />
      </AnnouncerProvider>,
    )
    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(politeText()).toBe('Call connected')
  })

  it('passes its options to the announcer', () => {
    vi.useFakeTimers()
    const onAnnounce = vi.fn()
    function Speaker() {
      const { announce } = useAnnouncer()
      return <button onClick={() => announce('Hello', { politeness: 'assertive' })}>speak</button>
    }
    render(
      <AnnouncerProvider readyMs={0} onAnnounce={onAnnounce}>
        <Speaker />
      </AnnouncerProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'speak' }))
    expect(onAnnounce).toHaveBeenCalledWith('Hello', 'assertive')
    expect(assertiveText()).toBe('Hello')
  })

  it('makes useAnnouncer fail loudly outside a provider', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Lost() {
      useAnnouncer()
      return null
    }
    expect(() => render(<Lost />)).toThrow(/AnnouncerProvider/)
    error.mockRestore()
  })
})

describe('useCallAnnouncer', () => {
  function Room() {
    const call = useCallAnnouncer({ batchMs: 1000 })
    return (
      <>
        <button onClick={() => call.participantJoined('Sam')}>Sam joins</button>
        <button onClick={() => call.participantJoined('Priya')}>Priya joins</button>
        <button onClick={() => call.recordingChanged(true)}>Record</button>
      </>
    )
  }

  it('batches joins into one line in the polite region', () => {
    vi.useFakeTimers()
    render(
      <AnnouncerProvider readyMs={0}>
        <Room />
      </AnnouncerProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sam joins' }))
    fireEvent.click(screen.getByRole('button', { name: 'Priya joins' }))
    expect(politeText()).toBe('')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(politeText()).toBe('Sam and Priya joined')
  })

  it('puts a recording notice in the assertive region', () => {
    vi.useFakeTimers()
    render(
      <AnnouncerProvider readyMs={0}>
        <Room />
      </AnnouncerProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect(assertiveText()).toBe('Recording started')
  })

  it('still works after StrictMode has mounted, unmounted and mounted it again', () => {
    vi.useFakeTimers()
    render(
      <StrictMode>
        <AnnouncerProvider readyMs={0}>
          <Room />
        </AnnouncerProvider>
      </StrictMode>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sam joins' }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(politeText()).toBe('Sam joined')
  })
})

describe('ToggleButton', () => {
  function Mute({ onChange }: { onChange?: (next: boolean) => void }) {
    const [muted, setMuted] = useState(false)
    return (
      <ToggleButton
        label="Mute"
        pressed={muted}
        onPressedChange={(next) => {
          setMuted(next)
          onChange?.(next)
        }}
      />
    )
  }

  it('keeps its name fixed and carries the state in aria-pressed', async () => {
    const user = userEvent.setup()
    render(<Mute />)
    const button = screen.getByRole('button', { name: 'Mute' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    await user.click(button)
    expect(screen.getByRole('button', { name: 'Mute' })).toBe(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')

    await user.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('works from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Mute onChange={onChange} />)
    await user.tab()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onChange.mock.calls).toEqual([[true], [false]])
  })

  it('is a real button that does not submit a form', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Mute />
      </form>,
    )
    const button = screen.getByRole('button', { name: 'Mute' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('hides a decorative icon from assistive technology', () => {
    render(<ToggleButton label="Camera" pressed={false} onPressedChange={() => {}} icon={<svg data-testid="icon" />} />)
    const wrapper = screen.getByTestId('icon').parentElement
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button', { name: 'Camera' })).toBeTruthy()
  })

  it('uses visible text as the name when showLabel is set, with no aria-label to contradict it', () => {
    render(<ToggleButton label="Raise hand" pressed={false} onPressedChange={() => {}} showLabel />)
    const button = screen.getByRole('button', { name: 'Raise hand' })
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(button.textContent).toBe('Raise hand')
  })

  it('does not fire when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleButton label="Mute" pressed={false} onPressedChange={onChange} disabled />)
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lets an onClick handler cancel the change', () => {
    const onChange = vi.fn()
    render(
      <ToggleButton
        label="Mute"
        pressed={false}
        onPressedChange={onChange}
        onClick={(event) => event.preventDefault()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('CaptionLogView', () => {
  function Captions({ onLog }: { onLog?: (log: CaptionLog) => void }) {
    const log = useCaptionLog({ mergeWithinMs: 4000 })
    onLog?.(log)
    return <CaptionLogView log={log} />
  }

  function setup() {
    let log!: CaptionLog
    render(<Captions onLog={(l) => (log = l)} />)
    return log
  }

  it('is a focusable, named log that does not speak on its own', () => {
    setup()
    const log = screen.getByRole('log', { name: 'Live captions' })
    expect(log.getAttribute('aria-live')).toBe('off')
    expect(log.getAttribute('tabindex')).toBe('0')
  })

  it('says so while there is nothing to show, and can be silent about it', () => {
    const { unmount } = render(<CaptionLogView log={setupLog()} />)
    expect(screen.getByText('No captions yet.')).toBeTruthy()
    unmount()

    render(<CaptionLogView log={setupLog()} emptyText="" />)
    expect(screen.queryByText('No captions yet.')).toBeNull()
  })

  function setupLog() {
    let log!: CaptionLog
    function Grab() {
      log = useCaptionLog()
      return null
    }
    render(<Grab />)
    return log
  }

  it('shows settled and unsettled text with the speaker, and updates as results arrive', () => {
    const log = setup()

    act(() => log.push({ id: '1', text: 'good mor', final: false, speaker: 'Sam', speakerId: 's', time: 0 }))
    const region = screen.getByRole('log')
    expect(region.textContent).toContain('Sam:')
    expect(region.querySelector('[data-call-a11y-interim]')?.textContent).toBe('good mor')

    act(() => log.push({ id: '1', text: 'Good morning.', final: true, speaker: 'Sam', speakerId: 's', time: 100 }))
    expect(region.querySelector('[data-call-a11y-interim]')).toBeNull()
    expect(region.textContent).toContain('Good morning.')
    expect(region.querySelectorAll('[data-call-a11y-turn]')).toHaveLength(1)
  })

  it('stops following, and offers a way back, while the reader has focus inside it', () => {
    const log = setup()
    act(() => log.push({ id: '1', text: 'Hello.', time: 0 }))
    const region = screen.getByRole('log')
    expect(screen.queryByRole('button', { name: 'Jump to latest captions' })).toBeNull()

    fireEvent.focus(region)
    const jump = screen.getByRole('button', { name: 'Jump to latest captions' })

    fireEvent.blur(region, { relatedTarget: jump })
    fireEvent.click(jump)
    expect(screen.queryByRole('button', { name: 'Jump to latest captions' })).toBeNull()
  })

  it('stops following when the reader scrolls up, and resumes on request', () => {
    const log = setup()
    act(() => log.push({ id: '1', text: 'Hello.', time: 0 }))
    const region = screen.getByRole('log')

    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 })

    fireEvent.scroll(region)
    const jump = screen.getByRole('button', { name: 'Jump to latest captions' })

    fireEvent.click(jump)
    expect(region.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: 'Jump to latest captions' })).toBeNull()
  })

  it('follows the newest caption while the reader is at the bottom', () => {
    const log = setup()
    const region = screen.getByRole('log')
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 640 })
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: 0 })

    act(() => log.push({ id: '1', text: 'Hello.', time: 0 }))
    expect(region.scrollTop).toBe(640)
  })

  it('can carry a custom label', () => {
    render(<CaptionLogView log={setupLog()} label="Interpreter captions" />)
    expect(screen.getByRole('log', { name: 'Interpreter captions' })).toBeTruthy()
  })
})

describe('useCaptionLog', () => {
  it('speaks settled captions through the provider when announce is "final"', () => {
    vi.useFakeTimers()
    let log!: CaptionLog
    function Speaking() {
      log = useCaptionLog({ announce: 'final', announceBatchMs: 500 })
      return null
    }
    render(
      <AnnouncerProvider readyMs={0}>
        <Speaking />
      </AnnouncerProvider>,
    )

    act(() => log.push({ id: '1', text: 'Hello.', speaker: 'Sam', time: 0 }))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(politeText()).toBe('Sam: Hello.')
  })

  it('returns the same log on every render', () => {
    const seen = new Set<CaptionLog>()
    function Probe() {
      const [, setN] = useState(0)
      seen.add(useCaptionLog())
      return <button onClick={() => setN((n) => n + 1)}>again</button>
    }
    render(<Probe />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(seen.size).toBe(1)
  })
})

describe('useShortcuts', () => {
  function press(init: KeyboardEventInit) {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    })
  }

  it('registers while mounted and lists the shortcuts for a help dialog', () => {
    const handler = vi.fn()
    function Room() {
      const { shortcuts } = useShortcuts(
        { 'Ctrl+Shift+M': { description: 'Mute or unmute', handler } },
        { platform: 'other' },
      )
      return (
        <ul>
          {shortcuts.map((s) => (
            <li key={s.combo}>
              {s.label}: {s.description}
            </li>
          ))}
        </ul>
      )
    }
    const { unmount } = render(<Room />)
    expect(screen.getByText('Ctrl+Shift+M: Mute or unmute')).toBeTruthy()

    press({ key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true })
    expect(handler).toHaveBeenCalledTimes(1)

    unmount()
    press({ key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('always runs the latest handler, so it can use current state', () => {
    const seen: number[] = []
    function Room({ count }: { count: number }) {
      useShortcuts(
        { 'Ctrl+M': { description: 'Log', handler: () => seen.push(count) } },
        { platform: 'other' },
      )
      return null
    }
    const { rerender } = render(<Room count={1} />)
    rerender(<Room count={2} />)
    press({ key: 'm', ctrlKey: true })
    expect(seen).toEqual([2])
  })

  it('can be switched off', () => {
    const handler = vi.fn()
    function Room({ enabled }: { enabled: boolean }) {
      useShortcuts({ 'Ctrl+M': { description: 'Log', handler } }, { platform: 'other', enabled })
      return null
    }
    const { rerender } = render(<Room enabled />)
    rerender(<Room enabled={false} />)
    press({ key: 'm', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()

    rerender(<Room enabled />)
    press({ key: 'm', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('refuses a bare character key, as the core does', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Room() {
      useShortcuts({ m: { description: 'Mute', handler: () => {} } }, { platform: 'other' })
      return null
    }
    expect(() => render(<Room />)).toThrow(/2\.1\.4/)
    error.mockRestore()
  })
})
