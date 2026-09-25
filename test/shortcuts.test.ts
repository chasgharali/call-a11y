import { describe, expect, it, vi } from 'vitest'
import { createShortcuts, formatShortcut } from '../src'

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

const binding = (handler = vi.fn()) => ({ description: 'Test', handler })

describe('what may be bound', () => {
  it('refuses a bare character key, and says why', () => {
    expect(() => createShortcuts({ bindings: { m: binding() }, platform: 'other' })).toThrow(
      /2\.1\.4/,
    )
  })

  it('refuses a character key held with only Shift, which still types a character', () => {
    expect(() => createShortcuts({ bindings: { 'Shift+?': binding() }, platform: 'other' })).toThrow(
      /character-key/,
    )
  })

  it('accepts a character key with Ctrl, Alt or Meta', () => {
    const shortcuts = createShortcuts({
      bindings: { 'Ctrl+M': binding(), 'Alt+H': binding(), 'Meta+D': binding() },
      platform: 'other',
    })
    expect(shortcuts.list()).toHaveLength(3)
    shortcuts.destroy()
  })

  it('accepts a non-character key on its own', () => {
    const shortcuts = createShortcuts({ bindings: { Escape: binding(), F8: binding() }, platform: 'other' })
    expect(shortcuts.list()).toHaveLength(2)
    shortcuts.destroy()
  })

  it('accepts a bare character key when explicitly allowed', () => {
    const shortcuts = createShortcuts({
      bindings: { m: binding() },
      allowCharacterKeys: true,
      platform: 'other',
    })
    expect(shortcuts.list()).toHaveLength(1)
    shortcuts.destroy()
  })

  it('refuses two bindings for the same keys', () => {
    expect(() =>
      createShortcuts({ bindings: { 'Ctrl+M': binding(), 'Mod+M': binding() }, platform: 'other' }),
    ).toThrow(/bound twice/)
  })

  it('refuses a combo with no key or with two', () => {
    expect(() => createShortcuts({ bindings: { 'Ctrl+': binding() }, platform: 'other' })).toThrow(/no key/)
    expect(() => createShortcuts({ bindings: { 'Ctrl+M+N': binding() }, platform: 'other' })).toThrow(/more than one/)
  })
})

describe('firing', () => {
  it('runs the handler and stops the browser default', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+Shift+M': binding(handler) }, platform: 'other' })

    const event = press(document, { key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    shortcuts.destroy()
  })

  it('needs exactly the bound modifiers', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })

    press(document, { key: 'm', code: 'KeyM' })
    press(document, { key: 'm', code: 'KeyM', ctrlKey: true, shiftKey: true })
    press(document, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
    expect(handler).not.toHaveBeenCalled()

    press(document, { key: 'm', code: 'KeyM', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('treats Mod as Command on a Mac and Ctrl elsewhere', () => {
    const mac = vi.fn()
    const other = vi.fn()
    const a = createShortcuts({ bindings: { 'Mod+D': binding(mac) }, platform: 'mac' })
    const b = createShortcuts({ bindings: { 'Mod+D': binding(other) }, platform: 'other' })

    press(document, { key: 'd', metaKey: true })
    expect([mac.mock.calls.length, other.mock.calls.length]).toEqual([1, 0])
    press(document, { key: 'd', ctrlKey: true })
    expect([mac.mock.calls.length, other.mock.calls.length]).toEqual([1, 1])
    a.destroy()
    b.destroy()
  })

  it('matches named keys such as Escape and arrows', () => {
    const escape = vi.fn()
    const up = vi.fn()
    const shortcuts = createShortcuts({
      bindings: { Escape: binding(escape), 'Alt+Up': binding(up) },
      platform: 'other',
    })
    press(document, { key: 'Escape' })
    press(document, { key: 'ArrowUp', altKey: true })
    expect([escape.mock.calls.length, up.mock.calls.length]).toEqual([1, 1])
    shortcuts.destroy()
  })

  it('matches the physical key for Option+letter on a Mac, where the key value is a symbol', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Alt+M': binding(handler) }, platform: 'mac' })
    press(document, { key: 'µ', code: 'KeyM', altKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('matches the physical key on a layout whose letters are not a-z', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })
    press(document, { key: 'ь', code: 'KeyM', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('matches Shift+digit by the physical key', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+Shift+1': binding(handler) }, platform: 'other' })
    press(document, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })
})

describe('when not to fire', () => {
  it('does nothing while disabled, and again after being re-enabled', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({
      bindings: { 'Ctrl+M': binding(handler) },
      platform: 'other',
      enabled: false,
    })
    press(document, { key: 'm', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()

    shortcuts.setEnabled(true)
    expect(shortcuts.enabled).toBe(true)
    press(document, { key: 'm', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('ignores a held key repeating', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })
    press(document, { key: 'm', ctrlKey: true })
    press(document, { key: 'm', ctrlKey: true, repeat: true })
    press(document, { key: 'm', ctrlKey: true, repeat: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('ignores keys pressed while an input method is composing text', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })
    press(document, { key: 'm', ctrlKey: true, isComposing: true })
    expect(handler).not.toHaveBeenCalled()
    shortcuts.destroy()
  })

  it('ignores AltGr, which many Windows layouts report as Ctrl+Alt and use to type characters', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+Alt+M': binding(handler) }, platform: 'other' })
    press(document, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true, modifierAltGraph: true })
    expect(handler).not.toHaveBeenCalled()
    shortcuts.destroy()
  })

  it('leaves bare keys alone while the user is typing in a field', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({
      bindings: { m: binding(handler) },
      allowCharacterKeys: true,
      platform: 'other',
    })
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(input, textarea, editable)

    for (const field of [input, textarea, editable]) press(field, { key: 'm' })
    expect(handler).not.toHaveBeenCalled()

    press(document.body, { key: 'm' })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('still fires modifier shortcuts while typing, as call apps do for mute', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })
    const input = document.createElement('input')
    document.body.append(input)
    press(input, { key: 'm', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })

  it('stops listening after destroy()', () => {
    const handler = vi.fn()
    const shortcuts = createShortcuts({ bindings: { 'Ctrl+M': binding(handler) }, platform: 'other' })
    shortcuts.destroy()
    press(document, { key: 'm', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('can be scoped to an element', () => {
    const handler = vi.fn()
    const panel = document.createElement('div')
    document.body.append(panel)
    const shortcuts = createShortcuts({
      bindings: { 'Ctrl+M': binding(handler) },
      target: panel,
      platform: 'other',
    })
    press(document.body, { key: 'm', ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
    press(panel, { key: 'm', ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    shortcuts.destroy()
  })
})

describe('listing and labels', () => {
  it('lists shortcuts with a platform label and a description, for a help dialog', () => {
    const bindings = { 'Ctrl+Shift+M': { description: 'Mute or unmute', handler: vi.fn() } }
    const other = createShortcuts({ bindings, platform: 'other' })
    const mac = createShortcuts({ bindings, platform: 'mac' })
    expect(other.list()).toEqual([
      { combo: 'Ctrl+Shift+M', label: 'Ctrl+Shift+M', description: 'Mute or unmute' },
    ])
    expect(mac.list()[0]?.label).toBe('⌃⇧M')
    other.destroy()
    mac.destroy()
  })

  it('formats common keys readably', () => {
    expect(formatShortcut('Escape', 'other')).toBe('Escape')
    expect(formatShortcut('Ctrl+Space', 'other')).toBe('Ctrl+Space')
    expect(formatShortcut('Alt+ArrowUp', 'other')).toBe('Alt+Up')
    expect(formatShortcut('Ctrl++', 'other')).toBe('Ctrl++')
    expect(formatShortcut('Mod+D', 'mac')).toBe('⌘D')
    expect(formatShortcut('Mod+D', 'other')).toBe('Ctrl+D')
  })
})
