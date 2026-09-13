import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { containsExecutableSymbolReference } from "./dependencyReference.ts";
import { DependencyDetector } from "./DependencyDetector.ts";

describe("dependency reference matching", () => {
  it("accepts calls and type usage", () => {
    const content = `
      import { Client } from "./client";
      const client = new Client();
      client.Connect();
    `;

    assert.equal(containsExecutableSymbolReference(content, "Client"), true);
    assert.equal(containsExecutableSymbolReference(content, "Connect"), true);
  });

  it("ignores comments, imports, and string mentions", () => {
    const content = `
      import { Client } from "./client";
      // Client();
      const label = "Client";
    `;

    assert.equal(containsExecutableSymbolReference(content, "Client"), false);
  });
});

describe("DependencyDetector", () => {
  it("detects single-line and block Go imports", () => {
    const detector = new DependencyDetector();
    const content = `
      package main
      import "fmt"
      import (
        "os"
        "net/http"
      )
    `;

    const deps = detector.detect("cmd/main.go", content);
    const targets = deps.map((d) => d.target);

    assert.ok(targets.includes("fmt"));
    assert.ok(targets.includes("os"));
    assert.ok(targets.includes("net/http"));
  });

  it("detects JS/TS ESM re-exports and dynamic imports", () => {
    const detector = new DependencyDetector();
    const content = `
      import { foo } from "./foo";
      export * from "./bar";
      const lazy = import("./lazy");
    `;

    const deps = detector.detect("src/index.ts", content);
    const targets = deps.map((d) => d.target);

    assert.ok(targets.includes("./foo"));
    assert.ok(targets.includes("./bar"));
    assert.ok(targets.includes("./lazy"));
  });
});