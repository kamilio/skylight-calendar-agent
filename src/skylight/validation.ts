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
    pattern: "^[^\\s@\\u0000-\\u001F\\u007F-\\u009F]+@[^\\s@\\u0000-\\u001F\\u007F-\\u009F]+$",
  });
}

export function timeParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
  });
}

export function monthDayParam(options: { description: string; short?: string }) {
  return S.String({
    ...options,
    pattern: "^(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\\d|3[01])$",
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
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})$",
  });
}

export function jsonParam(options: { description: string; short?: string }) {
  return { ...S.Json(), ...options };
}

export function parseJsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new UserError(`${label} must be valid JSON. The value was not displayed.`);
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

export function assertWellFormedUnicode(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new UserError(`${label} contains invalid Unicode.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new UserError(`${label} contains invalid Unicode.`);
    }
  }
}

export function normalizeIdentifier(value: string | number, label: string): string {
  const original = String(value);
  assertWellFormedUnicode(original, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(original)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const normalized = original.trim();
  if (normalized.length === 0) {
    throw new UserError(`${label} must not be blank.`);
  }
  return normalized;
}

export function uniqueIdentifiers(values: readonly string[], label: string): string[] {
  const normalized = values.map((value) => normalizeIdentifier(value, `${label} item`));
  if (new Set(normalized).size !== normalized.length) {
    throw new UserError(`${label} must not contain duplicates.`);
  }
  return normalized;
}

export function pathSegment(value: string | number, label: string): string {
  return encodeURIComponent(normalizeIdentifier(value, label));
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
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const trimmed = value.trim();
  const rule = trimmed.replace(/^RRULE:/i, "").trim();
  if (rule.length === 0) {
    throw new UserError(`${label} must contain a recurrence rule.`);
  }
  const components = new Map<string, string>();
  for (const component of rule.split(";")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)=([^;:\s]+)$/.exec(component);
    if (!match) {
      throw new UserError(`${label} contains an invalid recurrence component: ${JSON.stringify(component)}.`);
    }
    const name = (match[1] ?? "").toUpperCase();
    if (components.has(name)) {
      throw new UserError(`${label} must not repeat the ${name} component.`);
    }
    components.set(name, match[2] ?? "");
  }
  const frequency = components.get("FREQ");
  if (frequency === undefined) {
    throw new UserError(`${label} must include a non-empty FREQ component.`);
  }
  const allowedFrequencies = [
    "SECONDLY",
    "MINUTELY",
    "HOURLY",
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "YEARLY",
  ];
  if (!allowedFrequencies.includes(frequency.toUpperCase())) {
    throw new UserError(`${label} contains an invalid FREQ value: ${JSON.stringify(frequency)}.`);
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
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) {
    throw new UserError(`${label} must be a valid calendar date.`);
  }
}

export function assertValidMonthDay(value: string, label: string): void {
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
  const month = Number(match?.[1]);
  const day = Number(match?.[2]);
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) {
    throw new UserError(`${label} must be a valid MM/DD date.`);
  }
}

function dateOrDateTimeTimestamp(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T00:00:00Z`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return Date.parse(`${value}Z`);
  }
  return Date.parse(value);
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
    offsetHour > 14 ||
    (offsetHour === 14 && offsetMinute > 0) ||
    offsetMinute > 59 ||
    !Number.isFinite(dateOrDateTimeTimestamp(value))
  ) {
    throw new UserError(`${label} must be a valid ISO datetime or YYYY-MM-DD date.`);
  }
}

export function assertValidDateTime(value: string, label: string): void {
  if (!value.includes("T")) {
    throw new UserError(`${label} must be a valid ISO datetime.`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new UserError(`${label} must include Z or an explicit UTC offset.`);
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
  if (dateOrDateTimeTimestamp(start) > dateOrDateTimeTimestamp(end)) {
    throw new UserError(`${startLabel} must not be after ${endLabel}.`);
  }
}

export function normalizeTimezone(value: string, label = "timezone"): string {
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new UserError(`${label} must be a valid IANA timezone.`);
  }
  return normalized;
}

export function assertValidTimezone(value: string, label = "timezone"): void {
  normalizeTimezone(value, label);
}

export function normalizeAbsoluteUrl(
  value: string,
  label: string,
  allowedProtocols?: ReadonlyArray<string>
): string {
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
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
  if (url.username.length > 0 || url.password.length > 0) {
    throw new UserError(`${label} must not include embedded username or password credentials.`);
  }
  return normalized;
}

export function assertValidAbsoluteUrl(
  value: string,
  label: string,
  allowedProtocols?: ReadonlyArray<string>
): void {
  normalizeAbsoluteUrl(value, label, allowedProtocols);
}
