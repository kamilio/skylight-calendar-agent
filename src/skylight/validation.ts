import { S, UserError } from "toolcraft";
import { terminalSafeText, truncateText } from "./text.js";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const MAX_REQUEST_JSON_DEPTH = 100;
const MAX_RRULE_INTEGER = 2_147_483_647;
const RRULE_COMPONENTS = new Set([
  "FREQ",
  "UNTIL",
  "COUNT",
  "INTERVAL",
  "BYSECOND",
  "BYMINUTE",
  "BYHOUR",
  "BYDAY",
  "BYMONTHDAY",
  "BYYEARDAY",
  "BYWEEKNO",
  "BYMONTH",
  "BYSETPOS",
  "WKST",
]);

function displayErrorValue(value: string): string {
  const safe = terminalSafeText(value);
  return safe.length <= 200 ? safe : `${truncateText(safe, 200)}…`;
}

function appendJsonPath(label: string, suffix: string): string {
  const path = `${label}${suffix}`;
  return path.length <= 500 ? path : `${truncateText(path, 500)}…`;
}

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
      "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
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
  try {
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new UserError(`${label} must be a JSON object.`);
    }
    const prototype = Object.getPrototypeOf(parsed);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UserError(`${label} must be a JSON object.`);
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`${label} could not be inspected as JSON.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonContainer(
  value: unknown,
  label: string
): Record<string, unknown> | unknown[] {
  const parsed = parseJsonValue(value, label);
  try {
    if (parsed === null || typeof parsed !== "object") {
      throw new UserError(`${label} must be a JSON array or object.`);
    }
    if (!Array.isArray(parsed)) {
      const prototype = Object.getPrototypeOf(parsed);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new UserError(`${label} must be a JSON array or object.`);
      }
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`${label} could not be inspected as JSON.`);
  }
  return parsed as Record<string, unknown> | unknown[];
}

export function parseNonEmptyJsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = parseJsonObject(value, label);
  try {
    if (Object.keys(parsed).length === 0) {
      throw new UserError(`${label} must contain at least one field.`);
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`${label} could not be inspected as JSON.`);
  }
  return parsed;
}

function jsonCompatibleSnapshot(
  value: unknown,
  label: string,
  active = new WeakSet<object>(),
  visited = new WeakMap<object, unknown>(),
  depth = 0
): unknown {
  if (depth > MAX_REQUEST_JSON_DEPTH) {
    throw new UserError(
      `JSON input exceeds the maximum nesting depth of ${MAX_REQUEST_JSON_DEPTH}.`
    );
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value, label);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UserError(`${label} contains a non-finite number.`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new UserError(`${label} contains an unsafe integer; use a string to preserve it exactly.`);
    }
    return value;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new UserError(`${label} contains a non-JSON value.`);
  }
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) {
    throw new UserError(`${label} contains a circular reference.`);
  }
  if (visited.has(value)) return visited.get(value);

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        !Number.isInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 4_294_967_295
      ) {
        throw new UserError(`${label} contains a non-JSON array property.`);
      }
      const length = lengthDescriptor.value as number;
      const ownKeys = Reflect.ownKeys(value);
      const indexes = new Set<number>();
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9]\d*)$/.test(key) ||
          Number(key) >= length
        ) {
          throw new UserError(`${label} contains a non-JSON array property.`);
        }
        indexes.add(Number(key));
      }
      if (indexes.size !== length) {
        let missingIndex = 0;
        while (indexes.has(missingIndex)) missingIndex += 1;
        throw new UserError(`${label} contains a sparse array entry at index ${missingIndex}.`);
      }
      const snapshot: unknown[] = new Array(length);
      visited.set(value, snapshot);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new UserError(`${label} contains a non-JSON accessor at index ${index}.`);
        }
        snapshot[index] = jsonCompatibleSnapshot(
          descriptor.value,
          appendJsonPath(label, `[${index}]`),
          active,
          visited,
          depth + 1
        );
      }
      return snapshot;
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new UserError(`${label} contains a non-JSON object.`);
      }
      const snapshot: Record<string, unknown> = {};
      visited.set(value, snapshot);
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          throw new UserError(`${label} contains a non-JSON symbol property.`);
        }
        assertWellFormedUnicode(key, `${label} property name`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        const displayKey = JSON.stringify(displayErrorValue(key));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new UserError(`${label} contains a non-JSON property ${displayKey}.`);
        }
        Object.defineProperty(snapshot, key, {
          value: jsonCompatibleSnapshot(
            descriptor.value,
            appendJsonPath(label, `.${displayKey}`),
            active,
            visited,
            depth + 1
          ),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return snapshot;
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`${label} could not be inspected as JSON.`);
  } finally {
    active.delete(value);
  }
}

export function snapshotJsonCompatible(value: unknown, label: string): unknown {
  return jsonCompatibleSnapshot(value, label);
}

export function assertJsonCompatible(value: unknown, label: string): void {
  snapshotJsonCompatible(value, label);
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
      throw new UserError(
        `${label} contains an invalid recurrence component: ${JSON.stringify(displayErrorValue(component))}.`
      );
    }
    const name = (match[1] ?? "").toUpperCase();
    if (!RRULE_COMPONENTS.has(name)) {
      throw new UserError(
        `${label} contains an unsupported recurrence component: ${JSON.stringify(displayErrorValue(name))}.`
      );
    }
    if (components.has(name)) {
      throw new UserError(
        `${label} must not repeat the ${displayErrorValue(name)} component.`
      );
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
    throw new UserError(
      `${label} contains an invalid FREQ value: ${JSON.stringify(displayErrorValue(frequency))}.`
    );
  }
  const integerList = (
    name: string,
    minimum: number,
    maximum: number,
    allowZero: boolean
  ): void => {
    const componentValue = components.get(name);
    if (componentValue === undefined) return;
    const values = componentValue.split(",");
    const valid = values.every((item) => {
      if (!/^[+-]?\d+$/.test(item)) return false;
      const number = Number(item);
      return (
        Number.isSafeInteger(number) &&
        number >= minimum &&
        number <= maximum &&
        (allowZero || number !== 0)
      );
    });
    if (!valid) {
      throw new UserError(
        `${label} contains an invalid ${name} value: ${JSON.stringify(displayErrorValue(componentValue))}.`
      );
    }
  };
  for (const name of ["COUNT", "INTERVAL"]) {
    const componentValue = components.get(name);
    if (
      componentValue !== undefined &&
      (!/^[1-9]\d*$/.test(componentValue) ||
        !Number.isSafeInteger(Number(componentValue)) ||
        Number(componentValue) > MAX_RRULE_INTEGER)
    ) {
      throw new UserError(
        `${label} contains an invalid ${name} value: ${JSON.stringify(displayErrorValue(componentValue))}.`
      );
    }
  }
  if (components.has("COUNT") && components.has("UNTIL")) {
    throw new UserError(`${label} must not include both COUNT and UNTIL.`);
  }
  integerList("BYSECOND", 0, 60, true);
  integerList("BYMINUTE", 0, 59, true);
  integerList("BYHOUR", 0, 23, true);
  integerList("BYMONTHDAY", -31, 31, false);
  integerList("BYYEARDAY", -366, 366, false);
  integerList("BYWEEKNO", -53, 53, false);
  integerList("BYMONTH", 1, 12, false);
  integerList("BYSETPOS", -366, 366, false);

  const byDay = components.get("BYDAY");
  if (
    byDay !== undefined &&
    !byDay
      .split(",")
      .every((item) => /^(?:[+-]?(?:[1-9]|[1-4]\d|5[0-3]))?(?:MO|TU|WE|TH|FR|SA|SU)$/i.test(item))
  ) {
    throw new UserError(
      `${label} contains an invalid BYDAY value: ${JSON.stringify(displayErrorValue(byDay))}.`
    );
  }

  const weekStart = components.get("WKST");
  if (weekStart !== undefined && !/^(?:MO|TU|WE|TH|FR|SA|SU)$/i.test(weekStart)) {
    throw new UserError(
      `${label} contains an invalid WKST value: ${JSON.stringify(displayErrorValue(weekStart))}.`
    );
  }

  const until = components.get("UNTIL");
  if (until !== undefined) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/i.exec(until);
    if (match === null) {
      throw new UserError(
        `${label} contains an invalid UNTIL value: ${JSON.stringify(displayErrorValue(until))}.`
      );
    }
    try {
      assertValidDate(`${match[1]}-${match[2]}-${match[3]}`, `${label} UNTIL`);
    } catch {
      throw new UserError(
        `${label} contains an invalid UNTIL value: ${JSON.stringify(displayErrorValue(until))}.`
      );
    }
    if (match[4] !== undefined) {
      try {
        assertValidDateTime(
          `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
          `${label} UNTIL`
        );
      } catch {
        throw new UserError(
          `${label} contains an invalid UNTIL value: ${JSON.stringify(displayErrorValue(until))}.`
        );
      }
    }
  }

  const normalizedFrequency = frequency.toUpperCase();
  if (components.has("BYWEEKNO") && normalizedFrequency !== "YEARLY") {
    throw new UserError(`${label} may only use BYWEEKNO with FREQ=YEARLY.`);
  }
  if (
    components.has("BYYEARDAY") &&
    ["DAILY", "WEEKLY", "MONTHLY"].includes(normalizedFrequency)
  ) {
    throw new UserError(
      `${label} must not use BYYEARDAY with FREQ=${normalizedFrequency}.`
    );
  }
  if (components.has("BYMONTHDAY") && normalizedFrequency === "WEEKLY") {
    throw new UserError(`${label} must not use BYMONTHDAY with FREQ=WEEKLY.`);
  }
  const hasNumericByDay = byDay
    ?.split(",")
    .some((item) => /^[+-]?\d/.test(item));
  if (
    hasNumericByDay === true &&
    !["MONTHLY", "YEARLY"].includes(normalizedFrequency)
  ) {
    throw new UserError(
      `${label} may only use numeric BYDAY values with FREQ=MONTHLY or FREQ=YEARLY.`
    );
  }
  if (
    hasNumericByDay === true &&
    normalizedFrequency === "YEARLY" &&
    components.has("BYWEEKNO")
  ) {
    throw new UserError(
      `${label} must not combine numeric BYDAY values with BYWEEKNO in a yearly rule.`
    );
  }
  if (
    components.has("BYSETPOS") &&
    ![...components.keys()].some((name) => name.startsWith("BY") && name !== "BYSETPOS")
  ) {
    throw new UserError(`${label} must use BYSETPOS with another BY rule component.`);
  }

  const uppercaseValues = new Set(["FREQ", "BYDAY", "WKST", "UNTIL"]);
  const normalizedRule = [
    ["FREQ", frequency] as const,
    ...[...components].filter(([name]) => name !== "FREQ"),
  ]
    .map(([name, componentValue]) =>
      `${name}=${uppercaseValues.has(name) ? componentValue.toUpperCase() : componentValue}`
    )
    .join(";");
  return `RRULE:${normalizedRule}`;
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

function dateOrDateTimeOrder(value: string): { seconds: number; fraction: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { seconds: Date.parse(`${value}T00:00:00Z`) / 1_000, fraction: "" };
  }
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const leapSecond = /:60(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value);
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  const wholeSecondValue = value.replace(/\.\d+/, "");
  const parseable = leapSecond
    ? wholeSecondValue.replace(/:60(?=(?:Z|[+-]\d{2}:\d{2})?$)/, ":59")
    : wholeSecondValue;
  const timestamp = Date.parse(hasOffset ? parseable : `${parseable}Z`);
  return {
    seconds: timestamp / 1_000 + (leapSecond ? 1 : 0),
    fraction,
  };
}

function compareDateOrDateTime(left: string, right: string): number {
  const leftOrder = dateOrDateTimeOrder(left);
  const rightOrder = dateOrDateTimeOrder(right);
  if (leftOrder.seconds !== rightOrder.seconds) {
    return leftOrder.seconds < rightOrder.seconds ? -1 : 1;
  }
  const length = Math.max(leftOrder.fraction.length, rightOrder.fraction.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = leftOrder.fraction.charCodeAt(index) || 48;
    const rightDigit = rightOrder.fraction.charCodeAt(index) || 48;
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
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
    second > 60 ||
    offsetHour > 14 ||
    (offsetHour === 14 && offsetMinute > 0) ||
    offsetMinute > 59 ||
    !Number.isFinite(dateOrDateTimeOrder(value).seconds)
  ) {
    throw new UserError(`${label} must be a valid ISO datetime or YYYY-MM-DD date.`);
  }
  if (second === 60) {
    const leapSecondEnd = new Date(dateOrDateTimeOrder(value).seconds * 1_000);
    if (
      leapSecondEnd.getUTCDate() !== 1 ||
      leapSecondEnd.getUTCHours() !== 0 ||
      leapSecondEnd.getUTCMinutes() !== 0 ||
      leapSecondEnd.getUTCSeconds() !== 0
    ) {
      throw new UserError(`${label} must be a valid ISO datetime or YYYY-MM-DD date.`);
    }
  }
}

export function assertValidDateTime(value: string, label: string): void {
  if (!/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new UserError(`${label} must be a valid RFC3339 datetime with seconds.`);
  }
  assertValidDateOrDateTime(value, label);
}

export function assertValidDateTimeRange(
  minimum: string,
  maximum: string,
  minimumLabel: string,
  maximumLabel: string
): void {
  assertValidDateTime(minimum, minimumLabel);
  assertValidDateTime(maximum, maximumLabel);
  if (compareDateOrDateTime(minimum, maximum) > 0) {
    throw new UserError(`${minimumLabel} must not be after ${maximumLabel}.`);
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
  if (compareDateOrDateTime(start, end) > 0) {
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
    return new Intl.DateTimeFormat("en-US", {
      timeZone: normalized,
    }).resolvedOptions().timeZone;
  } catch {
    throw new UserError(`${label} must be a valid IANA timezone.`);
  }
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
  return url.toString();
}

export function assertValidAbsoluteUrl(
  value: string,
  label: string,
  allowedProtocols?: ReadonlyArray<string>
): void {
  normalizeAbsoluteUrl(value, label, allowedProtocols);
}
