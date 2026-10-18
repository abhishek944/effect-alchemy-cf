# Evidence, scope, and uncertainty

## Source hierarchy

| Evidence                           | What it supports                                               | What it cannot establish                               |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| User-provided 3022x1902 image      | Visible default dark appearance, hierarchy, flat raster colors | CSS declarations, device scale, fonts, dynamic states  |
| Live anonymous ChatGPT web home    | Separate web surface reachable in this session                 | Signed-in web UI or desktop equivalence                |
| OpenDesign `design-systems/openai` | Package organization and existing curated brand recipes        | A fresh upstream audit or current Codex desktop values |
| Browser-rendered mockups           | Reproducible sample layout and local behavior                  | Actual Codex DOM, native semantics, visual acceptance  |
| Future saved user selections       | Approved reconstruction contract for selected state            | Unreviewed sibling states or other product surfaces    |

## Reference image handling

The original attachment remains outside the served specimen directory.
Do not publish it, copy private project names into fixtures, or include conversation history in shared examples.
The visible Pet Town scene crossing the bottom of the image belongs to a separate overlay.
Exclude its water, pets, labels, and colors from the Codex design system.
The composer is partially occluded: its exact bottom border and lower control geometry remain uncertain.

## Observed

Dark top toolbar; narrow left rail; darker project sidebar; darkest central conversation.
Rounded selected sidebar row; right-aligned neutral user bubble; unboxed assistant prose.
Muted activity/status text; faint separator; compact right-side changes card.
Large rounded composer; small bottom control row; permission text in orange; circular Send.
Project groups, nested chat labels, pinned section, and recent items establish navigation hierarchy.

## Inferred

A 2x pixel scale would yield a 1511x951 logical viewport.
At that assumed scale, the rail is about 52px and the sidebar about 238px wide.
The toolbar is about 46px high, chat content about 736px wide, and message bubble about 515px wide.
Candidate UI/body font is a native sans stack at 14px; the screenshot cannot identify the actual font.
Material/translucency and color management could explain slightly warm sidebar/chrome values.
These are hypotheses, not guaranteed upstream CSS values.

## Unobserved states

Light theme; high contrast mode; compact/native narrow-window behavior; collapsed sidebar.
Hover; focus; pressed; disabled native Send; active streaming; code block; table; error; approval panel.
Settings dialog; model menu; attachment picker; tooltip; command search; toast; confirmation dialog.
No component should be labeled native-verified in one of these states.

## Required additional evidence

User confirmation can establish the reconstruction's fidelity, even while Computer Use blocks the source app.
A future screenshot for each missing theme/state would extend the evidence; it would not retroactively verify old guesses.
For a true dual-product system, inspect and document ChatGPT web separately before merging shared tokens.
