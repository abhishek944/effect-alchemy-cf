import { useRef } from "react";
import { Icon } from "./icon";
import "./search-field.css";

/** Shared sidebar search; callers own filtering and result announcements. */
export default function SearchField({
  id,
  label,
  value,
  onChange,
  status,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  status?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div data-cx="search-field">
      <Icon name="search" />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        data-cx="search-field-input"
        type="search"
        placeholder="Search"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      {value && (
        <button
          type="button"
          data-cx="search-field-clear"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          ✕
        </button>
      )}
      <output className="sr-only" aria-live="polite">
        {value ? status : ""}
      </output>
    </div>
  );
}
