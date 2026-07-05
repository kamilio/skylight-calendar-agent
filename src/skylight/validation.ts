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

export function dateTimeParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern:
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})?$",
  });
}

export function jsonParam(options: { description: string; short?: string }) {
  return { ...S.Json(), ...options };
}

export function parseJsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(`${label} must be valid JSON: ${detail}`);
  }
}

export function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseJsonValue(value, label);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new UserError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonContainer(
  value: unknown,
  label: string
): Record<string, unknown> | unknown[] {
  const parsed = parseJsonValue(value, label);
  if (parsed === null || typeof parsed !== "object") {
    throw new UserError(`${label} must be a JSON array or object.`);
  }
  return parsed as Record<string, unknown> | unknown[];
}

export function parseNonEmptyJsonObject(value: unknown, label: string): Record<string, unknown> {
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

export function normalizeRrule(value: string, label = "rrule"): string {
  const trimmed = value.trim();
  const rule = trimmed.replace(/^RRULE:/i, "").trim();
  if (rule.length === 0) {
    throw new UserError(`${label} must contain a recurrence rule.`);
  }
  return `RRULE:${rule}`;
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

export function assertValidDateTime(value: string, label: string): void {
  if (!value.includes("T")) {
    throw new UserError(`${label} must be a valid ISO datetime.`);
  }
  assertValidDateOrDateTime(value, label);
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

export function assertValidAbsoluteUrl(
  value: string,
  label: string,
  allowedProtocols?: ReadonlyArray<string>
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserError(`${label} must be a valid absolute URL.`);
  }
  if (allowedProtocols !== undefined && !allowedProtocols.includes(url.protocol)) {
    throw new UserError(
      `${label} must use ${allowedProtocols.map((protocol) => protocol.slice(0, -1)).join(" or ")}.`
    );
  }
  if (
    allowedProtocols === undefined &&
    ["data:", "file:", "javascript:"].includes(url.protocol)
  ) {
    throw new UserError(`${label} must not use the ${url.protocol.slice(0, -1)} scheme.`);
  }
}
