/**
 * Task Alarm Time Calculator
 * Computes the next execution time (UTC epoch ms) for a scheduled task.
 * Uses Intl.DateTimeFormat for timezone handling — no external dependencies.
 */

interface TaskScheduleConfig {
  frequency: string;           // once|hourly|daily|weekly|monthly|yearly
  execution_time: string;      // "HH:MM"
  interval_hours?: number | null;
  day_of_week?: number | null;   // 0-6, Monday=0
  day_of_month?: number | null;  // 1-31
  month_of_year?: number | null; // 1-12
  timezone: string;
  next_execution_at?: string | null;
}

/**
 * Get the current time in a specific timezone as { year, month, day, hour, minute, dayOfWeek }
 */
function getNowInTimezone(timezone: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; dayOfWeek: number;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const get = (type: string) => {
    const p = parts.find(p => p.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const weekdayMap: Record<string, number> = {
    'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6
  };

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') === 24 ? 0 : get('hour'),
    minute: get('minute'),
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
  };
}

/**
 * Convert a date/time in a specific timezone to UTC epoch ms.
 * Uses a binary-search approach to find the exact UTC timestamp.
 */
function timezoneToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number, timezone: string
): number {
  // Create a rough UTC estimate
  const roughUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // Format this UTC time in the target timezone and compute offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });

  // Try offsets from -14h to +14h to find the right one
  for (let offsetH = -14; offsetH <= 14; offsetH++) {
    const candidate = roughUtc - offsetH * 3600_000;
    const parts = formatter.formatToParts(new Date(candidate));
    const get = (type: string) => {
      const p = parts.find(p => p.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    const cH = get('hour') === 24 ? 0 : get('hour');
    const cM = get('minute');
    const cD = get('day');
    const cMo = get('month');

    if (cH === hour && cM === minute && cD === day && cMo === month) {
      return candidate;
    }
  }

  // Fallback: use the rough estimate
  return roughUtc;
}

/**
 * Compute the next execution time for a scheduled task.
 * Returns UTC epoch ms, or null if the task should not be scheduled.
 */
export function computeNextExecutionTime(task: TaskScheduleConfig): number | null {
  // 1. If backend provides next_execution_at and it's in the future, use it
  if (task.next_execution_at) {
    const backendNext = new Date(task.next_execution_at).getTime();
    if (!isNaN(backendNext) && backendNext > Date.now()) {
      return backendNext;
    }
  }

  const timezone = task.timezone || 'UTC';
  const [execH, execM] = (task.execution_time || '09:00').split(':').map(Number);
  const now = getNowInTimezone(timezone);
  const nowMs = Date.now();

  switch (task.frequency) {
    case 'once': {
      // Once task: schedule for today if not passed, otherwise null
      const todayMs = timezoneToUtcMs(now.year, now.month, now.day, execH, execM, timezone);
      return todayMs > nowMs ? todayMs : null;
    }

    case 'hourly': {
      const interval = task.interval_hours || 1;
      // Next occurrence: round up to the next interval boundary from execution_time
      let candidateMs = timezoneToUtcMs(now.year, now.month, now.day, execH, execM, timezone);

      // If start time is in the past, advance by interval until it's in the future
      while (candidateMs <= nowMs) {
        candidateMs += interval * 3600_000;
      }
      return candidateMs;
    }

    case 'daily': {
      let candidateMs = timezoneToUtcMs(now.year, now.month, now.day, execH, execM, timezone);
      if (candidateMs <= nowMs) {
        candidateMs += 24 * 3600_000; // Tomorrow
      }
      return candidateMs;
    }

    case 'weekly': {
      const targetDow = task.day_of_week ?? 0; // 0=Monday
      let daysUntil = targetDow - now.dayOfWeek;
      if (daysUntil < 0) daysUntil += 7;

      let candidateMs = timezoneToUtcMs(
        now.year, now.month, now.day + daysUntil,
        execH, execM, timezone
      );
      if (candidateMs <= nowMs) {
        candidateMs += 7 * 24 * 3600_000; // Next week
      }
      return candidateMs;
    }

    case 'monthly': {
      const targetDay = task.day_of_month ?? 1;
      // Try this month first
      let candidateMs = timezoneToUtcMs(now.year, now.month, targetDay, execH, execM, timezone);
      if (candidateMs <= nowMs) {
        // Next month
        const nextMonth = now.month === 12 ? 1 : now.month + 1;
        const nextYear = now.month === 12 ? now.year + 1 : now.year;
        candidateMs = timezoneToUtcMs(nextYear, nextMonth, targetDay, execH, execM, timezone);
      }
      return candidateMs;
    }

    case 'yearly': {
      const targetMonth = task.month_of_year ?? 1;
      const targetDay = task.day_of_month ?? 1;
      let candidateMs = timezoneToUtcMs(now.year, targetMonth, targetDay, execH, execM, timezone);
      if (candidateMs <= nowMs) {
        candidateMs = timezoneToUtcMs(now.year + 1, targetMonth, targetDay, execH, execM, timezone);
      }
      return candidateMs;
    }

    default:
      return null;
  }
}
