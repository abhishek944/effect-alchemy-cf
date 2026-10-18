# Original calibration export verification

Selected screenshot: ../assets/evidence/B3-B.jpg.
Original selected source hash: ../assets/evidence/selection-B3.json.
Export source: ../assets/dist/components.html.
Export screenshot: ../assets/evidence/final-default.jpg.
Viewport: 1511x951 CSS px. Route: /export/components.html. Dark; empty draft; popup closed; default sidebar selection.
Fixture is the same anonymous conversation/controls data as the selected screenshot.

## Visual verdict

Decoded RGB raster comparison: pixel-identical. Difference bounds: none. Mean channel difference: 0, 0, 0.
Hierarchy, density, spacing, copy, wrap, controls, borders, radii, shadows and visible default state are identical.
No visual mismatch or rework is outstanding for the export.
This compares export to user-selected mockup, not export to the blocked native app.

## Actual exported behavior checks

Draft enables Send; Enter clears draft and produces local-only feedback; Send becomes disabled.
Shift+Enter preserves a newline. Whitespace draft keeps Send disabled.
Sidebar selection changes the current item.
Model selection closes the popup, updates the label, and retains its Lucide chevron.
Escape closes the popup and restores focus. Browser error log during these exported checks was empty.
Final-draft-focus.jpg records the proposed local draft/focus state.

## Boundaries

Prototype is self-contained; verified through permitted HTTP preview.
Browser automation rejected file:// navigation under its URL policy. No bypass or alternate browser surface was attempted.
Direct offline browser execution is therefore not automation-verified.
Native app, light theme, menu fidelity, streaming and font identity remain unverified.
The red removal-count candidate remains below the 4.5:1 small-text target (4.18:1); plus/minus signs preserve meaning.
No claim of complete WCAG or native behavioral parity is made.

Repository pnpm lint and pnpm build passed earlier in this session. Build/typecheck used existing cached task outputs.
Those checks describe the original calibration session. Skill packaging has its own checks below.

Cleanup complete: owned review server stopped, temporary browser dimensions restored, in-app audit tabs closed.

## Skill packaging

The source is now maintained in this skill, outside var/.
The stdlib preview builder reads only bundled assets and writes generated assets/dist/components.html.
The original selections retain historical paths unchanged; bundled screenshots are the durable comparison references.
