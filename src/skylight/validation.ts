import { S, UserError } from "toolcraft";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export function dateParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    format: "date",
    pattern: DATE_PATTERN,
  });
}

export function nonBlankParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    minLength: 1,
    pattern: "\\S",
  });
}

export function emailParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    format: "email",
    minLength: 3,
    pattern: "^[^\\s@]+@[^\\s@]+$",
  });
}

export function timeParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
  });
}

export function dateOrDateTimeParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern:
      "^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})?)?$",
  });
}

export function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(`${label} must be valid JSON: ${detail}`);
  }
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonValue(value, label);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new UserError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseNonEmptyJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonObject(value, label);
  if (Object.keys(parsed).length === 0) {
    throw new UserError(`${label} must contain at least one field.`);
  }
  return parsed;
}

export function pathSegment(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) {
    throw new UserError(`${label} must not be blank.`);
  }
  return encodeURIComponent(normalized);
}

export function assertAtLeastOneDefined(
  values: ReadonlyArray<unknown>,
  message: string
): void {
  if (values.every((value) => value === undefined)) {
    throw new UserError(message);
  }
}

export function positiveIntegerStringParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern: "^[1-9]\\d*$",
  });
}

export function parsePositiveSafeInteger(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new UserError(`${label} must be a positive safe integer.`);
  }
  return number;
}

export function assertValidDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new UserError(`${label} must use YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new UserError(`${label} must be a valid calendar date.`);
  }
}

export function assertValidDateRange(
  minimum: string | undefined,
  maximum: string | undefined,
  minimumLabel: string,
  maximumLabel: string
): void {
  if (minimum !== undefined) assertValidDate(minimum, minimumLabel);
  if (maximum !== undefined) assertValidDate(maximum, maximumLabel);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new UserError(`${minimumLabel} must not be after ${maximumLabel}.`);
  }
}

export function assertValidDateOrDateTime(value: string, label: string): void {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    assertValidDate(value, label);
    return;
  }
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))?$/.exec(
      value
    );
  if (!match) {
    throw new UserError(`${label} must be a valid ISO datetime or YYYY-MM-DD date.`);
  }
  assertValidDate(match[1] ?? "", label);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] === undefined ? 0 : Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new UserError(`${label} must be a valid ISO datetime or YYYY-MM-DD date.`);
  }
}

export function assertValidDateOrDateTimeRange(
  start: string,
  end: string | undefined,
  startLabel: string,
  endLabel: string
): void {
  assertValidDateOrDateTime(start, startLabel);
  if (end === undefined) return;
  assertValidDateOrDateTime(end, endLabel);
  if (Date.parse(start) > Date.parse(end)) {
    throw new UserError(`${startLabel} must not be after ${endLabel}.`);
  }
}

export function assertValidTimezone(value: string, label = "timezone"): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new UserError(`${label} must be a valid IANA timezone.`);
  }
}
