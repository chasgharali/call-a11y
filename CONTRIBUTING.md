# Contributing

The most useful contribution is a screen reader report: see [docs/screen-reader-testing.md](docs/screen-reader-testing.md).

For code changes:

```sh
npm install
npm run check                       # typecheck, tests, build, package lint
npm run demo:build && npm run e2e   # real-Chrome checks (needs Chrome)
```

A few ground rules that come from what the package is for:

- **Say what is tested and what is not.** Do not describe behaviour as "works with JAWS" unless someone ran it with JAWS. Claims in the README should match a test or a report.
- **Every announcement behaviour gets a test**, and `aria-live`, roles and names are asserted, not assumed.
- **No dependencies** in the runtime package. React is an optional peer.
- Defaults that depend on how screen readers behave (timings, `controlChanges`) are heuristics. If you change one, say what you observed.
- Keep it accessible itself: the demo and any new component must pass the axe checks and be usable from the keyboard.
