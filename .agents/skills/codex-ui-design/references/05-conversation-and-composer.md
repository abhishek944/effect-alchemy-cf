# Conversation and composer recipes

## User message

Align to the conversation's right edge. Use neutral filled surface and a soft silhouette.
Candidate width cap: 515px within a 736px content column.
Candidate inset: 14px vertical/16px horizontal; radius 16px; 14px font; 22.5px leading.
Copy/edit actions sit below at the trailing edge, with low default contrast.
The screenshot proves visible actions only; hover visibility, copying format, and editing flow are unknown.
Anonymous fixtures must not reuse the user's private project names or messages.

## Assistant content

Place paragraphs directly on the canvas without a card background.
Use normal body weight and readable leading. Maintain modest paragraph spacing.
Inline file/path/code fragments use small contrasting neutral backgrounds in the screenshot.
The prototype's inline monospace is a candidate, not a measured native font.
Rich markdown headings, lists, code, tables, and citations need separate capture and confirmation.

## Activity and status

Tool lines pair a small line icon with a muted descriptive label.
Paused/stopped status is muted and can precede a faint separator.
Do not style routine status as a high-saturation alert.
Actual expansion, streaming grouping, timestamps, and tool-detail panels remain unobserved.
Loading, error, blocked, retry, and completed status need text labels as well as any colors.

## Composer geometry

Large rounded neutral container, brighter than the message bubble.
Textarea sits above a compact control row; permission control leads, model selector trails.
Attachment and microphone are icon controls; Send is a filled circle at the trailing edge.
Candidate width matches the conversation column. Candidate minimum height: 110px.
Candidate radius: 24px. Lower border/control dimensions are partly obscured by the external overlay.

## Proposed local state table

| State            | Sample behavior                            | Native evidence                                         |
| ---------------- | ------------------------------------------ | ------------------------------------------------------- |
| Empty            | Placeholder; Send disabled                 | Native screenshot has a draft, so unknown               |
| Whitespace       | Send disabled                              | Unknown                                                 |
| Draft text       | Send enabled                               | Visible draft/send shape in reference; behavior unknown |
| Enter            | Clears draft and announces local send      | Proposed                                                |
| Shift+Enter      | Adds newline                               | Proposed                                                |
| IME composition  | Enter does not prematurely submit          | Proposed guard                                          |
| Model open       | Popup visible; first choice focused        | Unknown                                                 |
| Model select     | Label changes; popup closes; focus returns | Proposed                                                |
| Escape           | Popup closes and trigger receives focus    | Proposed                                                |
| Generating       | Not implemented in first specimen          | Unknown                                                 |
| Attachment/error | Not implemented                            | Unknown                                                 |

## Behavior boundaries

The sample never sends a message to a provider.
Permission label, microphone, attachment, copy/edit, and native toolbar controls only report local specimen feedback.
No credential, account state, filesystem access, or production capability is represented by these visual controls.
Confirm interaction contracts separately from appearance; do not claim native equivalence based on local tests.
