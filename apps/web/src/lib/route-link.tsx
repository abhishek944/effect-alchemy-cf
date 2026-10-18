import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./router";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** Keep ordinary route clicks in React while retaining native anchor behavior. */
export default function RouteLink({ href, onClick, children, ...props }: Props) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (props.target && props.target !== "_self") ||
      props.download !== undefined ||
      !href.startsWith("/") ||
      href.startsWith("//")
    )
      return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a {...props} href={href} onClick={handleClick}>
      {children}
    </a>
  );
}
