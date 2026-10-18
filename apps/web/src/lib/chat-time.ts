/**
 * Viewer-local formatting for the stored creation time.
 *
 * A stored value is the only source of a displayed time. An empty or corrupt
 * value is unavailable: it is never replaced with the current time, and it
 * never invalidates an otherwise valid message or history page.
 */
export function storedDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

const hourMinute = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const full = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const shortDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const withYear = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** Compact row time, or null when the stored value is unavailable. */
export function compactTime(value: string): string | null {
  const date = storedDate(value);
  return date ? hourMinute.format(date) : null;
}

/** Full date, seconds and timezone for the hover/focus detail. */
export function fullTime(value: string): string | null {
  const date = storedDate(value);
  return date ? full.format(date) : null;
}

const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** Visible local divider label: Today, Yesterday, or the local date. */
export function dayLabel(value: string, today = new Date()): string | null {
  const date = storedDate(value);
  if (!date) return null;
  if (localDayKey(date) === localDayKey(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDayKey(date) === localDayKey(yesterday)) return "Yesterday";
  return date.getFullYear() === today.getFullYear() ? shortDay.format(date) : withYear.format(date);
}
