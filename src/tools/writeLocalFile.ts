import fs from "fs/promises";
import path from "path";
import { resolveSandboxPath, PathTraversalError } from "./sandbox";

export interface WriteLocalFileInput {
  path: string;
  content: string;
  append?: boolean;
}

export interface WriteLocalFileResult {
  ok: boolean;
  bytesWritten?: number;
  error?: string;
}

const MAX_WRITE_CHARS = 100000;

/**
 * Writes or appends a file inside the fixed ./sandbox directory only. Any
 * path that resolves outside the sandbox is rejected before touching the
 * filesystem. Parent directories inside the sandbox are created as needed.
 */
export async function writeLocalFile(
  input: WriteLocalFileInput
): Promise<WriteLocalFileResult> {
  if (typeof input.content !== "string") {
    return { ok: false, error: "content must be a string." };
  }
  if (input.content.length > MAX_WRITE_CHARS) {
    return {
      ok: false,
      error: `content exceeds the ${MAX_WRITE_CHARS}-character limit for this tool.`,
    };
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveSandboxPath(input.path);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    if (input.append) {
      await fs.appendFile(resolvedPath, input.content, "utf-8");
    } else {
      await fs.writeFile(resolvedPath, input.content, "utf-8");
    }
    return { ok: true, bytesWritten: Buffer.byteLength(input.content, "utf-8") };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not write file: ${message}` };
  }
}
