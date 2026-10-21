/**
 * Mandatory application-owned Models boundary.
 *
 * Hooks are intentionally not the failure authority: section-render errors and
 * task-hook exceptions are swallowed by the installed harness. This guard wraps
 * `streamSimple` itself, verifies the exact live attempt before delegating,
 * rebuilds the catalog/active sections from durable state (so obsolete physical
 * bodies cannot be replayed), and returns a terminal zero-usage aborted message
 * on any defect (zero SDK counters are not a no-charge claim). Summarization has
 * a separate pinned raw path/health check: guidance never enters compaction, and
 * the existing accounting observer still sees every summary attempt.
 */
import {
  collapseSystemMessages,
  lazyStream,
  normalizeContext,
  type Api,
  type Context,
  type Model,
  type SystemMessage,
} from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { blocked, blockedStream } from "./chat-guard-blocked.ts";
import { effectiveGenerationOutputTokens } from "./chat-generation-output-budget.ts";

export {
  MAX_FINAL_REQUEST_BYTES,
  requestBudgetBytes,
  requestTextBytes as contextBytes,
} from "./chat-request-budget.ts";

export type GuardedRequest =
  | {
      readonly ok: true;
      readonly context: Context;
      readonly transportSignal?: AbortSignal;
      /** Close on actual SDK stream settlement; binding/body tracking can outlive it. */
      readonly cleanup?: () => void;
    }
  | { readonly ok: false; readonly message: string };

export type SkillRequestGuard = {
  readonly prepare: (
    model: Model<Api>,
    context: Context,
    signal?: AbortSignal,
  ) => Promise<GuardedRequest>;
  readonly summary: () => Promise<
    { readonly ok: true } | { readonly ok: false; readonly message: string }
  >;
  /** Capture the operation this dispatch belongs to before any await. */
  readonly capture?: () => Promise<string | null>;
  /** Persist/latch an unexpected boundary failure for the captured operation only. */
  readonly failed?: (message: string, operationId: string | null) => Promise<void> | void;
};

/** UTF-8 bytes of the two host sections the guard will add to one request. */
export const skillSectionBytes = (catalog: string | null, active: string | null): number =>
  new TextEncoder().encode(JSON.stringify({ skills: catalog, skill_context: active })).byteLength;

/**
 * Fold to one leading system message and replace exactly the two host sections.
 * Ordinary history and tool declarations survive; obsolete skill sections do
 * not, regardless of what a renderer retained before this boundary.
 */
export const canonicalSkillContext = (
  context: Context,
  catalog: string | null,
  active: string | null,
  timestamp: number,
): Context => {
  const folded = collapseSystemMessages(normalizeContext(context));
  const first = folded.messages[0];
  const sections: Record<string, string | null> =
    first !== undefined && first.role === "system" ? { ...first.sections } : {};
  delete sections.skills;
  delete sections.skill_context;
  if (catalog !== null) sections.skills = catalog;
  if (active !== null) sections.skill_context = active;
  if (first !== undefined && first.role === "system") {
    const next: SystemMessage = { ...first, sections, timestamp: first.timestamp || timestamp };
    return { messages: [next, ...folded.messages.slice(1)] };
  }
  if (Object.keys(sections).length === 0) return context;
  const head: SystemMessage = { role: "system", content: "", sections, timestamp };
  return { messages: [head, ...folded.messages] };
};

/**
 * Installs the boundary in the required order: pin the raw stream, keep
 * compaction accounting on that raw path, then guard generation and finally
 * put the separate summary-health check outside the observer.
 */
export const installSkillModelsGuard = (
  models: Models,
  deps: { readonly observeCompactions: () => void; readonly guard: SkillRequestGuard },
): void => {
  const rawStream = models.streamSimple.bind(models);
  models.completeSimple = (model, context, options) => rawStream(model, context, options).result();
  deps.observeCompactions();
  const observedComplete = models.completeSimple.bind(models);
  const captureScope = async (): Promise<string | null> => {
    try {
      return (await deps.guard.capture?.()) ?? null;
    } catch {
      return null;
    }
  };
  models.streamSimple = (model, context, options) =>
    lazyStream(model, async () => {
      let cleanup: (() => void) | undefined;
      const finish = (): void => {
        const close = cleanup;
        cleanup = undefined;
        try {
          close?.();
        } catch {
          /* Never mask the actual stream outcome. */
        }
      };
      const scope = await captureScope();
      try {
        const maxTokens = effectiveGenerationOutputTokens(
          model.contextWindow,
          model.maxTokens,
          options?.maxTokens,
        );
        // Installed Responses transport raises smaller limits to 16; never silently exceed a cap.
        if (model.api === "openai-responses" && maxTokens < 16)
          return blockedStream(model, "The output limit is below this model's transport minimum.");
        const prepared = await deps.guard.prepare(model, context, options?.signal);
        if (!prepared.ok) return blockedStream(model, prepared.message);
        cleanup = prepared.cleanup;
        if (options?.signal?.aborted || prepared.transportSignal?.aborted) {
          finish();
          return blockedStream(model, "This answer was stopped; it may be incomplete.");
        }
        const stream = rawStream(
          // Cap AFTER proof checks; Anthropic thinking must not expand the requested ceiling.
          { ...model, maxTokens },
          prepared.context,
          {
            ...options,
            maxTokens,
            ...(prepared.transportSignal === undefined ? {} : { signal: prepared.transportSignal }),
          },
        );
        // result() observes completion without competing for EventStream iteration.
        void stream.result().then(finish, finish);
        return stream;
      } catch {
        finish();
        const message = "Request verification failed; this answer is incomplete.";
        if (!options?.signal?.aborted) {
          try {
            await deps.guard.failed?.(message, scope);
          } catch {
            // Tracking must never mask the fail-closed result.
          }
        }
        return blockedStream(model, message);
      }
    });
  models.completeSimple = async (model, context, options) => {
    const scope = await captureScope();
    try {
      const health = await deps.guard.summary();
      if (!health.ok) return blocked(model, health.message);
    } catch {
      const message = "Skill context verification failed; this summary is incomplete.";
      try {
        await deps.guard.failed?.(message, scope);
      } catch {
        // Tracking must never mask the fail-closed result.
      }
      return blocked(model, message);
    }
    return observedComplete(model, context, options);
  };
};
