# Toolbar, account and tooltip screenshot extension

These newer user-supplied references extend previously unobserved states. They do
not replace the saved B1–B3 approvals or prove native behavior. The application
implementation still needs user visual acceptance. Source image scale is unknown;
all CSS measurements below are adaptation candidates, not native constants.

## Toolbar and panes

The supplied wide toolbar shows separate back and forward arrows, a left-panel
split-rectangle glyph, a folder/title region and trailing full-view/right-panel
controls. A folder is a content identifier, not a sidebar-toggle icon.
Use distinct split-left/split-right glyphs and real buttons for panel actions.
Back and forward use the application's existing history, not a link pretending to
be Back. Do not invent disabled-history availability from history.length alone.
The panel's full-view glyph uses opposing corner marks; the observed hover label
is "Enter full view". See ../assets/evidence/full-view-control.png.

The requested right-section full view is an application layout state. Expand that
section, keep a reachable exit control, restore the preceding layout on exit and
support Escape. Do not imply OS/browser fullscreen unless that API is implemented.
Panel visibility and expanded/pressed accessible states must agree. If no feature
owns the right section yet, leave it empty rather than inventing files or tabs.

## Account surface

The reference has a compact blue initials avatar, stacked identity/secondary text,
quiet thin separators, dark translucent rounded surface and compact icon-led rows.
Settings uses a gear; Log out uses an exiting-box arrow, not a generic back arrow.
Suggested application values: 248px max popup width, 16px corners, 24px header
avatar, 14px rows, 6px vertical row padding. These are proposed reconstruction
measurements; #287fa0 initials fill is an adaptation to the observed blue avatar.
Keep actual account identity and session data. Never copy the reference's "Pro",
"82% left", pets, invitations or help integrations as invented working features.
Keep bottom-left identity reachable with collapsed navigation as well as expanded.
Native auto popover is suitable for disclosure: Escape/light dismiss and explicit
anchor ownership. Do not claim ARIA menu keyboard behavior for ordinary links.
Clamp both viewport bounds; anchor() is valid for inset positioning, not max-height.
Use a valid viewport-based height and scrolling for short viewports.

## Hover/focus tooltip

The supplied Home hover has a dark rounded label directly beside the rail control,
a subtle border and slight shadow. See ../assets/evidence/home-hover.png.
Use the same visual feedback on keyboard focus, accessible action names, and thin
consistent icon glyphs. A native title alone does not reproduce this visible bubble.
Candidate bubble: 12px radius, 13px text, 4px/10px padding and 8px trigger gap.
Keep it hoverable and dismissible with Escape. Do not rely on tooltip-only content
for an indispensable action. Bound placement near viewport edges; no duplicate
native-title tooltip. The shortcut shown in the full-view reference is source
appearance only: display it only if the application implements that shortcut.

## Verification boundary

Check source semantics, scope, responsive overflow and real disabled states;
then have the user exercise pane toggles/full view, Escape/focus, hover and account
flows in the actual application. Lint/build passing is not screenshot parity.
The account screenshot included unrelated conversation text and is not copied
into the reusable skill; only the isolated control/hover references are stored.
