import type Anthropic from "@anthropic-ai/sdk";
import { httpRequest } from "./httpRequest";
import { readLocalFile } from "./readLocalFile";
import { writeLocalFile } from "./writeLocalFile";

/**
 * A tool definition pairs the JSON schema Claude sees (`schema`) with the
 * async handler that actually executes it (`handler`). All handlers take a
 * single parsed JSON object and return a JSON-serializable result — they
 * never throw for "expected" failures (bad input, path traversal, network
 * error); they return `{ ok: false, error: "..." }` instead, so the agent
 * loop can always feed a tool_result back to Claude.
 *
 * To add a 4th tool: write its handler in its own file (returning a plain
 * object result, never throwing on expected failures), then add one entry
 * to this array with its Anthropic tool schema. Nothing else in the agent
 * loop or routes needs to change.
 */
export interface ToolDefinition {
  schema: Anthropic.Tool;
  handler: (input: any) => Promise<unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    schema: {
      name: "http_request",
      description:
        "Make a GET or POST HTTP request to a public URL and return the status code, status text, and response body (truncated to 8000 characters). " +
        "Use this to check whether an API or webhook is reachable, fetch a public resource, or post a payload to an endpoint. " +
        "Only http:// and https:// URLs are supported; there is no access to internal/local network resources beyond normal DNS/HTTP rules.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL to request, e.g. https://api.github.com",
          },
          method: {
            type: "string",
            enum: ["GET", "POST"],
            description: "HTTP method. Defaults to GET.",
          },
          body: {
            type: "string",
            description:
              "Request body to send for POST requests. Ignored for GET. Should be a string (e.g. JSON-stringified).",
          },
          headers: {
            type: "object",
            description:
              "Optional extra headers to send as a flat string-to-string map, e.g. {\"Authorization\": \"Bearer ...\"}.",
          },
        },
        required: ["url"],
      },
    },
    handler: httpRequest,
  },
  {
    schema: {
      name: "read_local_file",
      description:
        "Read a text file from the sandboxed working directory (./sandbox). " +
        "Paths are relative to that directory; attempts to read outside it (e.g. via '..' or an absolute path) are rejected. " +
        "Use this to inspect files that a previous step in this workflow wrote.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file, relative to the sandbox directory, e.g. \"status.txt\" or \"reports/summary.md\".",
          },
        },
        required: ["path"],
      },
    },
    handler: readLocalFile,
  },
  {
    schema: {
      name: "write_local_file",
      description:
        "Write or append text to a file in the sandboxed working directory (./sandbox). " +
        "Paths are relative to that directory; attempts to write outside it (e.g. via '..' or an absolute path) are rejected. " +
        "Parent directories inside the sandbox are created automatically. Use this to record results, logs, or reports.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file, relative to the sandbox directory, e.g. \"status.txt\" or \"reports/summary.md\".",
          },
          content: {
            type: "string",
            description: "The text content to write to the file.",
          },
          append: {
            type: "boolean",
            description:
              "If true, append to the file instead of overwriting it. Defaults to false (overwrite).",
          },
        },
        required: ["path", "content"],
      },
    },
    handler: writeLocalFile,
  },
];

export function getToolSchemas(): Anthropic.Tool[] {
  return TOOLS.map((t) => t.schema);
}

export function getToolHandler(
  name: string
): ((input: any) => Promise<unknown>) | undefined {
  return TOOLS.find((t) => t.schema.name === name)?.handler;
}
