/**
 * Standalone verification for the three sandboxed tool functions. Does NOT
 * require ANTHROPIC_API_KEY or a running Postgres instance — it calls
 * httpRequest / readLocalFile / writeLocalFile directly, the same functions
 * the agent loop invokes, and checks:
 *   1. write_local_file + read_local_file round-trip inside ./sandbox
 *   2. path traversal ("../../etc/passwd", absolute paths) is rejected for
 *      both read and write
 *   3. http_request can reach a public URL and reports status/body
 *
 * Run with: npm run test:tools
 */
import path from "path";
import fs from "fs";
import { httpRequest } from "../src/tools/httpRequest";
import { readLocalFile } from "../src/tools/readLocalFile";
import { writeLocalFile } from "../src/tools/writeLocalFile";
import { SANDBOX_DIR, ensureSandboxDirExists } from "../src/tools/sandbox";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  ensureSandboxDirExists();
  console.log(`Sandbox directory: ${SANDBOX_DIR}\n`);

  // 1. write_local_file writes inside the sandbox
  console.log("write_local_file / read_local_file round-trip");
  const writeResult = await writeLocalFile({
    path: "test-output.txt",
    content: "hello from test-tools.ts",
  });
  check("write_local_file reports ok:true", writeResult.ok === true, JSON.stringify(writeResult));
  check(
    "file actually exists on disk inside sandbox",
    fs.existsSync(path.join(SANDBOX_DIR, "test-output.txt"))
  );

  const readResult = await readLocalFile({ path: "test-output.txt" });
  check("read_local_file reports ok:true", readResult.ok === true, JSON.stringify(readResult));
  check(
    "read_local_file returns the content just written",
    readResult.content === "hello from test-tools.ts"
  );

  // append mode
  const appendResult = await writeLocalFile({
    path: "test-output.txt",
    content: "\nsecond line",
    append: true,
  });
  check("write_local_file (append) reports ok:true", appendResult.ok === true);
  const readAfterAppend = await readLocalFile({ path: "test-output.txt" });
  check(
    "appended content is present",
    (readAfterAppend.content ?? "").includes("second line")
  );

  // nested path creates parent dirs
  const nestedWrite = await writeLocalFile({
    path: "reports/nested/summary.md",
    content: "# summary",
  });
  check("write_local_file creates nested directories", nestedWrite.ok === true, JSON.stringify(nestedWrite));

  // 2. Path traversal must be rejected
  console.log("\npath traversal rejection");

  const traversalAttempts: { label: string; input: string }[] = [
    { label: "relative ../ escape", input: "../outside.txt" },
    { label: "deep ../../.. escape", input: "../../../etc/passwd" },
    { label: "absolute path outside sandbox", input: "/etc/passwd" },
  ];

  for (const attempt of traversalAttempts) {
    const writeAttempt = await writeLocalFile({
      path: attempt.input,
      content: "should never be written",
    });
    check(
      `write_local_file rejects ${attempt.label} ("${attempt.input}")`,
      writeAttempt.ok === false && !!writeAttempt.error,
      JSON.stringify(writeAttempt)
    );

    const readAttempt = await readLocalFile({ path: attempt.input });
    check(
      `read_local_file rejects ${attempt.label} ("${attempt.input}")`,
      readAttempt.ok === false && !!readAttempt.error,
      JSON.stringify(readAttempt)
    );
  }

  // Confirm the traversal attempt truly did not escape: no file was created
  // outside the sandbox directory (checked at a fixed, known location).
  const escapedFile = path.resolve(SANDBOX_DIR, "..", "outside.txt");
  check(
    "no file was created outside the sandbox directory",
    !fs.existsSync(escapedFile)
  );

  // 3. http_request against a real public endpoint
  console.log("\nhttp_request");
  const httpResult = await httpRequest({ url: "https://api.github.com" });
  check(
    "http_request to https://api.github.com returns a status code",
    typeof httpResult.status === "number",
    JSON.stringify(httpResult).slice(0, 200)
  );
  check(
    "http_request response body is non-empty",
    typeof httpResult.body === "string" && httpResult.body.length > 0
  );

  const badMethodResult = await httpRequest({
    url: "https://api.github.com",
    // @ts-expect-error intentionally invalid method to test validation
    method: "DELETE",
  });
  check(
    "http_request rejects unsupported methods",
    badMethodResult.ok === false && !!badMethodResult.error
  );

  const badUrlResult = await httpRequest({ url: "not-a-url" });
  check(
    "http_request rejects malformed URLs",
    badUrlResult.ok === false && !!badUrlResult.error
  );

  // Cleanup test artifacts
  fs.rmSync(path.join(SANDBOX_DIR, "test-output.txt"), { force: true });
  fs.rmSync(path.join(SANDBOX_DIR, "reports"), { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
