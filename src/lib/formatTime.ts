/**
 * Format an ISO timestamp as DD/MM/YYYY HH:MM (N seconds/minutes/hours ago).
 * The relative part uses the "ago" wording for the given reference time.
 */
export function formatProjectTimestamp(
  iso: string,
  now: Date = new Date(),
): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  const diffSeconds = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000),
  );
  const relative = relativeAgo(diffSeconds);
  return `${day}/${month}/${year} ${hours}:${minutes} (${relative})`;
}

/** Human wording for a duration in seconds, e.g. "3 minutes ago". */
function relativeAgo(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return plural(totalSeconds, "second");
  }
  if (totalSeconds < 3600) {
    return plural(Math.floor(totalSeconds / 60), "minute");
  }
  if (totalSeconds < 86400) {
    return plural(Math.floor(totalSeconds / 3600), "hour");
  }
  return plural(Math.floor(totalSeconds / 86400), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
