export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const CALL_DATE_RANGE_OPTIONS = [
  { value: 'Today', label: 'Today' },
  { value: 'Last 24 hours', label: 'Last 24 hours' },
  { value: 'Yesterday', label: 'Yesterday' },
  { value: 'This week', label: 'This week' },
  { value: 'Last 7 days', label: 'Last 7 days' },
  { value: 'This month', label: 'This month' },
  { value: 'Last month', label: 'Last month' },
  { value: 'Last 30 days', label: 'Last 30 days' },
  { value: 'All time', label: 'All time' },
  { value: 'Custom', label: 'Custom' },
] as const;

export interface DateRangeBounds {
  start?: Date;
  end?: Date;
}

function getISTCalendarParts(referenceDate: Date) {
  const shifted = new Date(referenceDate.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(), // 0 = Sunday .. 6 = Saturday
  };
}

function istStartOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

function istEndOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
}

function parseDateInput(dateStr?: string | null): { year: number; month: number; day: number } | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month: month - 1, day };
}

/**
 * Returns the YYYY-MM-DD key for the current date in IST (Asia/Kolkata).
 */
export function getISTDateKey(referenceDate: Date = new Date()): string {
  const { year, month, day } = getISTCalendarParts(referenceDate);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/**
 * Computes exact IST (+05:30) UTC Date bounds for all dashboard/calls/activity filters.
 * Returns null for 'All time' or when 'Custom' has no valid dates supplied.
 */
export function getDateRangeBounds(
  dateRange: string,
  startDateParam?: string | null,
  endDateParam?: string | null,
  now: Date = new Date()
): DateRangeBounds | null {
  if (!dateRange || dateRange === 'All time') {
    return null;
  }

  const { year, month, day, dayOfWeek } = getISTCalendarParts(now);
  const startOfToday = istStartOfDay(year, month, day);
  const endOfToday = istEndOfDay(year, month, day);

  switch (dateRange) {
    case 'Today':
      return { start: startOfToday, end: endOfToday };

    case 'Last 24 hours':
      return { start: new Date(now.getTime() - ONE_DAY_MS), end: now };

    case 'Yesterday':
      return {
        start: istStartOfDay(year, month, day - 1),
        end: istEndOfDay(year, month, day - 1),
      };

    case 'This week':
      // Calendar week starting Sunday (e.g. Sun 8 Nov .. Thu 12 Nov)
      return {
        start: istStartOfDay(year, month, day - dayOfWeek),
        end: endOfToday,
      };

    case 'Last 7 days':
      // Rolling 7 calendar days including today (e.g. 6 Nov .. 12 Nov)
      return {
        start: istStartOfDay(year, month, day - 6),
        end: endOfToday,
      };

    case 'This month':
      // Calendar month to date (e.g. 1 Nov .. 12 Nov)
      return {
        start: istStartOfDay(year, month, 1),
        end: endOfToday,
      };

    case 'Last month': {
      // Full previous calendar month (e.g. 1 Oct .. 31 Oct)
      const startOfThisMonth = istStartOfDay(year, month, 1);
      return {
        start: istStartOfDay(year, month - 1, 1),
        end: new Date(startOfThisMonth.getTime() - 1),
      };
    }

    case 'Last 30 days':
      // Rolling 30 calendar days including today
      return {
        start: istStartOfDay(year, month, day - 29),
        end: endOfToday,
      };

    case 'Custom': {
      const parsedStart = parseDateInput(startDateParam);
      const parsedEnd = parseDateInput(endDateParam);
      if (!parsedStart && !parsedEnd) return null;
      const bounds: DateRangeBounds = {};
      if (parsedStart) {
        bounds.start = istStartOfDay(parsedStart.year, parsedStart.month, parsedStart.day);
      }
      if (parsedEnd) {
        bounds.end = istEndOfDay(parsedEnd.year, parsedEnd.month, parsedEnd.day);
      }
      return bounds;
    }

    default:
      return null;
  }
}

/**
 * Builds a MongoDB $gte / $lte filter object for a date field, or null if unconstrained.
 */
export function buildDateMongoFilter(
  dateRange: string,
  startDateParam?: string | null,
  endDateParam?: string | null,
  now: Date = new Date()
): { $gte?: Date; $lte?: Date } | null {
  const bounds = getDateRangeBounds(dateRange, startDateParam, endDateParam, now);
  if (!bounds || (!bounds.start && !bounds.end)) return null;

  const condition: { $gte?: Date; $lte?: Date } = {};
  if (bounds.start) condition.$gte = bounds.start;
  if (bounds.end) condition.$lte = bounds.end;
  return condition;
}

/**
 * Client-side predicate verifying whether a timestamp falls within the active date range.
 */
export function isDateInRange(
  value: Date | string | number | null | undefined,
  dateRange: string,
  startDateParam?: string | null,
  endDateParam?: string | null,
  now: Date = new Date()
): boolean {
  const bounds = getDateRangeBounds(dateRange, startDateParam, endDateParam, now);
  if (!bounds) return true;

  const date = value ? new Date(value) : now;
  if (Number.isNaN(date.getTime())) return false;
  if (bounds.start && date < bounds.start) return false;
  if (bounds.end && date > bounds.end) return false;
  return true;
}

const IST_SHORT_DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Formats a concise human-readable IST date span for UI display (e.g. "1 Nov 2026 – 12 Nov 2026").
 */
export function formatDateRangeSpan(
  dateRange: string,
  startDateParam?: string | null,
  endDateParam?: string | null,
  now: Date = new Date()
): string | null {
  if (!dateRange || dateRange === 'All time' || dateRange === 'Last 24 hours') {
    return null;
  }
  const bounds = getDateRangeBounds(dateRange, startDateParam, endDateParam, now);
  if (!bounds) return null;

  const startStr = bounds.start ? IST_SHORT_DATE_FMT.format(bounds.start) : '...';
  const endStr = bounds.end ? IST_SHORT_DATE_FMT.format(bounds.end) : '...';
  return startStr === endStr ? startStr : `${startStr} – ${endStr}`;
}

