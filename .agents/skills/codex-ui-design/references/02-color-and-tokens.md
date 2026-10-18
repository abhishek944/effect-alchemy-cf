# Color system and token usage

The following values are modal colors from flat regions of the supplied raster image.
They are not values extracted from an application stylesheet.

| Token         | Sample    | Role                                | Evidence status                              |
| ------------- | --------- | ----------------------------------- | -------------------------------------------- |
| `--canvas`    | `#181818` | Main conversation background        | screenshot-sampled                           |
| `--sidebar`   | `#212020` | Project/chat sidebar                | screenshot-sampled                           |
| `--chrome`    | `#322f2e` | Top toolbar and left rail candidate | screenshot-sampled; rail assignment inferred |
| `--bubble`    | `#2f2f2e` | User message fill                   | screenshot-sampled                           |
| `--composer`  | `#363636` | Draft entry surface                 | screenshot-sampled; partially occluded       |
| `--card`      | `#2d2d2d` | Changes card fill                   | screenshot-sampled                           |
| `--selected`  | `#323131` | Selected sidebar row                | screenshot-sampled                           |
| `--text`      | `#ffffff` | Main prose/primary text             | screenshot-sampled; antialiasing varies      |
| sidebar label | `#dedede` | Sidebar text candidate              | screenshot-sampled                           |
| `--muted`     | `#a3a3a3` | Main activity/status text           | screenshot-sampled; placement-dependent      |
| `--line`      | `#333232` | Hairline separator candidate        | inferred; confirm                            |
| `--hover`     | `#3b3a3a` | Local sample hover                  | proposed; unobserved                         |
| `--focus`     | `#b8c7e0` | Local keyboard focus ring           | proposed; unobserved                         |
| `--positive`  | `#6bc67f` | Addition count                      | screenshot-sampled                           |
| `--negative`  | `#ed5f58` | Removal count candidate             | inferred from visible red; confirm           |
| permission    | `#d28a4a` | Access label candidate              | inferred; confirm without overlay            |

## Semantic rules

Surfaces communicate ownership and depth; do not brighten every component equally.
Keep long assistant responses on the canvas. Restrict message-fill surface to the user bubble.
Use selected-row fill for the current navigation item; hover is a temporary state and must remain distinct.
Neutral monochrome icons inherit foreground. Use color only when meaning requires it.
Changes must retain plus/minus signs and text, so green/red is not the only distinction.
Permission colors must accompany a readable scope label.
Do not add a universal teal brand accent from the curated OpenAI marketing package.

## Contrast validation

The exact contrast ratios and their scope are recorded in `CALIBRATION-VERIFICATION.md`.
Small text needs 4.5:1 in the reconstruction; meaningful non-text controls need 3:1 where applicable.
Muted text can be tested per actual adjacent surface; a value passing on canvas may fail on composer.
Disabled controls are still identifiable, even though disabled text is not subject to normal text contrast requirements.
Hairline separators may be decorative. Do not use a faint line alone to identify an interactive input boundary.
A screenshot-derived gray is not automatically appropriate for every state.

## B1 alternatives

A: retain sampled warm-neutral surface values. Recommended starting point.
B: neutralize the small warm offsets without changing canvas or composer.
C: darken the surface stack.
D: soften the stack by brightening surfaces.
E: enlarge surface separation; intentionally tests whether the reference is lower contrast.
F: cool the neutral stack; intentionally tests whether screenshot warmth reflects rendering or material.
All alternatives retain identical text, dimensions, font, radius, and interaction state.

## Canonical ownership

The current mockup stylesheet is the executable sample source.
The draft JSON tracks each candidate's evidence status.
After confirmation, create one canonical `../assets/tokens.css`, then derive JSON/Tailwind outputs from it.
Do not independently author three competing sets of approved color values.

## User-calibrated palette

B1-B selected. Current approved neutral equivalents: sidebar #212121, chrome #303030, bubble #2f2f2f, selected row #323232. Other colors remain visually as shown in the selected B1-B specimen.
The sampled table above retains the original raster observations; it is not the final approved token table.
Original feedback: Everything good; corners should be curved, and icons need a better library.
