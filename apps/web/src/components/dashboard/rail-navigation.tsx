import RouteLink from "@/lib/route-link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import Tooltip from "./tooltip";
import "./rail.css";

type RailDestination = "home" | "usage" | "subscription" | "settings";

type RailItemProps = {
  href: string;
  label: string;
  icon: IconName;
  current: boolean;
};

type Props = {
  homeHref: string;
  current: RailDestination | null;
  account: ReactNode;
};

function RailItem({ href, label, icon, current }: RailItemProps) {
  return (
    <Tooltip label={label} side="right">
      <RouteLink
        href={href}
        data-cx="rail-link"
        aria-label={label}
        aria-current={current ? "page" : undefined}
      >
        <span data-cx="rail-icon">
          <Icon name={icon} />
        </span>
        <span data-cx="rail-label">{label}</span>
      </RouteLink>
    </Tooltip>
  );
}

export default function RailNavigation({ homeHref, current, account }: Props) {
  return (
    <nav data-cx="rail" aria-label="Global navigation">
      <RailItem href={homeHref} label="Home" icon="house" current={current === "home"} />
      <RailItem
        href="/usage"
        label="Usage"
        icon="sliders-horizontal"
        current={current === "usage"}
      />
      <RailItem
        href="/subscription"
        label="Subscription"
        icon="credit-card"
        current={current === "subscription"}
      />
      <RailItem
        href="/settings/general"
        label="Settings"
        icon="settings"
        current={current === "settings"}
      />
      <div data-cx="rail-account">{account}</div>
    </nav>
  );
}
