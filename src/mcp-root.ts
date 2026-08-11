import type { AnySchema, Group } from "toolcraft";
import { root } from "./root.js";
import type { SkylightServices } from "./skylight/service.js";

const MCP_CONSTRAINT_KEYS = [
  "format",
  "maxItems",
  "maximum",
  "maxLength",
  "minItems",
  "minimum",
  "minLength",
  "pattern",
] as const;

function typeOnlySchema<TSchema extends AnySchema>(schema: TSchema): TSchema {
  const relaxed: Record<string, any> = { ...schema };
  for (const key of MCP_CONSTRAINT_KEYS) delete relaxed[key];

  switch (schema.kind) {
    case "array":
      relaxed.item = typeOnlySchema(schema.item);
      break;
    case "object":
      relaxed.shape = Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => [key, typeOnlySchema(value)])
      );
      break;
    case "optional":
      relaxed.inner = typeOnlySchema(schema.inner);
      break;
    case "oneOf":
      relaxed.branches = Object.fromEntries(
        Object.entries(schema.branches).map(([key, value]) => [key, typeOnlySchema(value)])
      );
      break;
    case "union":
      relaxed.branches = schema.branches.map((branch) => typeOnlySchema(branch));
      break;
    case "record":
      relaxed.value = typeOnlySchema(schema.value);
      break;
  }

  return relaxed as TSchema;
}

function typeOnlyGroup(group: Group<SkylightServices>): Group<SkylightServices> {
  return {
    ...group,
    children: group.children.map((child) =>
      child.kind === "group"
        ? typeOnlyGroup(child)
        : { ...child, params: typeOnlySchema(child.params) }
    ),
    ...(group.default === undefined
      ? {}
      : { default: { ...group.default, params: typeOnlySchema(group.default.params) } }),
  };
}

export const mcpRoot = typeOnlyGroup(root);
