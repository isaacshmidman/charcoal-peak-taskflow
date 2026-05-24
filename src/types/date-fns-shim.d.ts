type DateInput = Date | number | string;
type DateLike<T extends Date = Date> = T | number | string;

export type Locale = Record<string, unknown>;

export function addDays<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function addMonths<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function addQuarters<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function addWeeks<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function addYears<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function endOfMonth<DateType extends Date>(date: DateLike<DateType>): DateType;
export function endOfWeek<DateType extends Date>(
  date: DateLike<DateType>,
  options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 },
): DateType;
export function endOfYear<DateType extends Date>(date: DateLike<DateType>): DateType;
export function format(date: DateInput, formatStr: string, options?: Record<string, unknown>): string;
export function formatDistanceToNow(date: DateInput, options?: Record<string, unknown>): string;
export function getDay(date: DateInput): number;
export function isBefore(date: DateInput, dateToCompare: DateInput): boolean;
export function isSameDay(dateLeft: DateInput, dateRight: DateInput): boolean;
export function isSameMonth(dateLeft: DateInput, dateRight: DateInput): boolean;
export function isSameYear(dateLeft: DateInput, dateRight: DateInput): boolean;
export function isToday(date: DateInput): boolean;
export function isWithinInterval(
  date: DateInput,
  interval: { start: DateInput; end: DateInput },
): boolean;
export function startOfDay<DateType extends Date>(date: DateLike<DateType>): DateType;
export function startOfMonth<DateType extends Date>(date: DateLike<DateType>): DateType;
export function startOfWeek<DateType extends Date>(
  date: DateLike<DateType>,
  options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 },
): DateType;
export function startOfYear<DateType extends Date>(date: DateLike<DateType>): DateType;
export function subDays<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function subMonths<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function subWeeks<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
export function subYears<DateType extends Date>(date: DateLike<DateType>, amount: number): DateType;
