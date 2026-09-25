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
      { name: "id", kind: "variable", startLine: 2, endLine: 2, qualifiedName: "User.id" },
      { name: "UserService", kind: "class", startLine: 4, endLine: 8, qualifiedName: "UserService" },
      { name: "findUser", kind: "method", startLine: 5, endLine: 7, qualifiedName: "UserService.findUser" },
      { name: "createUser", kind: "function", startLine: 9, endLine: 11, qualifiedName: "createUser" }
    ]
  );
  assert.equal(index.getSymbol("UserService.findUser")?.startLine, 5);
  assert.equal(index.getSymbol("UserService.findUser")?.parserMode, "ast");
});

test("SymbolIndex uses AST ranges for nested TypeScript declarations", () => {
  const index = new SymbolIndex();
  index.indexFile("src/nested.ts", "TypeScript", [
    "export class Outer {",
    "  private value = 1;",
    "  getValue() {",
    "    return this.value;",
    "  }",
    "  nested() {",
    "    class Inner {",
    "      run() { return true; }",
    "    }",
    "    return new Inner();",
    "  }",
    "}"
  ].join("\n"));

  assert.equal(index.getSymbol("Outer")?.parserMode, "ast");
  assert.deepEqual(
    index.getSymbols("src/nested.ts").map(({ qualifiedName, kind, startLine, endLine }) => ({ qualifiedName, kind, startLine, endLine })),
    [
      { qualifiedName: "Outer", kind: "class", startLine: 1, endLine: 12 },
      { qualifiedName: "Outer.value", kind: "variable", startLine: 2, endLine: 2 },
      { qualifiedName: "Outer.getValue", kind: "method", startLine: 3, endLine: 5 },
      { qualifiedName: "Outer.nested", kind: "method", startLine: 6, endLine: 11 },
      { qualifiedName: "Outer.Inner", kind: "class", startLine: 7, endLine: 9 },
      { qualifiedName: "Outer.Inner.run", kind: "method", startLine: 8, endLine: 8 }
    ]
  );
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
  assert.equal(index.getSymbol("Service.Create")?.parserMode, "heuristic");
  assert.equal(index.getSymbol("Service")?.kind, "struct");
  assert.equal(index.getSymbol("NewService")?.endLine, 13);
  assert.equal(index.getSymbol("DefaultName")?.kind, "constant");
  assert.equal(index.find("Service.Create").length, 1);
});

test("SymbolIndex parses Python classes, methods, and functions", () => {
  const index = new SymbolIndex();
  index.indexFile("service.py", "Python", [
    "class Service:",
    "    def create(self, name):",
    "        return name",
    "",
    "def build_service():",
    "    return Service()"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "class");
  assert.equal(index.getSymbol("Service.create")?.kind, "method");
  assert.equal(index.getSymbol("Service.create")?.endLine, 3);
  assert.equal(index.getSymbol("build_service")?.kind, "function");
});

test("SymbolIndex parses generic Go receiver methods", () => {
  const index = new SymbolIndex();
  index.indexFile("service.go", "Go", [
    "type Service[T any] struct {}",
    "func (s *Service[T]) Create(value T) {}"
  ].join("\n"));

  assert.equal(index.getSymbol("Service.Create")?.kind, "method");
});

test("SymbolIndex parses Rust declarations and impl methods", () => {
  const index = new SymbolIndex();
  index.indexFile("service.rs", "Rust", [
    "pub struct Service {",
    "  name: String,",
    "}",
    "",
    "impl Service {",
    "  pub fn create(&self) {",
    "  }",
    "}",
    "",
    "pub enum State { Ready, Busy }",
    "pub trait Runner {",
    "  fn run(&self);",
    "}"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "struct");
  assert.equal(index.getSymbol("Service.create")?.kind, "method");
  assert.equal(index.getSymbol("State")?.kind, "enum");
  assert.equal(index.getSymbol("Runner")?.kind, "interface");
});

test("SymbolIndex parses Java declarations and methods", () => {
  const index = new SymbolIndex();
  index.indexFile("Service.java", "Java", [
    "public class Service {",
    "  public String create(String name) {",
    "    return name;",
    "  }",
    "}",
    "interface Runner {",
    "  void run();",
    "}"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "class");
  assert.equal(index.getSymbol("Service.create")?.kind, "method");
  assert.equal(index.getSymbol("Runner")?.kind, "interface");
});

test("SymbolIndex parses Kotlin declarations and functions", () => {
  const index = new SymbolIndex();
  index.indexFile("Service.kt", "Kotlin", [
    "class Service {",
    "  fun create(name: String): String {",
    "    return name",
    "  }",
    "}",
    "enum class State { READY, BUSY }",
    "interface Runner {",
    "  fun run()",
    "}",
    "fun buildService(): Service = Service()"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "class");
  assert.equal(index.getSymbol("Service.create")?.kind, "method");
  assert.equal(index.getSymbol("State")?.kind, "enum");
  assert.equal(index.getSymbol("Runner")?.kind, "interface");
  assert.equal(index.getSymbol("buildService")?.kind, "function");
});

test("SymbolIndex parses CSharp declarations and methods", () => {
  const index = new SymbolIndex();
  index.indexFile("Service.cs", "CSharp", [
    "public class Service {",
    "  public string Create(string name) {",
    "    return name;",
    "  }",
    "}",
    "public interface IRunner {",
    "  void Run();",
    "}",
    "public enum State { Ready, Busy }",
    "public struct Point { public int X; }"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "class");
  assert.equal(index.getSymbol("Service.Create")?.kind, "method");
  assert.equal(index.getSymbol("IRunner")?.kind, "interface");
  assert.equal(index.getSymbol("State")?.kind, "enum");
  assert.equal(index.getSymbol("Point")?.kind, "struct");
});

test("SymbolIndex parses PHP declarations and methods", () => {
  const index = new SymbolIndex();
  index.indexFile("Service.php", "PHP", [
    "<?php",
    "class Service {",
    "  public function create(string $name): string {",
    "    return $name;",
    "  }",
    "}",
    "interface Runner {",
    "  public function run();",
    "}",
    "function build_service(): Service { return new Service(); }"
  ].join("\n"));

  assert.equal(index.getSymbol("Service")?.kind, "class");
  assert.equal(index.getSymbol("Service.create")?.kind, "method");
  assert.equal(index.getSymbol("Runner")?.kind, "interface");
  assert.equal(index.getSymbol("build_service")?.kind, "function");
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

test("SymbolIndex persists parser provenance with symbol records", () => {
  const index = new SymbolIndex();
  index.indexFile("src/service.ts", "TypeScript", "export function createService() { return true; }");
  assert.equal(index.getSymbol("createService")?.parser, "TypeScriptSymbolParser");

  const restored = new SymbolIndex();
  restored.restore(index.snapshot());
  assert.equal(restored.getSymbol("createService")?.parser, "TypeScriptSymbolParser");
});