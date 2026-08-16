export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Sunday-first matrix of weeks for a month; null = day belongs to another month. */
export function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7)
    weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function fmtTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} · ${fmtTime(iso)}`;
}

/** "Today", "Tomorrow", "Yesterday", or "Thu, Sep 3". */
export function relativeDay(iso: string): string {
  const d = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDate(d);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function parseTokenFromString(decoded: string): string | null {
  try {
    if (decoded.includes("?token=")) {
      const url = new URL(decoded);
      return url.searchParams.get("token");
    }
  } catch {
    /* not a URL — treat the whole string as a token */
  }
  return decoded.length > 8 ? decoded : null;
}