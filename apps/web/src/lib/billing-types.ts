/**
 * Browser-side mirror of the stable documented billing API contract.
 * The shared schema lives in packages/integrations, which browser code must
 * never import, so this module restates only the fields the account UI reads.
 */
export type BillingProvider = "dodo" | "polar";
export type ProductKind = "subscription" | "one_time";
export type ResourceKind = "subscription" | "purchase" | "refund" | "dispute";
export type AccessState = "active" | "inactive";

export type BillingProduct = {
  slug: string;
  label: string;
  kind: ProductKind;
};

export type BillingCustomer = {
  scope: string;
  provider: BillingProvider;
};

export type Entitlement = {
  slug: string;
  kind: ProductKind;
  productId: string;
};

export type ProviderResource = {
  kind: ResourceKind;
  id: string;
  customerId: string;
  productId: string | null;
  status: string;
  subscriptionId: string | null;
  purchaseId: string | null;
  checkoutId: string | null;
  amount: number | null;
  currency: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  accessState: AccessState;
  refundedAmount: number;
  disputed: boolean;
  products: { id: string; quantity: number }[];
};

export type StoredResource = {
  resource: ProviderResource;
  entitlements: Entitlement[];
};

export type BillingResource = {
  key: string;
  scope: string;
  provider: BillingProvider;
  snapshot: StoredResource;
  /** Epoch seconds of the last provider sync. */
  syncedAt: number;
  stale: boolean;
  access: boolean;
};

export type BillingView = {
  enabled: boolean;
  defaultProvider: BillingProvider | null;
  products: BillingProduct[];
  customers: BillingCustomer[];
  resources: BillingResource[];
};

export type CheckoutRedirect = {
  id: string;
  url: string;
};
