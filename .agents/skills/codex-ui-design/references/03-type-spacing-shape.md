# Typography, spacing, and shape — candidates

Every numeric size below is inferred or proposed unless explicitly labeled observed.
The reference raster does not reveal native CSS pixels, font files, or accessibility size settings.

## Font policy

Prototype stack: `-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`.
This uses the available platform face; it does not claim Codex uses that exact stack.
Do not add licensed Söhne or Signifier fonts merely because they appear in the curated brand example.
No editorial serif is visible in the supplied desktop image.
Code specimen uses `ui-monospace, Menlo, monospace`; actual code blocks remain unobserved.

## Candidate scale

| Role                   | Size    | Weight | Leading      | State                 |
| ---------------------- | ------- | ------ | ------------ | --------------------- |
| Product name           | 18px    | 600    | normal       | inferred              |
| Window title           | 14px    | 500    | normal       | inferred              |
| Conversation/body      | 14px    | 400    | 22–23px      | inferred              |
| Navigation row         | 14px    | 400    | 31px row     | inferred              |
| Section group label    | 14px    | 400    | normal       | inferred              |
| Card metadata          | 13px    | 400    | normal       | inferred              |
| Model/permission label | 12px    | 400    | normal       | inferred              |
| Inline monospace       | 12px    | 400    | body leading | proposed              |
| Specimen caption       | 10–11px | 400    | normal       | documentation UI only |

Use sentence case; avoid uppercase product labels unless a later reference shows them.
Apply restrained weight differences. Use position, color, and grouping to carry hierarchy.
Long row labels truncate to one line; full labels must remain available to assistive technology.
Conversation paragraphs wrap naturally. Do not clip readable prose to preserve visual similarity.

## Candidate spacing

4px base cadence is a reconstruction convenience, not a measured upstream token scale.
Candidate scale: 4, 8, 12, 16, 20, 24, 32, 48, 64, 86px.
Use 8px between row icon and label; 8px side margins for navigation.
Message inset: 14px vertical, 16px horizontal.
Composer inset: 12px; controls align within the padded bottom row.
Activity separator: 9px before, 16px after in the first specimen.
Main conversation starts approximately 32px below the toolbar.
The screenshot is spacious but its whitespace partly depends on paused task content.

## Candidate shape scale

| Use                     | Radius | Reason                                                   |
| ----------------------- | ------ | -------------------------------------------------------- |
| Inline code             | 4px    | Small inset label                                        |
| Icon button             | 8px    | Compact hover area                                       |
| Navigation selected row | 9px    | Soft narrow row                                          |
| Standard button/input   | 8–9px  | Proposed control specimen                                |
| Model popover           | 12px   | Unobserved; sample only                                  |
| Message bubble/card     | 16px   | Screenshot-derived estimate                              |
| Composer                | 24px   | Screenshot-derived estimate; overlay obscures lower edge |
| Send/avatar             | 50%    | Visible circular silhouette                              |

Use 1px borders where visible. Avoid adding shadows to messages and ordinary cards.
The sample popover shadow is proposed and requires a separate reference/decision.
Initial B1 icons were handcrafted and rejected. Subsequent specimens use Lucide 1.53.0; the actual upstream icon family remains unknown.

## Confirmed corner treatment

B2-B: sidebar outer left corners 16px; workspace outer right corners 16px.
Bubble/card radius 16px; composer radius 24px; selected-row radius 9px; button/input radius 10px.
These are approved reproduction values, not source CSS measurements.

## Confirmed icon treatment

B3-B selects Lucide 1.53.0, round caps/joins, 1.75 source stroke, 24x24 viewBox.
Standard rendered glyphs are 16–18px; micro chevrons/controls are 10–12px.
This confirms the sample treatment; the upstream Codex icon library remains unknown.
