import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AnnouncerProvider,
  CaptionLogView,
  ToggleButton,
  useCallAnnouncer,
  useCaptionLog,
  useShortcuts,
  type ActionSource,
  type CaptionLog,
  type Politeness,
} from 'call-a11y/react'

/**
 * A simulated call. No audio, no video, no network: buttons fire the events a
 * call app would receive from its media layer, and call-a11y decides what a
 * screen reader is told. The panel on the right shows exactly what was placed
 * in the live regions. It shows what the library *sent*; what a particular
 * screen reader then does with it is what the README asks testers to report.
 */

interface Entry {
  id: number
  message: string
  politeness: Politeness
}
interface History {
  entries: Entry[]
  total: number
}

const NAMES = [
  'Jo', 'Lee', 'Kim', 'Ana', 'Raj', 'Mei', 'Tom', 'Eva', 'Ravi', 'Zoe', 'Ben', 'Ida', 'Omar', 'Nia', 'Ali', 'Sue',
]
const nameFor = (index: number) =>
  `${NAMES[index % NAMES.length]}${index >= NAMES.length ? ` ${Math.floor(index / NAMES.length) + 1}` : ''}`

const SCRIPT = [
  { speakerId: 'priya', speaker: 'Priya', text: 'Thanks for joining, everyone. Let us start with last week.' },
  { speakerId: 'sam', speaker: 'Sam', text: 'Signups are up twelve percent, mostly from the referral programme.' },
  { speakerId: 'sam', speaker: 'Sam', text: 'Support tickets are flat.' },
  { speakerId: 'priya', speaker: 'Priya', text: 'Good. Any blockers on the release?' },
  { speakerId: 'jo', speaker: 'Jo', text: 'One. The captions service times out on long calls.' },
]

/** Feeds a caption log the way a streaming recogniser would: word by word, then settled. */
function startScript(log: CaptionLog): () => void {
  let cancelled = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        resolve()
      }, ms)
      timers.add(timer)
    })

  void (async () => {
    let utterance = 0
    while (!cancelled) {
      for (const line of SCRIPT) {
        const id = `u${(utterance += 1)}`
        const words = line.text.split(' ')
        for (let count = 1; count <= words.length; count += 1) {
          if (cancelled) return
          log.push({ id, text: words.slice(0, count).join(' '), final: false, speaker: line.speaker, speakerId: line.speakerId })
          await wait(170)
        }
        if (cancelled) return
        log.push({ id, text: line.text, final: true, speaker: line.speaker, speakerId: line.speakerId })
        await wait(900)
      }
    }
  })()

  return () => {
    cancelled = true
    timers.forEach(clearTimeout)
    timers.clear()
  }
}

const icon = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const MicIcon = ({ off }: { off: boolean }) => (
  <svg {...icon}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    {off ? <path d="M3 3l18 18" /> : null}
  </svg>
)
const VideoIcon = ({ off }: { off: boolean }) => (
  <svg {...icon}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-3v10l-6-3z" />
    {off ? <path d="M3 3l18 18" /> : null}
  </svg>
)
const HandIcon = () => (
  <svg {...icon}>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 15" />
  </svg>
)

function CaptionsPanel({ speak, running }: { speak: boolean; running: boolean }) {
  // The log reads its options once, so the panel is re-mounted (see `key`
  // where it is used) when "speak captions" changes.
  const log = useCaptionLog({ announce: speak ? 'final' : 'off', skipSpeakerId: 'me' })

  useEffect(() => (running ? startScript(log) : undefined), [running, log])

  const download = () => {
    const url = URL.createObjectURL(new Blob([log.toText({ timestamps: true })], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'captions.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <CaptionLogView log={log} />
      <button type="button" className="cad-btn" onClick={download}>
        Download transcript
      </button>
    </>
  )
}

function Room({ onEvent }: { onEvent: (count?: number) => void }) {
  const call = useCallAnnouncer({ batchMs: 1200, largeCallThreshold: 20 })
  const [people, setPeople] = useState<string[]>(['Priya', 'Sam'])
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [handUp, setHandUp] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [shortcutsOn, setShortcutsOn] = useState(true)
  const [running, setRunning] = useState(false)
  const [speak, setSpeak] = useState(false)
  const nextName = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    call.setParticipantCount(people.length + 1) // you, plus everyone else
  }, [call, people.length])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      run()
    }, ms)
    timers.current.add(timer)
  }

  const changeMuted = (next: boolean, source: ActionSource) => {
    setMuted(next)
    call.microphoneChanged(!next, source)
  }
  const changeVideoOff = (next: boolean, source: ActionSource) => {
    setVideoOff(next)
    call.cameraChanged(!next, source)
  }
  const changeHand = (next: boolean) => {
    setHandUp(next)
    call.say(next ? 'You raised your hand' : 'You lowered your hand')
  }

  const { shortcuts } = useShortcuts(
    {
      'Alt+M': { description: 'Mute or unmute your microphone', handler: () => changeMuted(!muted, 'shortcut') },
      'Alt+C': { description: 'Turn your camera on or off', handler: () => changeVideoOff(!videoOff, 'shortcut') },
      'Alt+R': { description: 'Raise or lower your hand', handler: () => changeHand(!handUp) },
    },
    { enabled: shortcutsOn },
  )

  const join = (count: number) => {
    const names = Array.from({ length: count }, () => nameFor(nextName.current++))
    setPeople((current) => [...current, ...names])
    names.forEach((name) => call.participantJoined(name))
    onEvent(count)
  }

  const shownPeople = people.slice(0, 8)

  return (
    <div className="cad-col">
      <section aria-labelledby="cad-call">
        <h2 id="cad-call">The call</h2>
        <p>
          You and {people.length} {people.length === 1 ? 'other' : 'others'}:
        </p>
        <ul className="cad-people" aria-label="Participants">
          {shownPeople.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {people.length > shownPeople.length ? <li>and {people.length - shownPeople.length} more</li> : null}
        </ul>
        <div role="group" aria-label="Call controls" className="cad-toolbar">
          <ToggleButton label="Mute" showLabel pressed={muted} onPressedChange={(next) => changeMuted(next, 'control')} icon={<MicIcon off={muted} />} />
          <ToggleButton label="Stop video" showLabel pressed={videoOff} onPressedChange={(next) => changeVideoOff(next, 'control')} icon={<VideoIcon off={videoOff} />} />
          <ToggleButton label="Raise hand" showLabel pressed={handUp} onPressedChange={changeHand} icon={<HandIcon />} />
        </div>
        <p className="cad-note">
          Each button has a fixed name; its state is <code>aria-pressed</code>, so a screen reader says
          &ldquo;Mute, toggle button, pressed&rdquo;.
        </p>
      </section>

      <section aria-labelledby="cad-shortcuts">
        <h2 id="cad-shortcuts">Keyboard shortcuts</h2>
        <ToggleButton label="Keyboard shortcuts" showLabel pressed={shortcutsOn} onPressedChange={setShortcutsOn} />
        <dl className="cad-keys">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.combo}>
              <dt>
                <kbd>{shortcut.label}</kbd>
              </dt>
              <dd>{shortcut.description}</dd>
            </div>
          ))}
        </dl>
        <p className="cad-note">
          Every shortcut needs a modifier, because screen readers use bare letters to navigate (WCAG
          2.1.4), and they can be switched off. A change made by shortcut is announced, since focus is
          not on the button to report it.
        </p>
      </section>

      <section aria-labelledby="cad-sim">
        <h2 id="cad-sim">Simulate what happens around you</h2>
        <div className="cad-buttons">
          <button type="button" className="cad-btn" onClick={() => join(1)}>One person joins</button>
          <button type="button" className="cad-btn" onClick={() => join(5)}>Five people join at once</button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              call.participantLeft('Sam')
              later(600, () => call.participantJoined('Sam'))
              onEvent(2)
            }}
          >
            Sam drops and comes straight back
          </button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              const fillers = Array.from({ length: 30 }, () => nameFor(nextName.current++))
              setPeople((current) => [...current, ...fillers])
              // The count is set here as well as by the effect, so the burst
              // below already sees a large call.
              call.setParticipantCount(people.length + 1 + fillers.length)
              join(6)
            }}
          >
            A 40-person webinar: six join
          </button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              call.handRaised('Sam')
              onEvent()
            }}
          >
            Sam raises a hand
          </button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              call.screenShareChanged(!sharing, 'Priya')
              setSharing(!sharing)
              onEvent()
            }}
          >
            Priya {sharing ? 'stops' : 'starts'} sharing
          </button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              call.recordingChanged(!recording)
              setRecording(!recording)
              onEvent()
            }}
          >
            {recording ? 'Stop' : 'Start'} recording
          </button>
          <button
            type="button"
            className="cad-btn"
            onClick={() => {
              call.connectionChanged('reconnecting')
              later(3000, () => call.connectionChanged('connected'))
              onEvent(2)
            }}
          >
            Lose the connection for 3 seconds
          </button>
        </div>
      </section>

      <section aria-labelledby="cad-captions">
        <h2 id="cad-captions">Live captions</h2>
        <div className="cad-buttons">
          <ToggleButton label="Simulated speech" showLabel pressed={running} onPressedChange={setRunning} />
          <ToggleButton label="Speak captions aloud" showLabel pressed={speak} onPressedChange={setSpeak} />
        </div>
        <CaptionsPanel key={speak ? 'speak' : 'quiet'} speak={speak} running={running} />
        <p className="cad-note">
          The log can be read, scrolled and searched, and it never interrupts. Unsettled words are never
          spoken. Turn on &ldquo;Speak captions aloud&rdquo; for a reader who cannot hear the call; only
          settled captions are spoken, joined per speaker.
        </p>
      </section>
    </div>
  )
}

export function CallDemo() {
  const [history, setHistory] = useState<History>({ entries: [], total: 0 })
  const [events, setEvents] = useState(0)
  const sequence = useRef(0)

  const record = useCallback((message: string, politeness: Politeness) => {
    const id = (sequence.current += 1)
    setHistory((current) => ({
      total: current.total + 1,
      entries: [{ id, message, politeness }, ...current.entries].slice(0, 40),
    }))
  }, [])

  return (
    <AnnouncerProvider onAnnounce={record}>
      <div className="cad">
        <Room onEvent={(count = 1) => setEvents((current) => current + count)} />
        <div className="cad-col">
          <section aria-labelledby="cad-history">
            <h2 id="cad-history">What was sent to the live regions</h2>
            <p className="cad-stat">
              Events fired: <strong>{events}</strong> &middot; Messages sent: <strong>{history.total}</strong>
            </p>
            <div role="log" aria-live="off" aria-label="Announcement history, newest first" tabIndex={0} className="cad-history">
              {history.entries.length === 0 ? (
                <p>Nothing yet. Press a button on the left.</p>
              ) : (
                history.entries.map((entry) => (
                  <p key={entry.id}>
                    <span className="cad-badge" data-politeness={entry.politeness}>
                      {entry.politeness}
                    </span>{' '}
                    {entry.message}
                  </p>
                ))
              )}
            </div>
            <p className="cad-note">
              This panel is not a live region, so nothing here is read twice. Polite messages wait for a
              pause in speech; assertive ones (recording, lost connection) can interrupt.
            </p>
          </section>
        </div>
      </div>
    </AnnouncerProvider>
  )
}
