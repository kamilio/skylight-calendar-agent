import { createSDK, type CreateSDKOptions } from "toolcraft/sdk";
import { root } from "./root.js";

export { root };

export function createSkylightSDK(options?: CreateSDKOptions) {
  return createSDK(root, options);
}
