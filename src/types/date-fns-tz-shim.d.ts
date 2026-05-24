type DateInput = Date | number | string;

export function formatInTimeZone(
  date: DateInput,
  timeZone: string,
  formatStr: string,
  options?: Record<string, unknown>,
): string;

export function fromZonedTime(date: DateInput, timeZone: string): Date;
