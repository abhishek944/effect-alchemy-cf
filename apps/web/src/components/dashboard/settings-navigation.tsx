import RouteLink from "@/lib/route-link";
import { Icon } from "./icon";
import ImageIcon from "./image-icon";
import type { SettingsSection } from "./model";
import { SETTINGS_ROUTES } from "./routes";
import SearchField from "./search-field";
import SkillsNavIcon from "./skills-nav-icon";

const icons = {
  general: <Icon name="sliders-horizontal" />,
  voice: <Icon name="mic" />,
  images: <ImageIcon />,
  skills: <SkillsNavIcon />,
  profile: <Icon name="square-pen" />,
  appearance: <Icon name="wrench" />,
  account: <Icon name="shield" />,
};

/** Shared route registry remains the authority; the shell keeps its search draft. */
export default function SettingsNavigation({
  section,
  search,
  onSearch,
}: {
  section: SettingsSection | null;
  search: string;
  onSearch: (value: string) => void;
}) {
  const visible = SETTINGS_ROUTES.filter((item) =>
    item.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div data-cx="sidebar-heading">
        <strong>Settings</strong>
      </div>
      <SearchField
        id="settings-search"
        label="Search settings"
        value={search}
        onChange={onSearch}
        status={`${visible.length} matching settings sections`}
      />
      <nav data-cx="sidebar-navigation" aria-label="Settings sections">
        {visible.map((item) => (
          <RouteLink
            key={item.section}
            href={item.href}
            data-cx="nav-row"
            aria-current={section === item.section ? "page" : undefined}
          >
            {icons[item.section]}
            <span>{item.title}</span>
          </RouteLink>
        ))}
        {visible.length === 0 && <output data-cx="search-empty">No matching settings.</output>}
      </nav>
    </>
  );
}
