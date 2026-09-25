import assert from "node:assert/strict";
import test from "node:test";

import { isProbablyBinary } from "./textFile.ts";

test("recognizes an extensionless executable header as binary", () => {
  assert.equal(isProbablyBinary(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x00, 0x00, 0x00])), true);
});

test("keeps ordinary UTF-8 text readable", () => {
  assert.equal(isProbablyBinary(Buffer.from("package main\n\nfunc main() {}\n", "utf8")), false);
});