import type { ComponentProps } from "react";
import "./dropdown.css";

export function DropdownIndicator() {
  return (
    <svg
      data-cx="dropdown-indicator"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M2 3.5h8l-4 5z" />
    </svg>
  );
}

export function DropdownSelect(props: ComponentProps<"select">) {
  return (
    <span data-cx="select-wrap">
      <select {...props} />
      <DropdownIndicator />
    </span>
  );
}
