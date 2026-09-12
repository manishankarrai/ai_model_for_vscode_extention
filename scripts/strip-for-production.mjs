import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC_ROOT = path.resolve("src");

const LOG_METHODS = new Set(["info", "warn", "error", "flow", "show"]);

function isDebugCall(node, sourceFile) {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const expr = node.expression;
  if (ts.isIdentifier(expr) && expr.text === "flow") {
    return true;
  }

  if (!ts.isPropertyAccessExpression(expr)) {
    return false;
  }

  if (!LOG_METHODS.has(expr.name.text)) {
    return false;
  }

  const receiver = expr.expression.getText(sourceFile);
  return receiver === "logger" || receiver === "this.logger";
}

function shouldDropStatement(node, sourceFile) {
  if (!ts.isExpressionStatement(node)) {
    return false;
  }
  return isDebugCall(node.expression, sourceFile);
}

function transformSourceFile(sourceFile) {
  const transformer = (context) => {
    const visit = (node) => {
      if (shouldDropStatement(node, sourceFile)) {
        return undefined;
      }

      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.endsWith("flowLog") || spec.endsWith("flowLog.ts")) {
          return undefined;
        }
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (root) => ts.visitNode(root, visit);
  };

  const result = ts.transform(sourceFile, [transformer]);
  const transformed = result.transformed[0];
  result.dispose();

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true
  });

  return printer.printFile(transformed);
}

function walkTsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function cleanupBlankRuns(text) {
  return text.replace(/\n{3,}/g, "\n\n");
}

const files = walkTsFiles(SRC_ROOT);
let changed = 0;

for (const filePath of files) {
  if (filePath.endsWith(`${path.sep}flowLog.ts`)) {
    continue;
  }

  const original = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let updated = cleanupBlankRuns(transformSourceFile(sourceFile));

  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    changed += 1;
    console.log(`updated ${path.relative(process.cwd(), filePath)}`);
  }
}

const flowLogPath = path.join(SRC_ROOT, "utils", "flowLog.ts");
if (fs.existsSync(flowLogPath)) {
  fs.unlinkSync(flowLogPath);
  console.log("removed src/utils/flowLog.ts");
}

console.log(`done (${changed} files updated)`);
