import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
} from 'react'
import { createCaptionLog } from '../captions'
import type { CaptionLog, CaptionLogOptions } from '../captions'
import { useOptionalAnnouncer } from './announcer'

/**
 * A caption log that lives as long as the component. When `announce: 'final'`
 * is set and no `announcer` is given, it speaks through the nearest
 * `AnnouncerProvider`. Options are read once, on the first render.
 */
export function useCaptionLog(options: CaptionLogOptions = {}): CaptionLog {
  const announcer = useOptionalAnnouncer()
  const initialOptions = useRef(options)
  const ref = useRef<CaptionLog | null>(null)
  if (ref.current === null) {
    const initial = initialOptions.current
    ref.current = createCaptionLog({ ...initial, announcer: initial.announcer ?? announcer ?? undefined })
  }
  const log = ref.current
  useEffect(() => () => log.dispose(), [log])
  return log
}

export interface CaptionLogViewProps {
  log: CaptionLog
  /** Accessible name of the log. Default "Live captions". */
  label?: string
  /** Text of the button that resumes following the newest caption. Default "Jump to latest captions". */
  jumpLabel?: string
  /** Shown while there are no captions. Pass an empty string for nothing. Default "No captions yet." */
  emptyText?: string
  className?: string
}

/** How far from the bottom still counts as "following the newest caption", in px. */
const FOLLOW_SLACK = 24

// useLayoutEffect warns when React 18 renders on the server.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Live captions as a readable log.
 *
 * - `role="log"` with `aria-live="off"`: a screen reader user can browse the
 *   captions but is not interrupted by them. Speaking captions is a choice
 *   made on the caption log (`announce: 'final'`), not something this
 *   component does.
 * - The log is focusable so keyboard users can scroll it.
 * - It follows the newest caption, and stops following while the reader has
 *   scrolled up or has focus inside it, so text does not move under them
 *   (WCAG 2.2.2, Pause, Stop, Hide). A button resumes it.
 * - Scrolling is instant, never animated.
 */
export function CaptionLogView({
  log,
  label = 'Live captions',
  jumpLabel = 'Jump to latest captions',
  emptyText = 'No captions yet.',
  className,
}: CaptionLogViewProps) {
  const { turns } = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolledUp = useRef(false)
  const focusInside = useRef(false)
  const [paused, setPaused] = useState(false)

  const sync = () => setPaused(scrolledUp.current || focusInside.current)

  useIsomorphicLayoutEffect(() => {
    const element = scroller.current
    if (!paused && element) element.scrollTop = element.scrollHeight
  }, [turns, paused])

  useEffect(() => {
    // Keep the flag right if the log is swapped for another.
    scrolledUp.current = false
    focusInside.current = false
    setPaused(false)
  }, [log])

  return (
    <div className={['call-a11y-captions', className].filter(Boolean).join(' ')} data-paused={paused}>
      <div
        ref={scroller}
        role="log"
        aria-live="off"
        aria-label={label}
        tabIndex={0}
        className="call-a11y-captions-log"
        onScroll={(event) => {
          const element = event.currentTarget
          scrolledUp.current =
            element.scrollHeight - element.scrollTop - element.clientHeight > FOLLOW_SLACK
          sync()
        }}
        onFocus={() => {
          focusInside.current = true
          sync()
        }}
        onBlur={(event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            focusInside.current = false
            sync()
          }
        }}
      >
        {turns.length === 0 && emptyText ? <p data-call-a11y-empty="">{emptyText}</p> : null}
        {turns.map((turn) => (
          <p key={turn.id} data-call-a11y-turn="">
            {turn.speaker ? (
              <>
                <span data-call-a11y-speaker="">{turn.speaker}:</span>{' '}
              </>
            ) : null}
            {turn.text}
            {turn.interim ? (
              <span data-call-a11y-interim="">
                {turn.text ? ' ' : ''}
                {turn.interim}
              </span>
            ) : null}
          </p>
        ))}
      </div>
      {paused ? (
        <button
          type="button"
          className="call-a11y-captions-jump"
          onClick={() => {
            scrolledUp.current = false
            focusInside.current = false
            sync()
            const element = scroller.current
            if (element) element.scrollTop = element.scrollHeight
          }}
        >
          {jumpLabel}
        </button>
      ) : null}
    </div>
  )
}
