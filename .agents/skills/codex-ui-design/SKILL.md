---
name: codex-ui-design
description: Use when building, styling, or reviewing interfaces explicitly requested to follow the approved Codex desktop dark design system, including sidebars, conversation views, composers, controls, and change cards.
---

# Codex UI Design

Apply the user-approved dark desktop reconstruction to the requested interface.
This is a reusable design reference with implementation assets, not an official
OpenAI specification. Its resources are self-contained in this skill folder.

## Read the relevant recipes

Start with [DESIGN.md](references/DESIGN.md) and the
[visual contract](references/VISUAL-CONTRACT.md).
Then read only the topics required by the requested component:

- Foundations: [colors](references/02-color-and-tokens.md) and
  [type, spacing, shape](references/03-type-spacing-shape.md).
- Sidebar, rail, layout: [shell and navigation](references/04-shell-and-navigation.md).
- Messages and composer: [conversation](references/05-conversation-and-composer.md).
- Buttons, inputs, icons, cards, popovers: [controls](references/06-controls-and-overlays.md).
- Acceptance: [accessibility and verification](references/07-accessibility-and-verification.md).
- New toolbar/panes, account and hover evidence: [screenshot extension](references/09-toolbar-account-and-tooltips.md).

## Implement with the approved resources

Use [tokens.css](assets/tokens.css) as the canonical semantic values.
[design-tokens.json](assets/design-tokens.json) mirrors those values;
[token-evidence.json](assets/token-evidence.json) distinguishes observations,
user-approved reproduction choices, and proposals.
The approved choices are B1-B neutral palette, B2-B curved frame, and B3-B
Lucide 1.53.0 with 1.75 stroke in a 24x24 viewBox.

Use the ordered styles and HTML regions listed in
[preview-sources.json](assets/preview-sources.json) as component recipes.
Adapt their markup to the application's framework and scope CSS to the owning UI;
the fixture's global selectors and fixed positioning are demonstration scaffolding.
Preserve accessible names, current-row state, real disabled controls, and focus.
Use the named SVGs in `assets/icons/`; keep their [license](assets/LUCIDE-LICENSE).
The source stack uses platform sans; the native font identity is unknown.

The specimen's JavaScript is local feedback only. Wire real application behavior
through the target application's existing boundaries when the user requests it.
Do not introduce an API or provider dependency merely to display these components.
See [USAGE.md](references/USAGE.md) for imports and the reproducible preview.

## Verify the requested component

Compare the approved dark default state against
[the approved screenshot](assets/evidence/B3-B.jpg) at 1511x951 CSS pixels.
Exercise the states changed by the task in the actual target UI when accessible.
Record intentional adaptations separately from fidelity defects.
The original three responses are in `assets/evidence/selection-B*.json`.
Their original `var/` paths are historical metadata, not runtime dependencies.

Default appearance is user-calibrated; native behavior, font identity, light theme,
streaming, and unseen dialogs are unverified. Earlier hover/focus/menu recipes
remain proposals; the screenshot extension records newer observed appearances,
not proof of native interactions. Narrow-screen behavior remains a proposed recipe. For an extension, state the assumption
and use new visual evidence or user review when fidelity matters.
The red removal count has a documented 4.18:1 contrast limitation; signed counts
preserve meaning. A contrast correction is an explicit adaptation to the baseline.
Do not claim complete native parity or complete accessibility compliance.

To regenerate the standalone sample from this skill, run:

```sh
python3 .agents/skills/codex-ui-design/scripts/build_preview.py
```

The generated sample is `assets/dist/components.html`. Authored resources stay
outside ignored temporary folders and can be versioned with the project.
