/**
 * Keyboard shortcuts for a call UI that do not fight a screen reader.
 *
 * NVDA and JAWS use bare letters to move around a page (H for headings, B for
 * buttons, F for form fields). A call app that binds a bare letter to "raise
 * hand" either never receives the key or fires it when the user only wanted to
 * navigate. WCAG 2.1.4 (Character Key Shortcuts, level A) asks that a shortcut
 * made only of character keys can be turned off, remapped, or works only while
 * a control has focus.
 *
 * This module takes the first route by construction: a binding must include
 * Ctrl, Alt or Meta unless you opt out with `allowCharacterKeys`, and every
 * set of shortcuts can be switched off with `setEnabled(false)`. You still need
 * to give the user a way to do that.
 */

export interface ShortcutBinding {
  /** Shown in a shortcut help list. Say what it does: "Mute or unmute the microphone". */
  description: string
  handler: (event: KeyboardEvent) => void
}

export type Platform = 'mac' | 'other'

export interface ShortcutsOptions {
  /**
   * Combos such as `Ctrl+Shift+M`, `Mod+D`, `Escape`. `Mod` is Command on a Mac
   * and Ctrl elsewhere. Avoid Ctrl+Alt: on many Windows layouts that is how
   * AltGr is reported, and it types characters.
   */
  bindings: Record<string, ShortcutBinding>
  /** Where to listen. Default: the document. Pass an element to scope shortcuts to a call panel. */
  target?: Document | HTMLElement
  /** Start enabled. Default true. */
  enabled?: boolean
  /**
   * Allow a binding that is only a character key, such as `m` or `Shift+?`.
   * WCAG 2.1.4 then requires you to offer a way to turn shortcuts off or to
   * remap them. Default false: such a binding throws when created.
   */
  allowCharacterKeys?: boolean
  /** Which platform's modifier names to use. Default: detected. */
  platform?: Platform
}

export interface ShortcutInfo {
  combo: string
  /** Human-readable form for the current platform, such as `Ctrl+Shift+M` or `⌃⇧M`. */
  label: string
  description: string
}

export interface Shortcuts {
  list(): ShortcutInfo[]
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
  destroy(): void
}

interface ParsedCombo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  plus: '+',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad/i.test(platform) ? 'mac' : 'other'
}

function parseCombo(combo: string, platform: Platform): ParsedCombo {
  // A trailing "+" is the plus key itself ("Ctrl++").
  const source = combo.endsWith('++') ? `${combo.slice(0, -2)}+plus` : combo
  const tokens = source.split('+').map((token) => token.trim()).filter(Boolean)
  const parsed: ParsedCombo = { ctrl: false, alt: false, shift: false, meta: false, key: '' }

  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') parsed.ctrl = true
    else if (lower === 'alt' || lower === 'option') parsed.alt = true
    else if (lower === 'shift') parsed.shift = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') parsed.meta = true
    else if (lower === 'mod') {
      if (platform === 'mac') parsed.meta = true
      else parsed.ctrl = true
    } else {
      if (parsed.key) throw new Error(`call-a11y: "${combo}" names more than one key.`)
      parsed.key = KEY_ALIASES[lower] ?? lower
    }
  }
  if (!parsed.key) throw new Error(`call-a11y: "${combo}" has no key.`)
  return parsed
}

const canonical = (p: ParsedCombo): string =>
  [p.ctrl && 'ctrl', p.alt && 'alt', p.meta && 'meta', p.shift && 'shift', p.key]
    .filter(Boolean)
    .join('+')

export function formatShortcut(combo: string, platform: Platform = detectPlatform()): string {
  const p = parseCombo(combo, platform)
  const key =
    p.key === ' '
      ? 'Space'
      : p.key.length === 1
        ? p.key.toUpperCase()
        : p.key.startsWith('arrow')
          ? p.key.slice(5).replace(/^./, (c) => c.toUpperCase())
          : p.key.replace(/^./, (c) => c.toUpperCase())
  if (platform === 'mac') {
    return `${p.ctrl ? '⌃' : ''}${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.meta ? '⌘' : ''}${key}`
  }
  return [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.meta && 'Meta', key]
    .filter(Boolean)
    .join('+')
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
])

function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  const tag = element.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    return !NON_TEXT_INPUT_TYPES.has(type)
  }
  // jsdom does not implement isContentEditable, so read the attribute too.
  const attribute = element.getAttribute('contenteditable')
  return element.isContentEditable === true || (attribute !== null && attribute !== 'false')
}

/** The keys an event could be matched on, most direct first. */
function eventKeys(event: KeyboardEvent): string[] {
  const keys: string[] = []
  const key = typeof event.key === 'string' ? event.key : ''
  if (key) {
    const lower = key.toLowerCase()
    keys.push(key.length === 1 ? lower : (KEY_ALIASES[lower] ?? lower))
  }

  // On a Mac, Option+M types "µ", and on other layouts a Ctrl+M shortcut can
  // arrive as a letter outside a-z. The physical key is the better match then.
  const usable = /^[a-z0-9]$/i.test(key)
  if (event.altKey || event.shiftKey || !usable) {
    const code = typeof event.code === 'string' ? event.code : ''
    const letter = /^Key([A-Z])$/.exec(code)
    const digit = /^Digit(\d)$/.exec(code)
    if (letter?.[1]) keys.push(letter[1].toLowerCase())
    else if (digit?.[1]) keys.push(digit[1])
  }
  return keys
}

export function createShortcuts(options: ShortcutsOptions): Shortcuts {
  const platform = options.platform ?? detectPlatform()
  const target = options.target ?? (typeof document === 'undefined' ? undefined : document)
  if (!target) {
    throw new Error('call-a11y: createShortcuts needs a DOM. Call it in the browser, for example inside useEffect.')
  }

  const table = new Map<string, { combo: string; binding: ShortcutBinding }>()
  for (const [combo, binding] of Object.entries(options.bindings)) {
    const parsed = parseCombo(combo, platform)
    const isCharacter = parsed.key.length === 1
    if (isCharacter && !(parsed.ctrl || parsed.alt || parsed.meta) && !options.allowCharacterKeys) {
      throw new Error(
        `call-a11y: "${combo}" is a character-key shortcut. Screen readers use bare letters for navigation, ` +
          `and WCAG 2.1.4 asks that such shortcuts can be turned off or remapped. Add Ctrl, Alt or Meta, ` +
          `or pass allowCharacterKeys: true and give users a way to switch shortcuts off.`,
      )
    }
    const id = canonical(parsed)
    if (table.has(id)) throw new Error(`call-a11y: "${combo}" is bound twice.`)
    table.set(id, { combo, binding })
  }

  let enabled = options.enabled ?? true

  const onKeyDown = (raw: Event): void => {
    const event = raw as KeyboardEvent
    if (!enabled || event.defaultPrevented) return
    // Held keys repeat, and an IME composing text is not asking for a shortcut.
    if (event.repeat || event.isComposing) return
    // On many Windows layouts AltGr is reported as Ctrl+Alt and is typing a character.
    if (event.getModifierState?.('AltGraph')) return

    const commandModifier = event.ctrlKey || event.metaKey || event.altKey
    if (!commandModifier && isTextEntry(event.target)) return

    for (const key of eventKeys(event)) {
      const id = canonical({
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        key,
      })
      const match = table.get(id)
      if (match) {
        event.preventDefault()
        match.binding.handler(event)
        return
      }
    }
  }

  target.addEventListener('keydown', onKeyDown)

  return {
    list: () =>
      [...table.values()].map(({ combo, binding }) => ({
        combo,
        label: formatShortcut(combo, platform),
        description: binding.description,
      })),
    get enabled() {
      return enabled
    },
    setEnabled(value) {
      enabled = value
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown)
      enabled = false
    },
  }
}
