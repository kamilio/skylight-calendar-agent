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

export function pathSegment(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) {
    throw new UserError(`${label} must not be blank.`);
  }
  return encodeURIComponent(normalized);
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
