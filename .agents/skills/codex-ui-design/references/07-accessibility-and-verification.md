# Accessibility and verification contract

The goal is a faithful, usable reconstruction, not visual similarity at the expense of accessibility.
These are reconstruction requirements; they are not assertions about the source app.

## Semantics

Use actual buttons for actions, links for navigation, labeled text fields for input.
Keep decorative SVGs hidden from the accessibility tree.
One selected navigation item has a persistent state; current navigation should use `aria-current`.
Expanded disclosure state must follow visibility. Disabled controls must actually reject activation.
Use a polite status region for nonurgent sample feedback.
When an input fails, announce textual guidance and connect it with `aria-describedby`.

## Keyboard

Reach all controls in a logical sequence; never place primary interaction behind pointer-only hover.
Show visible focus without changing component geometry.
Escape dismisses an opened sample model popup and returns focus to its trigger.
Do not claim a complete keyboard menu until arrow navigation and focus containment are specified.
Respect IME composition when handling Enter. Shift+Enter should remain a newline in the proposed composer.
Avoid suppressing all textarea outlines without a visible parent focus indication.

## Contrast and adaptation

Use numerical color contrast checks on declared source colors, not JPEG edge pixels.
Target at least 4.5:1 for normal text and 3:1 for meaningful component boundaries/focus when applicable.
Different surfaces can require different muted foregrounds.
At narrow widths, preserve readable draft text, actions, and visible focus; avoid document-level horizontal overflow.
Large text/accessibility zoom must not obscure indispensable controls.
Reduced-motion users must not receive ornamental transitions.
Light theme and platform high contrast remain unverified and require dedicated decisions.

## Review sequence

First palette; then type/leading; then density/spacing; then component radii/geometry.
After foundations are confirmed, sidebar, bubble, composer, and card/button recipes can be reviewed independently.
After individual selections, capture a single integrated anonymous conversation fixture.
Review hierarchy, density, borders, radii, wrap, color roles, icon sizing, and each relevant state.
Resolve visible disagreements before marking the integrated contract approved.

## Evidence artifacts

Retain each option's screenshot and source at an identical viewport.
Retain original user selection JSON and comments; do not summarize away modifications.
Name every state and fixture in the contract.
Passing local interactions confirms only the sample.
Lint/build results confirm repository checks, not native appearance or user approval.
