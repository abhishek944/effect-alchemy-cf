# Dashboard UI

The signed-in application follows the project Codex UI Design skill and the
supplied workspace, account-menu and chat references. Its neutral dark palette,
curved frames, platform fonts and Lucide icons follow the approved reconstruction.

## Themes

Settings → Appearance switches immediately among Light, Dark, Midnight Black,
Dusk and Paper. Light/Dark are unchanged; Dark remains the fresh default. Midnight
Black uses the approved T3-style black/neutral surfaces, Dusk warm charcoal, and
Paper warm ivory. There is no System mode. The saved preference belongs to the
signed-in account and is shared by manual controls and direct-request AI changes.
Load/reconnect reads the account value; a valid existing browser choice migrates
atomically only when no account preference exists. Other accounts stay isolated.
Preview is immediate; failures restore confirmed state with explicit Retry. No
instant cross-device sync is promised. Chat Undo is revision-safe; no Undo banner.
The single `apply_account_theme` AI tool handles both setting a theme and restoring
its previous value; there is no separate Undo tool.
Only the dashboard and Settings are themed; signin and admin remain light.
Paper retains the explicitly selected palette: its sampled muted-on-selected
color pairing is 4.29:1, not a blanket contrast-compliance guarantee.

## Routes and ownership

- `/chat/{chatId}`: authenticated workspace for that saved chat UUID; direct links
  survive reload and email sign-in. `/` and `/dashboard` open the remembered chat
  or the first saved chat and replace the landing URL.
  Signed-out visitors see the existing signup/signin screen.
- `/settings/general`, `/settings/profile`, `/settings/appearance` and
  `/settings/account`: grouped settings inside the same dark frame.
- `/admin`: existing separate admin portal with its access checks preserved.

Dashboard navigation lists private saved chats, rename and archive/unarchive
actions. A quiet filled **+ New** button beside **Chats** replaces the separate
New chat action row; it keeps its geometry and disables creation while starting. New chat and switching update the URL; Back/Forward
restore chat selection. Invalid paths show Page not found; inaccessible chat UUIDs
show the existing private API error, never a different chat. Archived chats remain readable in their own group.
Escape cancels Rename without saving and restores that row's Rename button.
The home rail icon has a filled selected surface. The chat toolbar repeats the active
chat title beside a chat icon and a short divider aligned with the conversation's
left border, including after sidebar resizing. Renames and generated titles update
from existing chat metadata. Long titles truncate visually; the full text remains
accessible and available on hover. Narrow layouts use a compact title beside the
navigation controls. Right-section full view hides the conversation title.
Settings keeps its heading, search and section navigation. Home and Settings share the same
sidebar search component, including its styling, clear button and Escape-to-clear
behavior; each keeps its own filtering and accessible result announcements.

The avatar always sits at the bottom of the icon rail. Its native popover shows
real Better Auth identity, Settings and Log out. Clicking the identity row opens
`/settings/profile`; there is no separate Profile item in the account popup.
Escape and outside clicks dismiss the popup. Signout uses the existing auth client.
The screenshot's subscription, usage, pets and invitation integrations are absent
because this starter has no services for those features.

## Chat and panes

`@assistant-ui/react` provides the thread, viewport, message and composer
primitives. The external-store runtime and authoritative store gate sending while
users can keep drafting. Enter and Send share one submission path, including
ready staged files; Shift+Enter inserts a newline. Blocked drafts stay intact.
The same-origin Pi Durable
backend supplies saved transcripts and streamed snapshots. The composer shows
connection/recovery state, GPT-6 Luna with high thinking, and explicit Stop/Retry
controls. File and voice controls follow their configured capability gates; see
[private files](chat-files.md) and [voice](chat-voice.md). No API credential enters
the browser. Inference requires explicit Gateway/BYOK setup and is remotely
billable even on localhost. See [Pi chat setup and acceptance](pi-chat.md).
The message renderer supports user bubbles and assistant prose on the canvas.
Archived chats replace the entire composer with an archived notice and inline
Unarchive. A running answer continues, with a compact Stop outside the input area.
Unarchiving restores the existing current-page draft. New chats get a separate,
bounded same-model title call after first acceptance; see [chat titles](chat-titles.md).

The signed-in frame stays within the viewport: only its content panels scroll,
and vertical edge gestures do not chain to the document. Signin/admin keep normal page flow.
On desktop the chat occupies the left workspace pane; an empty right companion
pane is initially visible. Above 760px, drag the sidebar's right edge or the
conversation/right-pane divider to resize the columns. Focus either divider and
use Left/Right arrows (Home/End for limits) to resize without a pointer. Widths
survive navigation within the current page; reload restores the defaults.
Resizing is hidden in full view and on narrow layouts, and desktop widths are
constrained to keep the adjacent panes visible. Divider announcements track the
effective size and reachable limits after viewport changes. Pointer clicks leave the composer
border neutral; divider hover/focus/drag uses a quiet gray cue. Tab and navigation
keys restore pale keyboard focus on the composer and dividers. Ordinary typing
after a click does not reintroduce the outline. Text fields keep their existing
borders and caret without added focus rings or underlines, including
model/chat/Settings search and rename. Signin/admin inputs change their border color on focus;
buttons, links and selects retain their keyboard focus cues.
Narrow layouts initially show chat alone. Pane toggles
open/close the companion pane. Enter full view expands it inside the application;
Escape or the exit control restores the preceding layout. Back/Forward use browser
history without reloading the document. Internal dashboard links preserve the
shell and session, including modifier-click/new-tab behavior. Chat drafts and
pane choices survive Home/Settings switches in the current page; reloads still
clear drafts. Home and Settings each retain their own right-pane layout.
Tooltip bubbles use the native top layer on hover or keyboard focus, escape panel
clipping, and dismiss on click, Escape, resize or external scroll. Internal tooltip
scrolling remains available. Unsupported browsers retain accessible descriptions.

Scoped styles/components live in `apps/web/src/components/dashboard/`.
The light signin screen and admin portal retain their existing appearance.
Settings extension rows remain disabled. Profile supports a trimmed display name,
optional About me and private original JPEG/PNG/WebP avatars with atomic Save/Cancel.
Email remains read-only; username is absent. All three avatar formats are limited
to 5 MiB and 2 million pixels; no crop or re-encoding is applied.
Failed/stale saves preserve the draft; unsaved navigation requires a decision.
Only saved displayName/aboutMe are available to the owner-scoped AI read tool,
with an explicit AI/history disclosure. Email and avatars are excluded.

## General error notices

General dashboard failures use one persistent, neutral notice with an error icon,
short title, explanation, safe recovery action and Dismiss. Chat creation,
rename and archive failures sit immediately above the composer. Catalog loading
errors remain in the sidebar, billing errors in Account settings, and sign-out
feedback inside the native account popup. Dismiss restores nearby keyboard focus;
dismissing unavailable data keeps its read-recovery control reachable.

**Check chats** only reloads the catalog. It never repeats uncertain chat creation
or claims that a list refresh proves its outcome. Billing refresh does not replay
checkout. Notices do not auto-dismiss, clear drafts or change connection readiness.
Specialized send, connection, history, setup, file, voice and field errors retain
their existing local presentation and recovery. Signin and admin are unchanged.

## Acceptance checks

1. Sign in; confirm the saved-chat sidebar, active title in the top toolbar,
   selected home fill, left chat pane and bottom rail avatar. Rename or switch
   chats; both titles must update. Resize the sidebar and check that the short
   toolbar divider stays aligned with the conversation's left border.
2. Draft multiline text. Check Enter versus Shift+Enter and staged-file-only Enter.
   Send requires a connected, unarchived idle chat and no unresolved submission.
   Blocked sends retain the draft; catalog errors show a reachable Retry. Run the
   linked Pi chat acceptance checks only after explicit billable-inference setup.
3. Open the avatar popup; click the identity to reach Profile. Check actual identity.
4. Dismiss the popup with Escape/outside click and inspect it with sidebar closed.
5. Switch settings sections, search, and use Back/Forward.
6. Toggle the right pane and enter/exit full view. Move away from the control:
   no tooltip should persist after clicking or leaving full view with Escape.
7. Drag both vertical dividers; check resizing, minimum/maximum widths, sidebar
   toggles, navigation, and full view. Tab to each divider and check Left/Right
   arrows and Home/End. Inspect a narrow viewport for reachable controls and
   horizontal overflow; resize handles should be hidden.
8. Switch each of the five themes in Appearance; check immediate changes, reload,
   same-account tabs and another account's independent preference. Inspect focus,
   hover/selection, code, status colors and controls in each palette.
9. Archive a chat; confirm the input disappears, Unarchive restores it and a current
   answer still has Stop. Log out; signin and existing admin access remain unchanged.
10. Open Context and Cost separately: all ledger rows must paint above the composer.
    Escape returns to the initiating button; outside clicks keep their native focus.
    Shift+Tab from Usage to model/effort must close the old ledger, not cover the picker.
    Cancel Rename with Escape and confirm focus returns without saving.

Stop local dev before frontend build checks, then restart it. Otherwise the asset
manifest can become stale and return SPA HTML for new hashed JS/CSS requests.
Check asset MIME types and bodies; HTTP 200 alone does not establish delivery.
