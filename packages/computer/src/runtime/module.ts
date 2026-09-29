import type { WorkspaceModule, WorkspaceModuleDefinition } from "./types.js";

const MODULE_BRAND = Symbol.for("cloudflare.workspace.module");

// Names that parse as identifiers but cannot be declared with
// `export const <name>`, so the generated shim could not export them.
const RESERVED_WORDS = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Define a host module that isolated JavaScript imports by name.
 *
 * Install the result under a `ws:*` specifier in the JavaScript backend's
 * `trustedModules`. Each key of `exports` becomes a named export of that
 * specifier. Calling it from the isolate runs `execute` on the host with the
 * single argument the caller passed. Descriptions and schemas describe the
 * module to callers; they are not enforced.
 */
export function defineModule<const Definition extends WorkspaceModuleDefinition>(
  definition: Definition,
): WorkspaceModule & Definition {
  const names = Object.keys(definition.exports ?? {});
  if (names.length === 0) throw new Error("A Workspace module needs at least one export.");
  const exports: Record<string, unknown> = {};
  for (const name of names) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || RESERVED_WORDS.has(name)) {
      throw new Error(
        `Workspace module export name ${JSON.stringify(name)} must be a JavaScript identifier that is not a reserved word.`,
      );
    }
    const entry = definition.exports[name];
    if (typeof entry?.execute !== "function") {
      throw new Error(`Workspace module export ${JSON.stringify(name)} needs an execute function.`);
    }
    exports[name] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    ...definition,
    exports: Object.freeze(exports),
    [MODULE_BRAND]: true,
  }) as unknown as WorkspaceModule & Definition;
}

/** Whether `value` was created by {@link defineModule}. */
export function isWorkspaceModule(value: unknown): value is WorkspaceModule {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[MODULE_BRAND] === true
  );
}
