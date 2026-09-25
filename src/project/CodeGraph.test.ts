import assert from "node:assert/strict";
import test from "node:test";

import { CodeGraph } from "./CodeGraph.ts";

test("CodeGraph preserves relationship provenance and traverses affected nodes", () => {
  const graph = new CodeGraph();
  graph.rebuild(
    [{
      from: "src/app.ts",
      to: "src/service.ts",
      kind: "import",
      sourcePath: "src/app.ts",
      resolvedPath: "src/service.ts",
      line: 4,
      provenance: "resolver",
      confidence: 0.9
    }],
    [{ qualifiedName: "Service.run", path: "src/service.ts", kind: "function" }]
  );

  const snapshot = graph.snapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.edges.some((edge) => edge.provenance === "resolver" && edge.confidence === 0.9), true);
  assert.deepEqual(
    [...new Set(graph.affectedBy(["src/app.ts"]).map((node) => node.path).filter(Boolean))].sort(),
    ["src/app.ts", "src/service.ts"]
  );
  assert.equal(graph.traverse(["src/app.ts"], { edgeKinds: ["import"], maxDepth: 1 }).some((node) => node.path === "src/service.ts"), true);
});
