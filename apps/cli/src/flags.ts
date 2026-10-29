import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { JsonSchema, Tool } from "./store.js";

/**
 * A tool's command line, read against that tool's input schema: every
 * property is a flag in kebab case (`--job-id`, and `--job_id` works too).
 * Strings, numbers and enums take a value; a boolean is a bare flag, or
 * `--no-<flag>`; a list repeats its flag or takes a JSON array; an object,
 * or a list of objects, takes JSON. `--input` gives the whole argument object
 * as JSON (inline, `@file.json`, or `-` for stdin) and flags override it.
 *
 * Two shortcuts the chat connector cannot offer: `--<name>-file <path>` reads
 * a local file into the property `<name>_base64` (base64) or `<name>` (text),
 * and for add_file the filename and content type default from the path.
 */

export class UsageError extends Error {}

/** tats's own flags, never a tool's. */
export const GLOBAL_FLAGS = { boolean: ["json", "yes", "help", "refresh"], value: ["input", "url", "jq"] } as const;

export type Parsed = {
  positionals: string[];
  /** In order, as given; value null for a bare flag. */
  flags: { name: string; value: string | null }[];
};

/** Splits argv without knowing any schema: `--a=b`, `--a b`, `--a`, `-h`, `--` ends flags. */
export function parseArgv(argv: string[], isBoolean: (name: string) => boolean): Parsed {
  const out: Parsed = { positionals: [], flags: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h" || arg === "-y") {
      out.flags.push({ name: arg === "-h" ? "help" : "yes", value: null });
      continue;
    }
    if (!arg.startsWith("--") || arg === "--") {
      out.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = normalize(eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    if (eq !== -1) {
      out.flags.push({ name, value: arg.slice(eq + 1) });
      continue;
    }
    const next = argv[i + 1];
    const takesValue = !isBoolean(name) && next !== undefined && !(next.startsWith("--") && next.length > 2);
    // A boolean takes an explicit true/false after it, nothing else.
    const booleanValue = isBoolean(name) && (next === "true" || next === "false");
    if (takesValue || booleanValue) {
      out.flags.push({ name, value: next! });
      i++;
    } else {
      out.flags.push({ name, value: null });
    }
  }
  return out;
}

/** Flag spelling to property spelling: kebab and snake are the same flag. */
export const normalize = (flag: string) => flag.replace(/-/g, "_");
export const flagName = (prop: string) => "--" + prop.replace(/_/g, "-");

/** The schema without its null branch, and whether null is allowed. */
export function unwrap(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const rest = variants.filter((v) => v.type !== "null");
    const nullable = rest.length < variants.length;
    if (rest.length === 1) return { schema: { ...rest[0], description: schema.description ?? rest[0]!.description }, nullable };
    return { schema, nullable };
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t) => t !== "null");
    return { schema: { ...schema, type: types.length === 1 ? types[0] : types }, nullable: types.length < schema.type.length };
  }
  return { schema, nullable: false };
}

export type Kind = "string" | "number" | "integer" | "boolean" | "list" | "json";

export function kindOf(raw: JsonSchema): Kind {
  const { schema } = unwrap(raw);
  if (schema.type === "array") {
    const item = schema.items ? unwrap(schema.items).schema : {};
    return item.type === "object" || item.type === "array" || item.anyOf || item.oneOf ? "json" : "list";
  }
  if (schema.type === "object" || Array.isArray(schema.type) || schema.anyOf || schema.oneOf) return "json";
  if (schema.type === "boolean" || schema.type === "number" || schema.type === "integer") return schema.type;
  if (schema.const !== undefined && typeof schema.const === "boolean") return "boolean";
  return "string";
}

function scalar(prop: string, schema: JsonSchema, value: string): unknown {
  const { schema: s, nullable } = unwrap(schema);
  const flag = flagName(prop);
  if (nullable && value === "null") return null;
  const type = s.type === "array" && s.items ? unwrap(s.items).schema.type : s.type;
  if (type === "number" || type === "integer") {
    const n = Number(value);
    if (value.trim() === "" || Number.isNaN(n) || (type === "integer" && !Number.isInteger(n))) {
      throw new UsageError(`${flag} takes a${type === "integer" ? " whole" : ""} number, not "${value}".`);
    }
    return n;
  }
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new UsageError(`${flag} is true or false, not "${value}".`);
  }
  const allowed = s.type === "array" && s.items ? unwrap(s.items).schema.enum : s.enum;
  if (allowed && !allowed.includes(value)) throw new UsageError(`${flag} is one of ${allowed.join(", ")}; not "${value}".`);
  return value;
}

function json(prop: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new UsageError(`${flagName(prop)} takes JSON, e.g. ${flagName(prop)} '[{"name": "..."}]'.`);
  }
}

function allowsString(schema: JsonSchema): boolean {
  if (schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string"))) return true;
  return (schema.anyOf ?? schema.oneOf ?? []).some(allowsString);
}

function jsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export type ArgsDeps = { readFile: (path: string) => Promise<Buffer>; readStdin: () => Promise<string> };

export const realArgsDeps: ArgsDeps = {
  readFile: (path) => readFile(path),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  },
};

async function inputObject(value: string, deps: ArgsDeps): Promise<Record<string, unknown>> {
  const text = value === "-" ? await deps.readStdin() : value.startsWith("@") ? (await deps.readFile(value.slice(1))).toString("utf8") : value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError("--input takes a JSON object: inline, @file.json, or - for stdin.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UsageError("--input takes a JSON object.");
  return parsed as Record<string, unknown>;
}

/**
 * The tool's arguments from the parsed flags. Global flags are skipped;
 * anything the schema does not name is a UsageError listing what it does.
 */
export async function toolArguments(tool: Tool, parsed: Parsed, deps: ArgsDeps = realArgsDeps): Promise<Record<string, unknown>> {
  const props = tool.inputSchema?.properties ?? {};
  const globals = new Set<string>([...GLOBAL_FLAGS.boolean, ...GLOBAL_FLAGS.value]);
  const input = [...parsed.flags].reverse().find((f) => f.name === "input");
  const args: Record<string, unknown> = input?.value ? await inputObject(input.value, deps) : {};
  const lists = new Map<string, unknown[]>();

  for (const { name, value } of parsed.flags) {
    if (globals.has(name)) continue;
    if (name.startsWith("no_") && props[name.slice(3)] && kindOf(props[name.slice(3)]!) === "boolean" && value === null) {
      args[name.slice(3)] = false;
      continue;
    }
    if (name.endsWith("_file") && !props[name]) {
      const stem = name.slice(0, -"_file".length);
      const target = props[`${stem}_base64`] ? `${stem}_base64` : props[stem] && kindOf(props[stem]!) === "string" ? stem : null;
      if (!target) throw unknownFlag(tool, name);
      if (value === null) throw new UsageError(`${flagName(name)} takes a path.`);
      const bytes = await deps.readFile(value).catch(() => {
        throw new UsageError(`Could not read ${value}.`);
      });
      args[target] = target.endsWith("_base64") ? bytes.toString("base64") : bytes.toString("utf8");
      // add_file: the name and type follow from the file unless given.
      if (target === "content_base64") {
        if (props.filename && args.filename === undefined) args.filename = basename(value);
        const type = CONTENT_TYPES[extname(value).toLowerCase()];
        if (props.content_type && args.content_type === undefined && type) args.content_type = type;
      }
      continue;
    }
    const schema = props[name];
    if (!schema) throw unknownFlag(tool, name);
    const kind = kindOf(schema);
    if (kind === "boolean") {
      args[name] = value === null ? true : scalar(name, schema, value);
      continue;
    }
    if (value === null) throw new UsageError(`${flagName(name)} needs a value.`);
    if (kind === "json") {
      // A value that may be plain text (set_custom_field's) need not be quoted as JSON.
      args[name] = unwrap(schema).nullable && value === "null" ? null : allowsString(schema) ? jsonOrText(value) : json(name, value);
    } else if (kind === "list") {
      if (value.trim().startsWith("[")) {
        args[name] = json(name, value);
        lists.delete(name);
      } else {
        const list = lists.get(name) ?? [];
        list.push(scalar(name, schema, value));
        lists.set(name, list);
        args[name] = list;
      }
    } else {
      args[name] = scalar(name, schema, value);
    }
  }

  const missing = (tool.inputSchema?.required ?? []).filter((p) => args[p] === undefined);
  if (missing.length) throw new UsageError(`${tool.name} needs ${missing.map(flagName).join(", ")}. See: tats help ${tool.name}`);
  return args;
}

function unknownFlag(tool: Tool, name: string): UsageError {
  const props = Object.keys(tool.inputSchema?.properties ?? {});
  const known = props.length ? `It takes ${props.map(flagName).join(", ")}.` : "It takes no flags.";
  return new UsageError(`${tool.name} has no ${flagName(name)}. ${known}`);
}

/** Whether a flag is a bare switch, for the argv split: tats's own, or a boolean property of the tool. */
export function booleanFlags(tool: Tool | null): (name: string) => boolean {
  const props = tool?.inputSchema?.properties ?? {};
  return (name) =>
    (GLOBAL_FLAGS.boolean as readonly string[]).includes(name) ||
    (props[name] !== undefined && kindOf(props[name]) === "boolean") ||
    (name.startsWith("no_") && props[name.slice(3)] !== undefined && kindOf(props[name.slice(3)]!) === "boolean");
}

/** One line per flag for `tats help <tool>`. */
export function describeFlags(tool: Tool): string[] {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  return Object.entries(props).map(([prop, raw]) => {
    const { schema, nullable } = unwrap(raw);
    const kind = kindOf(raw);
    const item = schema.type === "array" && schema.items ? unwrap(schema.items).schema : null;
    const values = schema.enum ?? item?.enum;
    const shape =
      kind === "boolean" ? "" :
      kind === "json" ? " <json>" :
      values ? ` <${values.join("|")}>` :
      kind === "list" ? ` <${item?.type ?? "value"}> (repeatable)` :
      ` <${kind === "integer" ? "number" : kind}>`;
    const tags = [required.has(prop) ? "required" : null, nullable ? "null clears" : null].filter(Boolean);
    const head = `  ${flagName(prop)}${shape}${tags.length ? `  [${tags.join(", ")}]` : ""}`;
    const extra = prop.endsWith("_base64") ? `\n      or ${flagName(prop.slice(0, -"_base64".length))}-file <path>` : "";
    return schema.description ? `${head}\n      ${schema.description}${extra}` : head + extra;
  });
}
