export default function SessionPending({
  message = "Checking your session…",
}: {
  message?: string;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-[#181818] text-[#a3a3a3]">
      <output className="flex items-center gap-3 text-sm" aria-live="polite">
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
        {message}
      </output>
    </main>
  );
}
