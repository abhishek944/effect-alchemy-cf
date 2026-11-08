import { useCallback, useEffect, useRef, useState } from "react";
import SubscriptionCancelDialog from "./subscription-cancel-dialog";
import { SubscriptionIcon } from "./subscription-icons";
import { SUBSCRIPTION_PLANS } from "./subscription-plan-data";
import "./subscription.css";
import "./subscription-management.css";
import "./subscription-dialog.css";
import "./subscription-responsive.css";

const MANAGEMENT_FACTS = [
  { label: "Subscription status", value: "Not available" },
  { label: "Latest invoice", value: "Not available" },
  { label: "Cancellation timing", value: "Not available" },
] as const;

/**
 * Illustrative subscription page.
 *
 * There is no authoritative billing read in this application, so this page never
 * claims a current plan, price, entitlement, invoice or cancellation policy. Plan
 * actions stay disabled and management is an explicitly labeled preview.
 */
export default function SubscriptionPage() {
  const [managementOpen, setManagementOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const managementRef = useRef<HTMLElement>(null);
  const manageTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const closeReview = useCallback(() => setReviewOpen(false), []);

  useEffect(() => {
    if (managementOpen) managementRef.current?.focus();
  }, [managementOpen]);

  const closeManagement = () => {
    setManagementOpen(false);
    manageTriggerRef.current?.focus();
  };

  return (
    <div data-cx="subscription">
      <header data-cx="subscription-heading">
        <div>
          <h1>Choose your plan</h1>
          <p>
            Illustrative preview. Billing isn&rsquo;t connected, so plan status and financial
            actions are unavailable.
          </p>
        </div>
        <span data-cx="subscription-tag">Illustrative plan details</span>
      </header>

      <section data-cx="subscription-plans" aria-label="Illustrative plan comparison">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <article key={plan.id} data-cx="subscription-plan" data-plan={plan.id}>
            <div data-cx="subscription-plan-top">
              <h2>{plan.name}</h2>
              {plan.recommended ? <span data-cx="subscription-badge">Recommended</span> : null}
            </div>
            <h3>{plan.tagline}</h3>
            <p data-cx="subscription-description">{plan.description}</p>

            {plan.id === "free" ? (
              <p data-cx="subscription-unavailable">Plan status unavailable</p>
            ) : (
              <button
                type="button"
                data-cx="subscription-upgrade"
                disabled
                title="Unavailable until a billing source is connected"
              >
                <SubscriptionIcon name="sparkle" />
                Upgrade unavailable
              </button>
            )}

            <p data-cx="subscription-price">
              <span>$</span>
              {plan.price}
              <small>example price</small>
            </p>
            <p data-cx="subscription-caption">Proposed feature examples</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature.label}>
                  <SubscriptionIcon name={feature.icon} />
                  <span>{feature.label}</span>
                </li>
              ))}
            </ul>

            {plan.id === "plus" ? (
              <div data-cx="subscription-manage-entry">
                <button
                  ref={manageTriggerRef}
                  type="button"
                  aria-expanded={managementOpen}
                  aria-controls="subscription-management"
                  onClick={() => setManagementOpen(true)}
                >
                  Preview management
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <p data-cx="subscription-example-note">
        Design example &middot; Free $0, Plus $20 and Max $50 are sample prices. Feature grouping is
        proposed, not confirmed plan entitlements. Billing period is not specified.
      </p>

      <section
        ref={managementRef}
        id="subscription-management"
        data-cx="subscription-management"
        hidden={!managementOpen}
        tabIndex={-1}
        aria-labelledby="subscription-management-title"
      >
        <div data-cx="subscription-management-top">
          <h2 id="subscription-management-title">Manage subscription</h2>
          <button type="button" data-cx="subscription-close" onClick={closeManagement}>
            Close details
          </button>
        </div>
        <p data-cx="subscription-management-note">
          Illustrative preview only. No billing source is connected, so no plan details or payment
          history can be shown.
        </p>
        <dl data-cx="subscription-facts">
          {MANAGEMENT_FACTS.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        <h3>Recent payments</h3>
        <p data-cx="subscription-management-note">
          No payment history is available in this design preview.
        </p>
        <button
          ref={cancelTriggerRef}
          type="button"
          data-cx="subscription-cancel-open"
          onClick={() => setReviewOpen(true)}
        >
          Preview cancellation
        </button>
        <p data-cx="subscription-management-note">
          Preview only &middot; no billing action is connected.
        </p>
      </section>

      <SubscriptionCancelDialog
        open={reviewOpen}
        onClose={closeReview}
        returnFocus={cancelTriggerRef}
      />
    </div>
  );
}
