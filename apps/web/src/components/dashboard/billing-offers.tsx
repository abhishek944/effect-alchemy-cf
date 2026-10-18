import { kindLabel, providerLabel } from "@/lib/billing-format";
import type { BillingView } from "@/lib/billing-types";

type BillingOffersProps = {
  view: BillingView;
  busy: string | null;
  onCheckout: (slug: string) => void;
  onPortal: (scope: string) => void;
};

/**
 * Plan purchase buttons appear only while new sales are enabled. Historical
 * customers keep their portal entry even when sales are disabled, and no
 * resource or customer identifiers are rendered.
 */
export default function BillingOffers({ view, busy, onCheckout, onPortal }: BillingOffersProps) {
  const hasHistory = view.customers.length > 0 || view.resources.length > 0;
  return (
    <>
      {view.enabled ? (
        <section aria-label="Available plans" data-cx="billing-section">
          <h3 data-cx="billing-section-title">Available plans</h3>
          {view.defaultProvider ? (
            <p data-cx="billing-row-meta">
              Checkout is provided by {providerLabel(view.defaultProvider)}.
            </p>
          ) : null}
          {view.products.length === 0 ? (
            <p data-cx="billing-muted">No plans are available right now.</p>
          ) : (
            <ul data-cx="billing-list">
              {view.products.map((product) => (
                <li data-cx="billing-row" key={product.slug}>
                  <div data-cx="billing-row-main">
                    <span data-cx="billing-row-title">{product.label}</span>
                    <span data-cx="billing-row-meta">{kindLabel(product.kind)}</span>
                  </div>
                  <div data-cx="billing-row-actions">
                    <button
                      type="button"
                      data-cx="billing-button"
                      data-tone="primary"
                      aria-busy={busy === `checkout:${product.slug}`}
                      disabled={busy !== null}
                      onClick={() => onCheckout(product.slug)}
                    >
                      {product.kind === "subscription" ? "Subscribe" : "Buy"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section data-cx="billing-section">
          <p data-cx="billing-muted">
            Payments are not configured for this deployment.
            {hasHistory ? " Existing records remain visible below." : ""}
          </p>
        </section>
      )}

      {view.customers.length > 0 ? (
        <section aria-label="Manage billing" data-cx="billing-section">
          <h3 data-cx="billing-section-title">Manage billing</h3>
          <ul data-cx="billing-list">
            {view.customers.map((customer) => (
              <li data-cx="billing-row" key={`${customer.provider}:${customer.scope}`}>
                <div data-cx="billing-row-main">
                  <span data-cx="billing-row-title">{providerLabel(customer.provider)}</span>
                  <span data-cx="billing-row-meta">Billing portal for this account</span>
                </div>
                <div data-cx="billing-row-actions">
                  <button
                    type="button"
                    data-cx="billing-button"
                    aria-busy={busy === `portal:${customer.scope}`}
                    aria-label={`Open the ${providerLabel(customer.provider)} billing portal`}
                    disabled={busy !== null}
                    onClick={() => onPortal(customer.scope)}
                  >
                    Open portal
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
