import AuthPanel from "@/components/auth-panel";

export default function App() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex h-[76px] max-w-6xl items-center justify-between px-6 sm:px-8">
        <a
          href="/"
          className="flex items-center gap-3 font-semibold tracking-tight"
          aria-label="Effect Alchemy Starter home"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm text-primary-foreground">
            E
          </span>
          <span>Effect Alchemy</span>
        </a>
        <span className="hidden text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground sm:block">
          Starter
        </span>
      </header>
      <main className="mx-auto grid min-h-[calc(100svh-76px)] max-w-6xl items-center gap-12 px-6 py-14 sm:px-8 lg:grid-cols-[1fr_440px] lg:gap-20 lg:py-16">
        <section className="max-w-xl">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            A fresh space for your next idea
          </p>
          <h1 className="text-5xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-6xl lg:text-[4.5rem]">
            Make room for
            <br />
            <span className="text-muted-foreground">what comes next.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground sm:text-lg">
            A quiet starting point for your next project. Sign in to pick up where you left off, or
            create an account to begin.
          </p>
        </section>
        <AuthPanel />
      </main>
    </div>
  );
}
