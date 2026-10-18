# Controls, cards, and overlays

These recipes separate screenshot-backed surfaces from proposed states.

## Buttons

Primary sample: light neutral fill, dark text, rounded rectangle.
Secondary sample: dark card surface with quiet neutral border.
Ghost sample: transparent fill, text, and local neutral hover backing.
Disabled sample: native disabled attribute, reduced contrast, no activation.
Only the circular Send silhouette is directly shown as a primary action in the reference.
Rectangular button hierarchy is proposed for reusable samples and requires user confirmation.
Candidate default height is approximately 35px with 8px vertical and 14px horizontal padding.
Provide a visible focus indicator that does not shift layout.
Loading must preserve width and convey status; no loading button is implemented yet.

## Icon controls

Use approximately 16–18px thin line glyphs.
Use accessible names for each action and a visible keyboard focus ring.
Pure glyphs do not establish adequate hit targets; enlarge the hit box where needed.
Hover opacity/fill is provisional because a static reference cannot establish the interaction.
Initial B1 glyphs were hand-authored and rejected by the user. The revised specimens use pinned Lucide SVGs. These are not exported OpenAI icons.

## Inputs

Single-line sample: dark sidebar-like fill, neutral hairline, 8px radius, 9px/12px padding.
The reference includes a composer, not a generic form input; this recipe is proposed.
Retain a visible label. Placeholder cannot be the only label.
Error should include a textual explanation, `aria-invalid`, and linked helper text.
Read-only and disabled states differ semantically and should differ in behavior.
Validation/error is not implemented in the initial local sample.

## Changes card

Screenshot-backed card fill `#2d2d2d`; candidate radius 16px.
Metadata above; icon/title and small plus/minus counts below.
Do not add a large drop shadow where the reference separates the card through tone and border.
Keep positive/negative counts signed, so meaning survives color-vision differences.
Candidate width 300px; inset 15px vertical and 20px horizontal.
Actual card expansion, overflow menu, and click targets remain unobserved.

## Popover specimen

The sample model popup is an interaction probe, not a native visual reconstruction.
Keep the popup anchored to its trigger with an explicit expanded state.
Focus a choice after opening; restore focus after selection/Escape.
A production menu must settle keyboard navigation, outside-click behavior, selection announcement, and bounds.
This sample uses regular buttons in a labeled container; it does not claim a complete ARIA menu widget.
Popover placement, shadow, separators, and item height require user review with a source reference.

## Not yet reconstructed

The [screenshot extension](09-toolbar-account-and-tooltips.md) now records partial
account/tooltip/toolbar evidence and proposed application measurements.
Settings dialog, confirmation/approval dialog, toast, search, command palette, tabs.
Checkbox, radio, toggle, select, pagination, progress bar, skeleton, file attachment tile.
Code block, diff viewer, table, preview frame, terminal, source editor.
Document them only after evidence or an explicitly approved proposed design.
