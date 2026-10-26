/**
 * Command admission keys. Every file command uses its exact panel key, so two files in one chat
 * never serialize; one account key excludes every panel command during signout/destructive
 * navigation. Same-target native serialization stays with the panel guard, not this key.
 */
export const ACCOUNT_COMMAND = "account";
export const panelKey = (chatId: string, id: string) => `${chatId}/${id}`;
