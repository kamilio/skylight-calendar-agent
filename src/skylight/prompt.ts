import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { UserError } from "toolcraft";

export async function promptLine(label: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserError(`${label.replace(/:\s*$/, "")} must be provided in a terminal session.`);
  }
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding, callback);
      else callback();
    },
  });
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  try {
    if (!secret) return await readline.question(label);
    process.stdout.write(label);
    muted = true;
    const value = await readline.question("");
    muted = false;
    process.stdout.write("\n");
    return value;
  } finally {
    muted = false;
    readline.close();
  }
}
