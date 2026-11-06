import { useState } from "react";
import type { AuthMode } from "./auth-form";

export default function AuthFields({ mode, pending }: { mode: AuthMode; pending: boolean }) {
  const signup = mode === "sign-up";
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="fields">
      {signup && (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" autoComplete="name" required disabled={pending} />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={pending}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 12 : 1}
            aria-describedby={signup ? "password-minlength-hint" : undefined}
            required
            disabled={pending}
          />
          <button
            className="password-visibility"
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-controls="password"
            title={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((visible) => !visible)}
            disabled={pending}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
        {signup && (
          <p id="password-minlength-hint" className="hint">
            At least 12 characters.
          </p>
        )}
      </div>
    </div>
  );
}
