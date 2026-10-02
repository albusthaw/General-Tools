// Dates, times and lengths in the person's own locale.

const locale = () => (navigator.languages && navigator.languages[0]) || navigator.language || "en-GB";

export function dateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function dateOnly(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(new Date(value));
}

export function timeOnly(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(new Date(value));
}

// "Today", "Yesterday" or a date, for grouping lists.
export function dayLabel(value, now = new Date()) {
  const date = new Date(value);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}

// 754 -> "12:34", 3723 -> "1:02:03"
export function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 754 -> "12 min 34 s", 45 -> "45 s"
export function duration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  if (s < 60) return `${s} s`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  const rest = s % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// Credit in whole minutes, e.g. "42 minutes".
export function minutes(totalSeconds) {
  const value = Math.floor((totalSeconds || 0) / 60);
  return `${value.toLocaleString(locale())} ${value === 1 ? "minute" : "minutes"}`;
}

export function relative(value, now = Date.now()) {
  if (!value) return "never";
  const diff = Math.round((new Date(value).getTime() - now) / 1000);
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return "just now";
}

export function initials(name, email) {
  const source = (name || "").trim() || (email || "").split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "");
  return letters.toUpperCase() || "?";
}
