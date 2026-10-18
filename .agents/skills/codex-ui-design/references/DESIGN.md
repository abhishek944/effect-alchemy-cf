# Codex Desktop — calibrated dark desktop reconstruction 1.0

Date: October 9, 2026. Status: all three visual decisions resolved; exported fixture verified.
This records the supplied dark desktop screenshot and an anonymous browser specimen.
It is not an official OpenAI design specification or a completed ChatGPT web design system.

## Read order

1. `01-evidence-and-scope.md`: what is known and what remains unknown.
2. `02-color-and-tokens.md`: sampled surfaces, semantic naming, contrast.
3. `03-type-spacing-shape.md`: candidate font scale and component geometry.
4. `04-shell-and-navigation.md`: window chrome, rail, sidebar, conversation layout.
5. `05-conversation-and-composer.md`: message, tool activity, composer, state model.
6. `06-controls-and-overlays.md`: buttons, inputs, cards, menus, feedback.
7. `07-accessibility-and-verification.md`: requirements, evidence and acceptance.
8. `08-package-and-calibration.md`: OpenDesign packaging and review sequence.
9. `../assets/token-evidence.json`: values with individual provenance and confidence.

## Intent

Reproduce the visible Codex UI, confirm each component with its user, and retain reusable recipes.
Use the same organizational rigor as OpenDesign: prose, canonical tokens, component fixtures, source evidence.
This record is bundled in a reusable project skill; it has no dependency on the var/ interview archive.
Preserve measured observations separately from reconstruction choices.
Keep this screenshot-derived desktop system distinct from the existing curated OpenAI brand package.

## Deliverables

`../assets/dist/components.html` is the portable interactive sample. `../assets/tokens.css` is canonical CSS; `../assets/design-tokens.json` mirrors it.
`USAGE.md` explains reuse. `../assets/manifest.json` inventories this review artifact without claiming OpenDesign registration.
`../assets/token-evidence.json` and `../assets/icon-provenance.json` preserve confidence and upstream icon attribution.

## Visual character

A near-monochrome dark workspace with three recurring surface tiers and quiet 1px dividers.
The conversation canvas is darker than the sidebar; messages and cards float through surface contrast.
The composer is the brightest large neutral surface.
The sidebar uses narrow rounded selected rows rather than separate elevated cards.
Normal assistant prose has no surrounding card.
Color identifies semantic details such as permission scope and change counts, not broad decoration.
Icons are mostly thin line shapes; primary send is a small filled circular control.

## Confirmed choices and scope

B1-B neutral palette, B2-B rounded frame, and B3-B light Lucide stroke are confirmed through saved browser submissions.
B1-B neutral palette is user-confirmed. The user found the sample otherwise good, with explicit requests for curved corners and better icons. B2-B corner treatment is confirmed. B3-B selects Lucide 1.53.0 at stroke 1.75. hover, focus, light theme, and native component behavior remain unverified.
The six B1 variants change surface color only; all other visual axes are held fixed.
Actual app inspection is blocked by Computer Use. No attempt is made to bypass that restriction.

## Confirmed sample appearance and local behavior

Window toolbar; rail; sidebar heading; project row; nested conversation row; selected row.
User message; inline message actions; paused status; separator; tool activity; assistant paragraph.
Primary/secondary/ghost/disabled buttons; text input; changes card; composer; send button; model popover.
Every interaction is local. Microphone, permissions, attachments, copy/edit, and window buttons are visual examples.

## Evidence and acceptance

A component is confirmed only after an explicit response tied to its screenshot, source, viewport, and state.
Sample behavior passing does not prove native behavior. A matching dark screenshot does not prove light theme.
A later approved recipe must record every user modification, not merely the option's label.

## Exact-state verification

The export screenshot is pixel-identical to the selected B3-B mockup at 1511x951 CSS pixels.
See `VISUAL-CONTRACT.md` and `VERIFICATION.md` for original selections, source paths, state, behavior and limits.
The approved dark default appearance is complete for this reference. Native unseen states remain explicitly unknown.
