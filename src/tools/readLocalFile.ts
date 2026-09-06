import fs from "fs/promises";
import { resolveSandboxPath, PathTraversalError } from "./sandbox";

export interface ReadLocalFileInput {
  path: string;
}

export interface ReadLocalFileResult {
  ok: boolean;
  content?: string;
  error?: string;
}

const MAX_READ_CHARS = 20000;

/**
 * Reads a file from the fixed ./sandbox directory only. Any path that
 * resolves outside the sandbox (via "..", an absolute path, or a symlink)
 * is rejected with an error result rather than being read.
 */
export async function readLocalFile(
  input: ReadLocalFileInput
): Promise<ReadLocalFileResult> {
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
    const content = await fs.readFile(resolvedPath, "utf-8");
    const truncated =
      content.length > MAX_READ_CHARS
        ? content.slice(0, MAX_READ_CHARS) + "\n...[truncated]"
        : content;
    return { ok: true, content: truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not read file: ${message}` };
  }
}
