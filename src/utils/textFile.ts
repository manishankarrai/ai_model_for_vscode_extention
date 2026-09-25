import * as path from "node:path";

const BINARY_FILE_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".class", ".dll", ".eot", ".exe", ".gif",
  ".ico", ".jar", ".jpeg", ".jpg", ".mp3", ".mp4", ".o", ".pdf",
  ".png", ".so", ".tar", ".ttf", ".wav", ".webp", ".woff", ".woff2", ".zip"
]);

export function hasBinaryFileExtension(filePath: string): boolean {
  return BINARY_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8 * 1024));
  if (sample.length === 0) {
    return false;
  }

  let controlBytes = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if ((byte < 7) || (byte > 14 && byte < 32) || byte === 127) {
      controlBytes += 1;
    }
  }

  return controlBytes / sample.length > 0.1;
}