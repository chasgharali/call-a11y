import { useEffect, useRef, useState } from 'react'
import { createShortcuts } from '../shortcuts'
import type { ShortcutBinding, ShortcutInfo, ShortcutsOptions } from '../shortcuts'

/**
 * Registers call shortcuts for as long as the component is mounted.
 *
 * Handlers are always the latest ones you passed, so they can close over
 * current state without re-registering. The listener is re-created only when
 * the set of key combinations, or one of the options, changes.
 *
 * Returns the list of shortcuts, for a "keyboard shortcuts" help dialog. It is
 * empty on the server and on the first client render.
 */
export function useShortcuts(
  bindings: Record<string, ShortcutBinding>,
  options: Omit<ShortcutsOptions, 'bindings'> = {},
): { shortcuts: ShortcutInfo[] } {
  const latest = useRef(bindings)
  latest.current = bindings
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([])

  const combos = Object.keys(bindings).sort().join('\n')
  const { enabled, target, allowCharacterKeys, platform } = options

  useEffect(() => {
    const wrapped: Record<string, ShortcutBinding> = {}
    for (const [combo, binding] of Object.entries(latest.current)) {
      wrapped[combo] = {
        description: binding.description,
        handler: (event) => latest.current[combo]?.handler(event),
      }
    }
    const controller = createShortcuts({
      bindings: wrapped,
      ...(enabled === undefined ? {} : { enabled }),
      ...(target === undefined ? {} : { target }),
      ...(allowCharacterKeys === undefined ? {} : { allowCharacterKeys }),
      ...(platform === undefined ? {} : { platform }),
    })
    setShortcuts(controller.list())
    return () => controller.destroy()
  }, [combos, enabled, target, allowCharacterKeys, platform])

  return { shortcuts }
}
