# Testing call-a11y with a screen reader

**Nothing in this repository has been run with a real screen reader yet.** The automated tests prove the DOM and ARIA mechanism: which live region receives a message, in what order, with what roles. They cannot prove what JAWS, NVDA, VoiceOver or TalkBack then say, and screen readers disagree with one another about live regions in ways that only a listening person finds.

If you use a screen reader, or test with one, fifteen minutes with the demo is the most useful contribution this project can get.

## What to run

Open the demo (`npm install && npm run demo`, or the hosted copy linked from the README). Any of these are useful, and a partial run is fine:

| Screen reader | Browser |
|---|---|
| NVDA (Windows) | Chrome, Firefox |
| JAWS (Windows) | Chrome, Edge |
| VoiceOver (macOS) | Safari, Chrome |
| VoiceOver (iOS) | Safari |
| TalkBack (Android) | Chrome |

Start the screen reader first, then load the page, so the live regions are registered the way a real call screen would have them.

## The ten scenarios

For each, note **what you heard, in full**, roughly **how long after the action**, and whether anything was **cut off, repeated, or not spoken at all**.

| # | Do this | The library sends | Worth noting |
|---|---|---|---|
| 1 | Press **One person joins** | One polite message, "Jo joined", about 1.2 s later | Heard once? Complete? |
| 2 | Press **Five people join at once** | One polite message, "Jo, Lee, Kim, and 2 others joined" | One line, or several? |
| 3 | Press **Sam drops and comes straight back** | Nothing | Anything spoken? |
| 4 | Press **Start recording** | One assertive message, "Recording started" | Spoken promptly? Did it interrupt something else? |
| 5 | Press **Lose the connection for 3 seconds** | Assertive "Reconnecting", then polite "Reconnected" about 3 s later | Both heard? |
| 6 | Tab to **Mute** and press it (Space or Enter) | The button's own state change, plus a polite "Microphone off" | **Does the screen reader also say "pressed" or similar, so the fact is spoken twice?** This decides the default of `controlChanges` |
| 7 | Move focus away from the buttons and press **Alt+M** (Option+M on a Mac) | Polite "Microphone off", and the button flips | Is the shortcut reaching the page, or does the screen reader or browser take it? |
| 8 | Press **Sam raises a hand** twice, a few seconds apart | "Sam raised a hand" both times | Is the **second, identical** message spoken? |
| 9 | Press **Simulated speech**, then move into the caption log with your reading cursor | Nothing is sent to the live regions | Can you read the captions by browsing? Does it stay put while you read, and does **Jump to latest captions** appear? |
| 10 | Press **Speak captions aloud**, then **Simulated speech** | Polite, settled captions only, joined per speaker | Are they readable? Do they overlap other speech? Is unsettled text ever spoken (it should not be)? |

The **What was sent to the live regions** panel beside the call lists exactly what the library placed in the regions, newest first, so you can compare it with what you heard.

## How to report

Open an issue with the **Screen reader report** template. The essentials:

- Screen reader and version, operating system, browser and version
- Scenario number
- What you heard, as close to word for word as you can, and when
- What you expected, if it differs

A "this all worked" report is as useful as a bug: it is the only evidence there is for a screen reader and browser pairing. Please say which scenarios you ran.

## What a report can change

- The default of `controlChanges` (scenario 6)
- The pacing defaults: `readyMs` 100, `minGapMs` 400, `batchMs` 1200
- Whether the fresh-element technique used for every message repeats identical text reliably (scenario 8)
- The wording of the default messages
