import {
  formatAmount,
  formatDate,
  formatTimestamp,
  kindLabel,
  providerLabel,
  statusLabel,
} from "@/lib/billing-format";
import type { BillingResource, BillingView } from "@/lib/billing-types";

type BillingResourceListProps = {
  view: BillingView;
  busy: string | null;
  onRefresh: (key: string) => void;
};

function resourceTitle(resource: BillingResource, view: BillingView): string {
  const entitlement = resource.snapshot.entitlements[0];
  if (entitlement) {
    const product = view.products.find((entry) => entry.slug === entitlement.slug);
    return product ? product.label : entitlement.slug;
  }
  return kindLabel(resource.snapshot.resource.kind);
}

function resourceDetails(resource: BillingResource): string[] {
  const item = resource.snapshot.resource;
  const details = [
    `${providerLabel(resource.provider)} · ${kindLabel(item.kind)} · ${statusLabel(item.status)}`,
  ];
  const amount = formatAmount(item.amount, item.currency);
  if (amount) details.push(`Amount ${amount}`);
  if (item.kind === "purchase" && item.subscriptionId) details.push("Linked to a subscription");
  if (item.disputed) details.push("Payment disputed");
  if (item.refundedAmount > 0) {
    const refunded = formatAmount(item.refundedAmount, item.currency);
    if (refunded) details.push(`Refunded ${refunded}`);
  }
  const periodEnd = formatDate(item.periodEnd);
  if (item.cancelAtPeriodEnd) {
    details.push(periodEnd ? `Cancels at period end on ${periodEnd}` : "Cancels at period end");
  } else if (periodEnd && item.kind === "subscription") {
    details.push(`Current period ends ${periodEnd}`);
  }
  if (!resource.access || item.accessState === "inactive") details.push("Access inactive");
  details.push(`Updated ${formatTimestamp(resource.syncedAt)}`);
  return details;
}

export default function BillingResourceList({ view, busy, onRefresh }: BillingResourceListProps) {
  return (
    <section aria-label="Billing history" data-cx="billing-section">
      <h3 data-cx="billing-section-title">Billing history</h3>
      {view.resources.length === 0 ? (
        <p data-cx="billing-muted">No subscriptions or purchases yet.</p>
      ) : (
        <ul data-cx="billing-list">
          {view.resources.map((resource) => {
            const title = resourceTitle(resource, view);
            return (
              <li data-cx="billing-row" key={resource.key}>
                <div data-cx="billing-row-main">
                  <span data-cx="billing-row-title">{title}</span>
                  {resourceDetails(resource).map((detail, index) => (
                    <span data-cx="billing-row-meta" key={`${detail}-${index}`}>
                      {detail}
                    </span>
                  ))}
                </div>
                <div data-cx="billing-row-actions">
                  {resource.stale ? (
                    <span data-cx="billing-badge" data-tone="attention">
                      Out of date
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-cx="billing-button"
                    aria-busy={busy === `refresh:${resource.key}`}
                    aria-label={`Refresh ${title}`}
                    disabled={busy !== null}
                    onClick={() => onRefresh(resource.key)}
                  >
                    Refresh
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
