# Shell and navigation recipes

## Layout anatomy

1. Full-width native-style toolbar.
2. Narrow rail carrying global destinations.
3. Project/chat sidebar with grouped rows.
4. Main conversation column.
5. Compact changes summary at upper right.
6. Composer anchored below the conversation content.

At the assumed 1511x951 CSS viewport, the prototype reserves 52px rail and 238px sidebar.
Toolbar candidate is 46px high. Conversation target is 736px maximum width.
The sample changes card is 300px wide, 8px from the top/right of the work area.
These values reproduce one screenshot; they are not proven universal native layout constants.

## Rail

Use one consistent icon size and central alignment.
Selected destination gains a quiet rounded neutral backing and stronger icon contrast.
Keep secondary destinations visually quiet. Separate user/profile position at the bottom.
Each icon button needs an accessible label; hover/focus must not depend on an unlabeled glyph.
Candidate visual button is 36px. Native minimum hit-area behavior is unknown.

## Sidebar heading

Product name and disclosure form the leading group; notification/search sit at the trailing edge.
Product title is stronger than group labels but smaller than a page headline.
Treat the disclosure as a control only when a working menu is implemented.
Search/notification behavior in the sample is feedback-only, not a product reproduction.

## Rows

An outer row represents a project; an indented row represents a conversation within it.
Use folder/chat line icons to identify row type.
Keep rows compact and a selected background spanning the available sidebar width.
The screenshot shows one-line truncation. Do not wrap labels and enlarge the row unexpectedly.
Candidate row height: 31px, radius 9px, icon 16px, gap 8px.
Nested label inset: 32px candidate.
Persistent selected state and temporary hover must have separate meanings.
Use `aria-current` for the current page/chat in an implemented navigation contract.

## Groups and scrolling

Pinned, Projects, and Recents use muted section labels with stronger vertical grouping.
Do not turn section headers into bright cards.
Sidebar content should scroll independently when it exceeds the visible region.
Whether native group headers pin during scroll is unobserved.
Expand/collapse and reorder behavior require further evidence.

## Width adaptation

The sample hides the changes card under 1200px and sidebar under 700px.
These are protective prototype rules, not discovered Codex breakpoints.
A true responsive contract needs specific native screenshots or explicit user approval.
Keep draft entry usable even when the wide desktop arrangement cannot fit.
Never infer actual mobile ChatGPT design from this desktop sample.
