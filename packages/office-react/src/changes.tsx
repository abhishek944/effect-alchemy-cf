import type { ReviewChange } from "./review-data.ts";

type Leaf = ReviewChange["leaves"][number];
function valueLabel(value: Leaf["before"]): string {
  if (value.kind === "native-view") return `Full native view required (${value.reason})`;
  if (value.value === null) return "Empty";
  if (Object.is(value.value, -0)) return "−0";
  return String(value.value);
}
export function OfficeChanges({
  changes,
  total,
  complete,
  compact = false,
  onOpenView,
}: {
  readonly changes: readonly ReviewChange[];
  readonly total: number;
  readonly complete: boolean;
  readonly compact?: boolean;
  readonly onOpenView?: (viewId: string) => void;
}) {
  const visible = compact ? changes.slice(0, 2) : changes;
  return (
    <section
      data-office={compact ? "compact-changes" : "changes"}
      aria-label="Exact native changes"
    >
      {compact && <strong>Exact changes · {total}</strong>}
      {total === 0 ? (
        <p>
          {complete ? "No changes in this complete comparison." : "Comparison is not complete."}
        </p>
      ) : (
        <ol>
          {visible.map((change) => (
            <li key={change.id}>
              <strong>{change.path.join(" / ") || change.entityType}</strong>
              <span data-office="muted">
                {" "}
                {change.kind}
                {change.moved ? " · Moved" : ""}
              </span>
              {change.leaves.length === 0 ? (
                <p>Inspect the full native result for this structural change.</p>
              ) : (
                <dl>
                  {(compact ? change.leaves.slice(0, 1) : change.leaves).map((leaf, index) => (
                    <div key={`${change.id}:${index}`} data-office="change-leaf">
                      <dt>{leaf.path.join(" / ") || "Value"}</dt>
                      <dd data-office="before">
                        <span>− Before: </span>
                        {valueLabel(leaf.before)}
                        {onOpenView && leaf.before.kind === "native-view" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (leaf.before.kind === "native-view")
                                onOpenView(leaf.before.viewId);
                            }}
                          >
                            Open before context
                          </button>
                        )}
                      </dd>
                      <dd data-office="after">
                        <span>+ After: </span>
                        {valueLabel(leaf.after)}
                        {onOpenView && leaf.after.kind === "native-view" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (leaf.after.kind === "native-view") onOpenView(leaf.after.viewId);
                            }}
                          >
                            Open after context
                          </button>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      )}
      {compact && total > visible.length && (
        <small>
          {visible.length} of {total} changes shown. Open Exact changes for all evidence.
        </small>
      )}
    </section>
  );
}
