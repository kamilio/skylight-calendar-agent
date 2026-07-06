export function terminalSafeText(value: string, preserveLayout = false): string {
  const withoutSequences = value
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u009B[0-?]*[ -/]*m/g, "")
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u206F]/g, " ");
  return preserveLayout
    ? withoutSequences.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, " ")
    : withoutSequences.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
}

export function truncateText(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  let end = maximumLength;
  const finalCode = value.charCodeAt(end - 1);
  const nextCode = value.charCodeAt(end);
  if (
    finalCode >= 0xd800 &&
    finalCode <= 0xdbff &&
    nextCode >= 0xdc00 &&
    nextCode <= 0xdfff
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}
