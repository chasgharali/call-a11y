import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ToggleButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'aria-label' | 'aria-pressed' | 'children' | 'type' | 'onChange'
  > {
  /**
   * The accessible name. It never changes when the state does: state is carried
   * by `aria-pressed`, so a screen reader says, for example, "Mute, toggle
   * button, pressed". Changing the name as well ("Unmute, pressed") leaves the
   * listener unsure whether the microphone is on or off. Pick one convention for
   * every toggle in the toolbar.
   */
  label: string
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  /** A decorative icon. It is hidden from assistive technology; the label names the button. */
  icon?: ReactNode
  /**
   * Show the label as visible text, and use it as the name. Use this instead of
   * an icon with a different `aria-label`, so the visible words and the name
   * match (WCAG 2.5.3, Label in Name). Default false.
   */
  showLabel?: boolean
}

/** A button whose name stays fixed and whose state is `aria-pressed`. */
export function ToggleButton({
  label,
  pressed,
  onPressedChange,
  icon,
  showLabel = false,
  className,
  onClick,
  ...rest
}: ToggleButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={['call-a11y-toggle', className].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      aria-label={showLabel ? undefined : label}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onPressedChange(!pressed)
      }}
    >
      {icon !== undefined ? (
        <span aria-hidden="true" data-call-a11y-icon="">
          {icon}
        </span>
      ) : null}
      {showLabel ? <span>{label}</span> : null}
    </button>
  )
}
