import { UserError } from "toolcraft";
import { createSDK, type CreateSDKOptions } from "toolcraft/sdk";
import { root } from "./root.js";
import { errorMessage, terminalSafeText } from "./skylight/text.js";

export { root };

function sanitizeSdkErrors<T extends object>(sdk: T): T {
  const clones = new WeakMap<object, object>();
  const wrap = (value: object): object => {
    const existing = clones.get(value);
    if (existing !== undefined) return existing;
    const clone: Record<PropertyKey, unknown> = {};
    clones.set(value, clone);
    for (const property of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      const child = descriptor.value as unknown;
      const wrapped =
        typeof child === "function"
          ? async (...args: unknown[]) => {
            try {
              return await Reflect.apply(child, value, args);
            } catch (error) {
              throw new UserError(terminalSafeText(errorMessage(error)));
            }
          }
          : typeof child === "object" && child !== null
            ? wrap(child)
            : child;
      Object.defineProperty(clone, property, {
        ...descriptor,
        value: wrapped,
      });
    }
    return clone;
  };
  return wrap(sdk) as T;
}

export function createSkylightSDK(options?: CreateSDKOptions) {
  return sanitizeSdkErrors(createSDK(root, options));
}
