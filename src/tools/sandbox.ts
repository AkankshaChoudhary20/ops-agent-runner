import path from "path";
import fs from "fs";

/**
 * Absolute path to the one directory the file tools are allowed to touch.
 * Defaults to "<project root>/sandbox", where the project root is assumed to
 * be the current working directory the process was started from (true for
 * `npm run dev`, `npm start`, and the test script, all of which are run from
 * the repo root per the README). Override with the SANDBOX_DIR env var if
 * you need to launch the server from elsewhere.
 */
export const SANDBOX_DIR = process.env.SANDBOX_DIR
  ? path.resolve(process.env.SANDBOX_DIR)
  : path.resolve(process.cwd(), "sandbox");

export class PathTraversalError extends Error {
  constructor(requestedPath: string) {
    super(
      `Path "${requestedPath}" resolves outside the sandbox directory and is not allowed.`
    );
    this.name = "PathTraversalError";
  }
}

/**
 * Resolves a user/model-supplied relative path against the sandbox root and
 * verifies the result is still inside it. Throws PathTraversalError for any
 * attempt to escape (via "..", an absolute path, or a symlink) rather than
 * silently clamping the path — callers must not fall back to a "safe"
 * default location on failure.
 */
export function resolveSandboxPath(requestedPath: string): string {
  if (typeof requestedPath !== "string" || requestedPath.trim() === "") {
    throw new PathTraversalError(String(requestedPath));
  }

  // Reject absolute paths outright — only paths relative to the sandbox root
  // are meaningful here.
  const candidate = path.isAbsolute(requestedPath)
    ? requestedPath
    : path.join(SANDBOX_DIR, requestedPath);

  const resolved = path.resolve(candidate);

  // Ensure the resolved path is the sandbox dir itself or nested under it.
  const relative = path.relative(SANDBOX_DIR, resolved);
  const isInside =
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));

  if (!isInside) {
    throw new PathTraversalError(requestedPath);
  }

  // If the path exists and is (or resolves through) a symlink pointing
  // outside the sandbox, catch that too by checking the realpath.
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    const relReal = path.relative(SANDBOX_DIR, real);
    const realInside =
      relReal === "" || (!relReal.startsWith("..") && !path.isAbsolute(relReal));
    if (!realInside) {
      throw new PathTraversalError(requestedPath);
    }
  }

  return resolved;
}

export function ensureSandboxDirExists(): void {
  if (!fs.existsSync(SANDBOX_DIR)) {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  }
}
