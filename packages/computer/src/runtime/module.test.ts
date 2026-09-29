import { describe, expect, it } from "vitest";

import { defineModule, isWorkspaceModule } from "./module.js";

describe("defineModule", () => {
  it("returns a frozen module that keeps descriptions and schemas", () => {
    const input = { type: "object", properties: { title: { type: "string" } } };
    const module = defineModule({
      description: "Issues",
      exports: {
        createIssue: { description: "Open an issue", input, execute: () => null },
      },
    });
    expect(isWorkspaceModule(module)).toBe(true);
    expect(module.description).toBe("Issues");
    expect(module.exports.createIssue.description).toBe("Open an issue");
    expect(module.exports.createIssue.input).toBe(input);
    expect(Object.isFrozen(module)).toBe(true);
    expect(Object.isFrozen(module.exports)).toBe(true);
  });

  it("does not treat call-style trusted modules as defined modules", () => {
    expect(isWorkspaceModule({ call: async () => null })).toBe(false);
    expect(isWorkspaceModule({ exports: { run: { execute: () => null } } })).toBe(false);
  });

  it("rejects export names that cannot be imported by name", () => {
    for (const name of ["default", "has-dash", "1st", "class", "await", ""]) {
      expect(() => defineModule({ exports: { [name]: { execute: () => null } } })).toThrow(
        /export name/,
      );
    }
  });

  it("rejects exports without an execute function", () => {
    expect(() => defineModule({ exports: { run: {} as never } })).toThrow(/execute/);
  });

  it("rejects a module with no exports", () => {
    expect(() => defineModule({ exports: {} })).toThrow(/at least one export/);
  });
});
