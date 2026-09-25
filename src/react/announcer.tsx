import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { createAnnouncer } from '../announcer'
import type { AnnounceOptions, AnnouncerOptions } from '../announcer'
import { createCallAnnouncer } from '../call'
import type { AnnounceTarget, CallAnnouncer, CallAnnouncerOptions } from '../call'

export interface AnnouncerHandle extends AnnounceTarget {
  clear(): void
}

const AnnouncerContext = createContext<AnnouncerHandle | null>(null)

/** Messages held before the live regions exist. A call screen rarely needs more. */
const MAX_BUFFERED = 20

/**
 * Creates the live regions once the call screen has mounted and keeps them for
 * as long as it stays. Place it high, above anything that speaks.
 *
 * Options are read once, when the provider mounts.
 *
 * The regions are created in an effect, so nothing touches the DOM during
 * server rendering. Anything said before they exist is held and spoken as soon
 * as they do.
 */
export function AnnouncerProvider({
  children,
  ...options
}: AnnouncerOptions & { children?: ReactNode }) {
  const initialOptions = useRef(options)

  const handle = useMemo(() => {
    let live: ReturnType<typeof createAnnouncer> | undefined
    let buffer: Array<[string, AnnounceOptions | undefined]> = []
    return {
      attach(next: ReturnType<typeof createAnnouncer>) {
        live = next
        for (const [message, announceOptions] of buffer) next.announce(message, announceOptions)
        buffer = []
      },
      detach() {
        live = undefined
      },
      announce(message: string, announceOptions?: AnnounceOptions) {
        if (live) live.announce(message, announceOptions)
        else if (buffer.length < MAX_BUFFERED) buffer.push([message, announceOptions])
      },
      clear() {
        buffer = []
        live?.clear()
      },
    }
  }, [])

  useEffect(() => {
    const announcer = createAnnouncer(initialOptions.current)
    handle.attach(announcer)
    return () => {
      handle.detach()
      announcer.destroy()
    }
  }, [handle])

  return <AnnouncerContext.Provider value={handle}>{children}</AnnouncerContext.Provider>
}

/** `announce` and `clear`, from the nearest `AnnouncerProvider`. */
export function useAnnouncer(): AnnouncerHandle {
  const handle = useContext(AnnouncerContext)
  if (!handle) {
    throw new Error('call-a11y: useAnnouncer must be used inside <AnnouncerProvider>.')
  }
  return handle
}

/** The announcer for the provider's context, or `null` when there is no provider. */
export function useOptionalAnnouncer(): AnnouncerHandle | null {
  return useContext(AnnouncerContext)
}

/**
 * The call-event announcer, speaking through the nearest `AnnouncerProvider`.
 * Options are read once, on the first render.
 */
export function useCallAnnouncer(options?: CallAnnouncerOptions): CallAnnouncer {
  const handle = useAnnouncer()
  const initialOptions = useRef(options)
  const callAnnouncer = useMemo(
    () => createCallAnnouncer(handle, initialOptions.current),
    [handle],
  )
  // `dispose` only cancels timers, so React StrictMode's mount, unmount, mount
  // sequence leaves it fully usable.
  useEffect(() => () => callAnnouncer.dispose(), [callAnnouncer])
  return callAnnouncer
}
