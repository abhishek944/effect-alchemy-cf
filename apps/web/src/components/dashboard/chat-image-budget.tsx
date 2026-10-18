import { documentImageBudget, type ImageBudget } from "./chat-file-budgets";

/**
 * The document-wide staging/preview budget. It is deliberately not created or
 * released per provider/account mount, so work started by a previous account
 * keeps its capacity charged until its own attempt finishes.
 */
export function useImageBudget(): ImageBudget {
  return documentImageBudget;
}
