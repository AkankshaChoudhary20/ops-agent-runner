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

  if (path.isAbsolute(requestedPath)) throw new PathTraversalError(requestedPath);
  const resolved = path.resolve(SANDBOX_DIR, requestedPath);
  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
  };
  if (!inside(SANDBOX_DIR, resolved)) throw new PathTraversalError(requestedPath);

  // New files have no realpath yet. Check the nearest existing ancestor so
  // a symlinked parent cannot redirect mkdir/writeFile outside the sandbox.
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    if (fs.lstatSync(ancestor, {throwIfNoEntry: false})?.isSymbolicLink()) {
      throw new PathTraversalError(requestedPath);
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalRoot = fs.existsSync(SANDBOX_DIR) ? fs.realpathSync(SANDBOX_DIR) : SANDBOX_DIR;
  // An absent sandbox is created by the caller; its own existing parent is
  // allowed only when it is the direct ancestor of the configured root.
  if (fs.existsSync(SANDBOX_DIR) && !inside(canonicalRoot, fs.realpathSync(ancestor))) {
    throw new PathTraversalError(requestedPath);
  }

  return resolved;
}

export function ensureSandboxDirExists(): void {
  if (!fs.existsSync(SANDBOX_DIR)) {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  }
}
