import { createHash } from "node:crypto";

import { flow } from "../utils/flowLog.ts";

const MAX_CHANGE_CHARS = 200_000;

const SENSITIVE_EXTENSIONS = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".keystore",
  ".jks"
];

const SENSITIVE_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials.json",
  "service-account.json"
]);

export function validateWorkspaceRelativePath(filePath: string): string {
  flow("validateWorkspaceRelativePath", 1, "enter");
  const relativePath = filePath.replace(/\\/g, "/");

  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === "..")
  ) {
    throw new Error(`MM3 rejected unsafe change path: ${filePath}`);
  }

  return relativePath;
}

export function isSensitivePath(filePath: string): boolean {
  flow("isSensitivePath", 1, "enter");
  const clean = filePath.replace(/\\/g, "/").toLowerCase().trim();
  const base = clean.split("/").pop() ?? "";

  // .env / .env.* are allowed for read/edit when the user requests it.

  if (SENSITIVE_BASENAMES.has(base)) {
    return true;
  }

  if (clean.includes(".git/config") || clean.includes("/.ssh/")) {
    return true;
  }

  return SENSITIVE_EXTENSIONS.some((ext) => base.endsWith(ext));
}

export function assertNotSensitivePath(filePath: string): void {
  flow("assertNotSensitivePath", 1, "enter");
  if (isSensitivePath(filePath)) {
    throw new Error(`MM3 rejected sensitive path: ${filePath}`);
  }
}

export function validateChangeSize(
  path: string,
  original: string,
  updated: string
): void {
  if (original.length > MAX_CHANGE_CHARS || updated.length > MAX_CHANGE_CHARS) {
    throw new Error(`MM3 rejected ${path}: proposed change is too large.`);
  }
}

export function hashContent(text: string): string {
  flow("hashContent", 1, "enter");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function restoreDocumentNewlines(text: string, sample: string): string {
  if (sample.includes("\r\n")) {
    return normalizeNewlines(text).replace(/\n/g, "\r\n");
  }
  return normalizeNewlines(text);
}

function findUniqueWhitespaceInsensitiveSpan(
  current: string,
  original: string
): { start: number; end: number } | undefined {
  const target = original.replace(/\s+/g, "");
  if (!target) {
    return undefined;
  }

  const tokens = [...current.matchAll(/\S+/g)];
  const matches: Array<{ start: number; end: number }> = [];

  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    let combined = "";
    for (let endIndex = startIndex; endIndex < tokens.length; endIndex += 1) {
      combined += tokens[endIndex][0];
      if (combined.length >= target.length) {
        if (combined === target) {
          matches.push({
            start: tokens[startIndex].index!,
            end: tokens[endIndex].index! + tokens[endIndex][0].length
          });
        }
        break;
      }
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Map a planned original/updated pair onto the live document.
 * Selected snippets and CRLF/LF mismatches used to fail as "changed since investigation".
 */
export function resolveApplyContent(
  current: string,
  original: string,
  updated: string
): string {
  const currentN = normalizeNewlines(current);
  const originalN = normalizeNewlines(original ?? "");
  const updatedN = normalizeNewlines(updated ?? "");

  if (!originalN) {
    throw new Error("MM3 rejected the edit: exact original content is required.");
  }

  if (!updatedN) {
    return current;
  }

  if (!originalN || currentN === originalN || currentN.trimEnd() === originalN.trimEnd()) {
    return restoreDocumentNewlines(updatedN, current);
  }

  if (originalN.length < currentN.length && currentN.includes(originalN)) {
    const first = currentN.indexOf(originalN);
    const second = currentN.indexOf(originalN, first + 1);
    if (second === -1) {
      if (updatedN.includes(currentN)) {
        return restoreDocumentNewlines(updatedN, current);
      }
      const merged =
        currentN.slice(0, first) +
        updatedN +
        currentN.slice(first + originalN.length);
      return restoreDocumentNewlines(merged, current);
    }
  }

  const equivalentSpan = findUniqueWhitespaceInsensitiveSpan(currentN, originalN);
  if (equivalentSpan) {
    const merged =
      currentN.slice(0, equivalentSpan.start) +
      updatedN +
      currentN.slice(equivalentSpan.end);
    return restoreDocumentNewlines(merged, current);
  }

  throw new Error(
    "MM3 rejected the edit: the supplied original content does not match the current file."
  );
}

export function assertFileHashMatches(
  path: string,
  currentText: string,
  expectedHash: string,
  action: "apply" | "rollback"
): void {
  const actual = hashContent(currentText);
  if (actual === expectedHash) {
    return;
  }

  if (action === "rollback") {
    throw new Error(
      `MM3 rejected rollback: ${path} hash changed after the approved edit.`
    );
  }

  throw new Error(
    `MM3 rejected ${path}: file hash changed since investigation.`
  );
}

export function assertFileNotStale(
  path: string,
  currentText: string,
  expectedText: string,
  action: "apply" | "rollback"
): void {
  if (
    normalizeNewlines(currentText) === normalizeNewlines(expectedText) ||
    normalizeNewlines(currentText).trimEnd() === normalizeNewlines(expectedText).trimEnd()
  ) {
    return;
  }

  if (action === "rollback") {
    throw new Error(
      `MM3 rejected rollback: ${path} changed after the approved edit.`
    );
  }

  throw new Error(
    `MM3 rejected ${path}: the file changed since investigation.`
  );
}

export function assertWorkspaceTrusted(isTrusted: boolean): void {
  flow("assertWorkspaceTrusted", 1, "enter");
  if (!isTrusted) {
    throw new Error(
      "MM3 refused to write: workspace is not trusted. Enable workspace trust first."
    );
  }
}

