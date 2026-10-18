# Visual contract — Codex desktop dark reconstruction

Feature: codex-design-system. Parent session: codex-calibration.
Owner session: codex-calibration-foundations. Parent Grill Me session: none.
All work is artifact-only. The user explicitly authorized single-agent, process-tracked review.

## Resolved decisions

| Qualified branch                 | Selected | Meaning                    | Original response                    |
| -------------------------------- | -------- | -------------------------- | ------------------------------------ |
| codex-calibration-foundations:B1 | B        | Neutral equivalent palette | ../assets/evidence/selection-B1.json |
| codex-calibration-foundations:B2 | B        | Rounded desktop frame      | ../assets/evidence/selection-B2.json |
| codex-calibration-foundations:B3 | B        | Light Lucide stroke 1.75   | ../assets/evidence/selection-B3.json |

Final selected screenshot: ../assets/evidence/B3-B.jpg.
Original selected source SHA256 is preserved in ../assets/evidence/selection-B3.json.
The original source remains in the optional historical var/ interview archive.
Reusable recipe sources: ../assets/styles/, ../assets/preview/, and ../assets/playground.js.
Export: ../assets/dist/components.html.
Post-export screenshot: ../assets/evidence/final-default.jpg.

## Exact state

Viewport: 1511x951 CSS px; inferred 2x source-image scale remains unverified native metadata.
Theme: dark. Default, paused anonymous conversation; empty draft; Send disabled; popup closed.
Fixture: anonymous sidebar, project rows, message bubble, assistant paragraphs, controls, input, changes card and composer.
Route for verification: /export/components.html on the temporary loopback review server.
The standalone file embeds CSS/JS; original browser selection artifacts remain immutable.

## User modification precedence

B1 comment accepted the visible sample except corners and icons.
The user requested curved corners and a better researched icon library.
B2-B resolves curved frame: outer 16px, bubble/card 16px, composer 24px, row 9px, button/input 10px.
Lucide-static 1.53.0 selected for glyph consistency; B3-B confirms light source stroke 1.75 in 24x24 SVGs.
These establish reconstruction values, not proof of native Codex implementation or icon provenance.

## Behavior

Local-only draft, no network send. Send enabled only for non-whitespace draft.
Enter submits locally; Shift+Enter inserts a newline; composition guard avoids premature IME submission.
Sidebar selection exposes one current item. Model popup opens, selection updates its label, and Escape restores trigger focus.
Mic, attachment, permission, toolbar and copy/edit controls remain visual/feedback examples.
Native corresponding behavior remains unobserved.

## Accessibility

Named buttons, labeled inputs, decorative SVGs hidden, persistent current row, real disabled controls, visible focus.
Status feedback announced politely. Plus/minus signs retain change-count meaning independently of color.
Red count candidate has 4.18:1 contrast on the card: document as a limitation rather than claiming full accessibility compliance.

## Deferred / outside scope

No unresolved or deferred interview branches remain.
Light theme, native font identity, advanced native states and ChatGPT web parity are unobserved and outside this screenshot-backed contract.
They are not silently accepted requirements or invented source facts.

## Handoff

Original DAG and full variants remain in the optional var/ interview archive.
The skill includes all three responses and selected screenshots; it does not need that archive.
Future product implementation must preserve this selected state and record any explicit user revisions.
