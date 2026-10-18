import "./settings.css";
import type { ReactNode } from "react";
import BillingPanel from "./billing-panel";
import { DropdownSelect } from "./dropdown";
import type { DashboardUser, SettingsSection } from "./model";
import ProfileSettings from "./profile-settings";
import { DASHBOARD_THEMES, parseDashboardTheme, useDashboardTheme } from "./theme";
import VoiceSettings from "./voice-settings";

type SettingsPanelProps = {
  user: DashboardUser;
  section: SettingsSection;
};

type SettingsRowProps = {
  label: string;
  description: string;
  value?: string;
  disabledLabel?: string;
  control?: ReactNode;
};

const NOT_CONFIGURED = "Not configured";

const sectionTitles: Record<SettingsSection, string> = {
  general: "General",
  voice: "Voice",
  profile: "Profile",
  appearance: "Appearance",
  account: "Account",
};

function SettingsRow({ label, description, value, disabledLabel, control }: SettingsRowProps) {
  return (
    <div data-cx="settings-row">
      <dt data-cx="settings-row-label">
        {label}
        <span data-cx="settings-row-description">{description}</span>
      </dt>
      <dd data-cx="settings-row-control">
        {control}
        {value ? <span data-cx="settings-value">{value}</span> : null}
        {disabledLabel ? (
          <button
            aria-label={`${label}: ${disabledLabel}`}
            data-cx="settings-disabled"
            disabled
            type="button"
          >
            {disabledLabel}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-cx="settings-group">
      <h2 data-cx="settings-group-title">{title}</h2>
      <dl data-cx="settings-card">{children}</dl>
    </section>
  );
}

function GeneralSettings() {
  return (
    <>
      <SettingsGroup title="Workspace">
        <SettingsRow
          description="Reserved for future preferences"
          disabledLabel={NOT_CONFIGURED}
          label="Workspace settings"
        />
      </SettingsGroup>
      <SettingsGroup title="Extensions">
        <SettingsRow
          description="Appear here when a module needs them"
          disabledLabel={NOT_CONFIGURED}
          label="Module settings"
        />
      </SettingsGroup>
    </>
  );
}

function ThemeControl() {
  const { theme, persisted, note, pending, failed, setTheme, retry } = useDashboardTheme();
  return (
    <>
      <DropdownSelect
        aria-label="Theme"
        aria-busy={pending}
        data-cx="theme-select"
        value={theme}
        onChange={(event) => {
          const next = parseDashboardTheme(event.target.value);
          if (next) setTheme(next);
        }}
      >
        {DASHBOARD_THEMES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </DropdownSelect>
      {note !== null ? (
        <output data-cx="theme-note" data-state={failed ? "failed" : "info"}>
          {note}
          {failed ? (
            <button data-cx="theme-retry" type="button" onClick={retry}>
              Retry
            </button>
          ) : null}
        </output>
      ) : persisted ? null : (
        <output data-cx="theme-note">
          The saved theme could not be read. Your choice applies until the account is reachable
          again.
        </output>
      )}
    </>
  );
}

function AppearanceSettings() {
  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsRow
          control={<ThemeControl />}
          description="Appearance used by the signed-in dashboard"
          label="Theme"
        />
        <SettingsRow
          description="Custom accents are not available"
          disabledLabel={NOT_CONFIGURED}
          label="Accent color"
        />
      </SettingsGroup>
    </>
  );
}

function AccountSettings({ user }: { user: DashboardUser }) {
  return (
    <>
      <SettingsGroup title="Account">
        <SettingsRow description="Account identifier" label="Email" value={user.email} />
        <SettingsRow
          description="Managed by the starter session"
          label="Session"
          value="Signed in"
        />
      </SettingsGroup>
      <SettingsGroup title="Data">
        <SettingsRow
          description="Export is not available in this starter"
          disabledLabel={NOT_CONFIGURED}
          label="Data export"
        />
      </SettingsGroup>
      <BillingPanel userId={user.id} />
    </>
  );
}

export default function SettingsPanel({ user, section }: SettingsPanelProps) {
  return (
    <div data-cx="settings-panel" data-section={section}>
      {section === "profile" ? null : <h1 data-cx="settings-title">{sectionTitles[section]}</h1>}
      {section === "general" ? <GeneralSettings /> : null}
      {section === "voice" ? <VoiceSettings /> : null}
      {section === "profile" ? (
        <ProfileSettings email={user.email} fallbackName={user.name} />
      ) : null}
      {section === "appearance" ? <AppearanceSettings /> : null}
      {section === "account" ? <AccountSettings user={user} /> : null}
    </div>
  );
}
