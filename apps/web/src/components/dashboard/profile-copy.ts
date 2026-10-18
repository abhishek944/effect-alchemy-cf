/**
 * Exact user-facing copy for the Profile recovery states and the leave dialog.
 *
 * The strings follow the selected visual source and the accepted state stems;
 * nothing here invents a celebratory notice, an Undo surface or a lie about a
 * failed save. The publishing variant exists because a save that is already in
 * flight cannot be discarded and must not be described as unsaved.
 */
export const FEEDBACK = {
  saveFailed: "That change was not saved.",
  loadFailed: "Your saved profile could not be loaded.",
  staleTitle: "Profile changed in another tab. Your draft is kept.",
  staleNote: "Review the latest saved profile before retrying.",
} as const;

export const LEAVE = {
  dirtyTitle: "Discard unsaved changes?",
  dirtyCopy: "Your name, About me and photo edits won’t be saved.",
  dirtyDiscard: "Discard changes",
  dirtyKeep: "Keep editing",
  publishingTitle: "Your profile is still being saved",
  publishingCopy:
    "Stay on this page until the save finishes. Your edits are kept meanwhile, and you can leave afterwards.",
  publishingStay: "Stay",
} as const;
