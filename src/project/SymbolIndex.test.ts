import assert from "node:assert/strict";
import test from "node:test";

import { SymbolIndex } from "./SymbolIndex.ts";

test("SymbolIndex parses TypeScript declarations and method ranges", () => {
  const index = new SymbolIndex();
  index.indexFile("src/service.ts", "TypeScript", [
    "export interface User {",
    "  id: string;",
    "}",
    "export class UserService {",
    "  async findUser(id: string) {",
    "    return id;",
    "  }",
    "}",
    "export function createUser() {",
    "  return new UserService();",
    "}"
  ].join("\n"));

  assert.deepEqual(
    index.getSymbols("src/service.ts").map(({ name, kind, startLine, endLine, qualifiedName }) => ({ name, kind, startLine, endLine, qualifiedName })),
    [
      { name: "User", kind: "interface", startLine: 1, endLine: 3, qualifiedName: "User" },
      { name: "UserService", kind: "class", startLine: 4, endLine: 8, qualifiedName: "UserService" },
      { name: "findUser", kind: "method", startLine: 5, endLine: 7, qualifiedName: "UserService.findUser" },
      { name: "createUser", kind: "function", startLine: 9, endLine: 11, qualifiedName: "createUser" }
    ]
  );
  assert.equal(index.getSymbol("UserService.findUser")?.startLine, 5);
});

test("SymbolIndex parses Go functions, methods, structs, and variables", () => {
  const index = new SymbolIndex();
  index.indexFile("service.go", "Go", [
    "package service",
    "",
    "type Service struct {",
    "  Name string",
    "}",
    "",
    "func (s *Service) Create() {",
    "  println(s.Name)",
    "}",
    "",
    "func NewService() *Service {",
    "  return &Service{}",
    "}",
    "",
    "const DefaultName = \"mm3\""
  ].join("\n"));

  assert.equal(index.getSymbol("Service.Create")?.kind, "method");
  assert.equal(index.getSymbol("Service")?.kind, "struct");
  assert.equal(index.getSymbol("NewService")?.endLine, 13);
  assert.equal(index.getSymbol("DefaultName")?.kind, "constant");
  assert.equal(index.find("Service.Create").length, 1);
});

test("SymbolIndex replaces and removes file records", () => {
  const index = new SymbolIndex();
  index.indexFile("src/value.ts", "TypeScript", "export const before = 1;");
  assert.equal(index.getSymbol("before")?.path, "src/value.ts");

  index.indexFile("src/value.ts", "TypeScript", "export const after = 2;");
  assert.equal(index.getSymbol("before"), undefined);
  assert.equal(index.getSymbol("after")?.path, "src/value.ts");

  index.removeFile("src/value.ts");
  assert.equal(index.getSymbols().length, 0);
});