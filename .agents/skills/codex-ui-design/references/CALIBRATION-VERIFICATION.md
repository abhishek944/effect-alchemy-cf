# Verification — screenshot reconstruction prototype

Date: October 9, 2026. Three saved visual selections recorded: B1-B, B2-B, B3-B.

## Live browser observations

- Desktop capture: 1511x951 CSS pixels. Document width: 1511; no document-level horizontal overflow.
- Computed canvas: rgb(24,24,24); computed primary text: rgb(255,255,255).
- Exactly one default sidebar item exposes aria-current=page.
- Draft input enables Send. Local Send clears the draft, announces local-only feedback, and disables Send.
- Whitespace input leaves Send disabled. Disabled specimen button is disabled in the accessibility tree.
- Sidebar click changes the selected row and its aria-current value.
- Model popup opens and focuses its first choice. Escape closes it and returns focus to the trigger.
- Selecting Detailed updates the trigger and closes the popup.
- Narrow-screen sample: 390x844, document width 390. Composer left/right: 60/374; no horizontal overflow.
- Narrow-screen sidebar is hidden by proposed sample CSS. This is not a discovered Codex responsive contract.
- Captures: ../codex-calibration-foundations/screenshots/B1-A.jpg through B1-F.jpg.
- Interaction captures: composer-draft.jpg and model-popover.jpg; final default palette captures were regenerated after text/focus/aria refinements.
- mobile-safety.jpg records protective sample adaptation, not source-product parity.

## Declared color contrast

Ratios calculated from sRGB declarations. These checks do not prove native CSS or full accessibility.

| Pair                          | Foreground | Background | Ratio   | Target | Result |
| ----------------------------- | ---------- | ---------- | ------- | ------ | ------ |
| Primary prose on canvas       | #ffffff    | #181818    | 17.76:1 | 4.5:1  | pass   |
| Primary text on message       | #ffffff    | #2f2f2e    | 13.40:1 | 4.5:1  | pass   |
| Sidebar label on selected row | #dedede    | #323131    | 9.64:1  | 4.5:1  | pass   |
| Muted on canvas               | #a3a3a3    | #181818    | 7.04:1  | 4.5:1  | pass   |
| Muted on composer             | #a3a3a3    | #363636    | 4.79:1  | 4.5:1  | pass   |
| Positive signed count on card | #6bc67f    | #2d2d2d    | 6.56:1  | 4.5:1  | pass   |
| Negative candidate on card    | #ed5f58    | #2d2d2d    | 4.18:1  | 4.5:1  | revise |
| Proposed focus on composer    | #b8c7e0    | #363636    | 7.07:1  | 3:1    | pass   |

## Repository checks

- pnpm lint passed (format, matching env keys, source line limits, Effect diagnostics, typecheck).
- pnpm build passed using two existing cached build tasks.
- No unit tests created or run. Verification used actual browser interaction and DOM/accessibility states.
- Application code, dependencies, credentials, and OpenDesign catalog remain unmodified.
- Existing tracked/untracked work predates this prototype and is preserved.

## Limits

The native source app is blocked. The supplied screenshot establishes only one dark default state.
Default appearance is user-calibrated. Native font identity, source scale, unobserved states and proposed responsive behavior remain unverified.
Herdr environment and Monitor tools are absent. The user explicitly approved single-agent, process-tracked review; all three comparisons are resolved.
