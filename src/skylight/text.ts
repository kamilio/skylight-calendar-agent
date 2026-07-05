export function terminalSafeText(value: string, preserveLayout = false): string {
  const withoutSequences = value
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u009B[0-?]*[ -/]*m/g, "");
  return preserveLayout
    ? withoutSequences.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, " ")
    : withoutSequences.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
}
