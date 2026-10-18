import { useCallback, useEffect, useRef, useState } from "react";
import {
  billingErrorMessage,
  fetchBilling,
  openPortal,
  redirectToProvider,
  refreshResource,
  startCheckout,
} from "@/lib/billing-api";
import {
  beginBillingAttempt,
  reconcileBillingAttempts,
  recordBillingReceipt,
  STORAGE_UNAVAILABLE_MESSAGE,
} from "@/lib/billing-attempts";
import type { BillingView } from "@/lib/billing-types";
import BillingOffers from "./billing-offers";
import BillingResourceList from "./billing-resource-list";
import BillingReturnNotice from "./billing-return-notice";
import ErrorNotice from "./error-notice";
import ReadErrorNotice from "./read-error-notice";
import "./billing.css";
type Phase = "loading" | "ready" | "error";

/**
 * Account billing panel. One request UUID is persisted per user and product
 * slug in session storage, so a remount, reload or provider return keeps the
 * same logical attempt; an unknown outcome is never retried automatically,
 * and every mutation is busy-disabled until it settles.
 */
export default function BillingPanel({ userId }: { userId: string }) {
  const [view, setView] = useState<BillingView | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [returned] = useState(
    () => new URLSearchParams(window.location.search).get("billing") === "return",
  );

  const applyView = useCallback(
    (next: BillingView) => {
      reconcileBillingAttempts(userId, next);
      setView(next);
      setPhase("ready");
    },
    [userId],
  );

  const applyLoadFailure = useCallback((cause: unknown) => {
    setLoadError(billingErrorMessage(cause));
    setPhase("error");
  }, []);
  const load = useCallback(() => {
    const controller = new AbortController();
    fetchBilling(controller.signal).then(applyView, (cause: unknown) => {
      if (!controller.signal.aborted) applyLoadFailure(cause);
    });
    return () => controller.abort();
  }, [applyView, applyLoadFailure]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("billing") === "return") {
      window.history.replaceState(null, "", "/settings/account");
    }
    return load();
  }, [load]);
  function retryLoad() {
    setPhase("loading");
    load();
  }
  async function reload() {
    if (busy) return;
    setBusy("reload");
    setNotice(null);
    setError(null);
    try {
      applyView(await fetchBilling());
      setNotice("Billing details refreshed.");
    } catch (cause) {
      setError(billingErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }
  async function checkout(slug: string) {
    if (busy) return;
    setNotice(null);
    setError(null);
    const attempt = beginBillingAttempt(userId, slug);
    if (!attempt) {
      setError(STORAGE_UNAVAILABLE_MESSAGE);
      return;
    }
    setBusy(`checkout:${slug}`);
    setNotice("Opening secure checkout…");
    try {
      const receipt = await startCheckout(slug, attempt.requestId);
      recordBillingReceipt(userId, slug, attempt.requestId, receipt.id);
      redirectToProvider(receipt.url);
    } catch (cause) {
      setNotice(null);
      setError(billingErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }
  async function portal(scope: string) {
    if (busy) return;
    setBusy(`portal:${scope}`);
    setNotice("Opening the billing portal…");
    setError(null);
    try {
      redirectToProvider(await openPortal(scope));
    } catch (cause) {
      setNotice(null);
      setError(billingErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }
  async function refresh(key: string) {
    if (busy) return;
    setBusy(`refresh:${key}`);
    setNotice(null);
    setError(null);
    try {
      await refreshResource(key);
      applyView(await fetchBilling());
      setNotice("Billing details refreshed.");
    } catch (cause) {
      setError(billingErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Billing" data-cx="settings-group">
      <h2 data-cx="settings-group-title">Billing</h2>
      <div data-cx="billing-card">
        {phase === "loading" ? (
          <section data-cx="billing-section">
            <output data-cx="billing-muted">Loading billing details…</output>
          </section>
        ) : null}
        {phase === "error" ? (
          <div data-cx="billing-error-host">
            <ReadErrorNotice
              title="Couldn’t load billing"
              message={loadError}
              actionLabel="Refresh billing"
              onReload={retryLoad}
              focusTarget={sectionRef}
            />
          </div>
        ) : null}

        {view ? (
          <>
            {returned ? <BillingReturnNotice busy={busy} onRefresh={() => void reload()} /> : null}

            <BillingOffers
              busy={busy}
              onCheckout={(slug) => void checkout(slug)}
              onPortal={(scope) => void portal(scope)}
              view={view}
            />

            <BillingResourceList busy={busy} onRefresh={(key) => void refresh(key)} view={view} />

            <output data-cx="billing-status">{notice}</output>
            {error && (
              <div data-cx="billing-error-host">
                <ErrorNotice
                  title="Couldn’t complete the billing action"
                  message={error}
                  action={{
                    label: "Refresh billing",
                    onClick: () => {
                      sectionRef.current?.focus();
                      void reload();
                    },
                    disabled: Boolean(busy),
                  }}
                  onDismiss={() => {
                    sectionRef.current?.focus();
                    setError(null);
                  }}
                  dismissLabel="Dismiss billing error"
                />
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
