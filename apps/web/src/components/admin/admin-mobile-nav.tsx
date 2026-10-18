import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Mobile header plus a native modal dialog drawer. */
export default function AdminMobileNav({ children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openMenu = () => dialogRef.current?.showModal();
  const closeMenu = () => dialogRef.current?.close();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const desktop = window.matchMedia("(min-width: 64rem)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) dialog.close();
    };
    // Any link inside the drawer navigates, so dismiss the drawer after the click bubbles.
    const onClick = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("a")) dialog.close();
    };
    desktop.addEventListener("change", onChange);
    dialog.addEventListener("click", onClick);
    return () => {
      desktop.removeEventListener("change", onChange);
      dialog.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
        <Button
          variant="outline"
          size="icon"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          onClick={openMenu}
        >
          <MenuIcon />
        </Button>
        <span className="font-semibold tracking-tight">Admin portal</span>
      </header>
      <dialog
        ref={dialogRef}
        aria-label="Admin navigation"
        className="fixed inset-y-0 left-0 m-0 h-full max-h-none w-72 max-w-[85vw] border-0 bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/40 lg:hidden"
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3"
          aria-label="Close navigation"
          onClick={closeMenu}
        >
          <CloseIcon />
        </Button>
        {children}
      </dialog>
    </>
  );
}
