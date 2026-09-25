# Changelog

## 0.1.0 (2026-09-26)

First release.

- `createAnnouncer`: two persistent live regions (polite and assertive) with a paced, key-superseding queue.
- `createCallAnnouncer`: batched joins, leaves and raised hands with reconnect-blip cancelling and a large-call mode; microphone, camera, screen share, recording and connection announcements; localisable messages.
- `createCaptionLog`: live captions from a streaming recogniser, with unsettled text never spoken and optional per-speaker spoken captions; transcript export.
- `createShortcuts`: call shortcuts that require a modifier (WCAG 2.1.4), ignore key repeat, IME composition and AltGr, and match the physical key for Option and non-Latin layouts.
- React bindings: `AnnouncerProvider`, `useCallAnnouncer`, `useAnnouncer`, `useCaptionLog`, `CaptionLogView`, `ToggleButton`, `useShortcuts`; optional `call-a11y/styles.css`.
- Tested with jsdom and axe-core (129 tests), and with 13 checks in real Chrome, including Chrome's native accessibility tree. **Not yet tested with a real screen reader.**
