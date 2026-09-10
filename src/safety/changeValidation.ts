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
    throw new Error(`M3 rejected unsafe change path: ${filePath}`);
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
    throw new Error(`M3 rejected sensitive path: ${filePath}`);
  }
}

export function validateChangeSize(
  path: string,
  original: string,
  updated: string
): void {
  if (original.length > MAX_CHANGE_CHARS || updated.length > MAX_CHANGE_CHARS) {
    throw new Error(`M3 rejected ${path}: proposed change is too large.`);
  }
}

export function hashContent(text: string): string {
  flow("hashContent", 1, "enter");
  return createHash("sha256").update(text, "utf8").digest("hex");
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
      `M3 rejected rollback: ${path} hash changed after the approved edit.`
    );
  }

  throw new Error(
    `M3 rejected ${path}: file hash changed since investigation.`
  );
}

export function assertFileNotStale(
  path: string,
  currentText: string,
  expectedText: string,
  action: "apply" | "rollback"
): void {
  if (currentText === expectedText) {
    return;
  }

  if (action === "rollback") {
    throw new Error(
      `M3 rejected rollback: ${path} changed after the approved edit.`
    );
  }

  throw new Error(
    `M3 rejected ${path}: the file changed since investigation.`
  );
}

export function assertWorkspaceTrusted(isTrusted: boolean): void {
  flow("assertWorkspaceTrusted", 1, "enter");
  if (!isTrusted) {
    throw new Error(
      "M3 refused to write: workspace is not trusted. Enable workspace trust first."
    );
  }
}

