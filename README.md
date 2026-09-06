# agentic-ops-builder

A generalized, domain-agnostic sibling to [`k8s-sre-copilot`](https://github.com/AkankshaChoudhary20/k8s-sre-copilot): instead of a fixed set of Kubernetes-specific commands (`detect`/`rca`/`fix`/`sop`/`scan`/`chat`), you define a **workflow** as a single natural-language goal, and a Claude-powered agent decides — turn by turn, via real tool-use/function-calling — which of a small set of safe tools to call to accomplish it. Every tool call, its input, and its output are logged to Postgres, so every run has a full, inspectable step-by-step trace.

Example goal: *"Check if https://api.github.com is up and write the result to a status.txt file."* The agent will typically call `http_request` once, then `write_local_file` once, then reply with a summary — three logged steps, visible in the UI.

## Architecture

```
Browser (public/index.html + app.js, no build step)
        │  fetch()
        ▼
Express server (src/server.ts)
        │
        ├── /workflows  (src/routes/workflows.ts) ── create / list workflows, kick off a run
        ├── /runs       (src/routes/runs.ts)       ── list recent runs, fetch one run's full trace
        │
        ▼
Agent loop (src/agent.ts)
        │  client.messages.create({ model, tools, messages })
        ▼
Anthropic Claude API  ──tool_use──▶  Tool registry (src/tools/index.ts)
        ▲                                 │
        │        tool_result              ▼
        └──────────────────────  http_request / read_local_file / write_local_file
                                          │
                                          ▼
                                   ./sandbox directory (file tools only)

Postgres (docker-compose.yml + db/init.sql): workflows, runs, run_steps
```

### The agent loop, concretely

1. A workflow's `goal_prompt` becomes the first user message to Claude, alongside a system prompt describing the three available tools and a hard turn limit.
2. Claude replies. If `stop_reason === "tool_use"`, the response contains one or more `tool_use` blocks (tool name + JSON input).
3. For each `tool_use` block, the server looks up the matching handler in the tool registry, executes it, and writes a row to `run_steps` (`tool_name`, `tool_input`, `tool_output`) **before** replying to Claude.
4. All tool results are sent back to Claude in a single follow-up user message (`tool_result` blocks), and the loop repeats.
5. The loop ends when Claude stops requesting tools (it produces a final text summary instead) or after `MAX_AGENT_STEPS` turns (default 8) — whichever comes first. This bounds every run to a small, predictable number of API calls, so `POST /workflows/:id/run` can run **synchronously** and return the full trace in one HTTP response — no job queue or polling needed for this MVP.
6. The run's `status` is `completed` if the loop finished (with or without hitting the step cap) and `failed` only if something actually threw (e.g. a missing API key, a Postgres error, an unrecoverable API error).

This is the same shape as `k8s-sre-copilot`'s command dispatch, generalized: instead of the operator picking one of `detect`/`rca`/`fix`/`sop`/`scan` up front, Claude picks the sequence of tool calls at runtime from the goal prompt, and the tool set is arbitrary rather than Kubernetes-specific.

### Adding a 4th tool

Tools are registered in one place, `src/tools/index.ts`, as `{ schema, handler }` pairs:

```ts
export const TOOLS: ToolDefinition[] = [
  { schema: { name: "http_request", ... }, handler: httpRequest },
  { schema: { name: "read_local_file", ... }, handler: readLocalFile },
  { schema: { name: "write_local_file", ... }, handler: writeLocalFile },
  // { schema: { name: "your_new_tool", ... }, handler: yourNewToolHandler },
];
```

Write the handler in its own file under `src/tools/` — an async function that takes the parsed JSON input Claude sent and returns a plain JSON-serializable result, never throwing for "expected" failures (bad input, a rejected path, a network error) — then add one entry to `TOOLS`. Nothing in the agent loop, the routes, or the database layer needs to change; `getToolSchemas()` and `getToolHandler()` both read from this one array.

## Safety note — why only these three tools

This is a portfolio/demo project, so the tool surface is deliberately small and **does not include arbitrary shell execution**. All three tools are sandboxed:

- **`http_request`** — GET/POST to a public `http(s)://` URL only, with a 15-second timeout and an 8,000-character response cap. No other protocols, no shell, no arbitrary command construction.
- **`read_local_file`** / **`write_local_file`** — both are hard-restricted to a single fixed directory, `./sandbox`, resolved once at process start (`src/tools/sandbox.ts`). Every path Claude supplies is resolved against that directory and checked with `path.relative()` to ensure the result is still inside it; anything that would escape via `..`, an absolute path, or a symlink pointing outside the sandbox is rejected with an error **before any filesystem call is made** — it never falls back to a "safe default" location. See `resolveSandboxPath()` in `src/tools/sandbox.ts`, and `scripts/test-tools.ts` for automated tests that specifically exercise traversal attempts (`../outside.txt`, `../../../etc/passwd`, `/etc/passwd`) and assert no file is created outside the sandbox.

There is no `bash`/`exec` tool, no database-write tool, and no tool that can reach outside `./sandbox` — so even an adversarial or confused goal prompt can't do more than make a bounded number of HTTP requests and read/write files in one scratch directory.

## Setup

### 1. Get an Anthropic API key

Sign up / log in at [console.anthropic.com](https://console.anthropic.com/), go to **Settings → API Keys**, and create a key.

### 2. Configure environment

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

`DATABASE_URL` in `.env.example` already matches the `docker-compose.yml` defaults, so you don't need to change it for local development.

### 3. Start Postgres

```bash
docker-compose up -d
```

This starts a `postgres:16-alpine` container and applies `db/init.sql` automatically on first boot (creating the `workflows`, `runs`, and `run_steps` tables). If you already had a Postgres instance running before adding this schema, run `db/init.sql` against it manually.

### 4. Install and build

```bash
npm install
npm run build   # compiles TypeScript with tsc — should report no errors
```

### 5. Run

```bash
npm start        # runs the compiled server (dist/src/server.js)
# or, during development:
npm run dev       # runs src/server.ts directly via ts-node
```

Then open **http://localhost:3000**.

### 6. Try the example workflow

In the UI, create a workflow with:

- **Name:** `Check GitHub API status`
- **Goal prompt:** `Check if https://api.github.com is up and write the result to a status.txt file`

Click **Run**. You should see the agent call `http_request` against `https://api.github.com`, then `write_local_file` to save the result to `sandbox/status.txt`, then produce a short text summary — all three logged as steps in the trace panel on the right.

### Verifying the tools without an API key

`scripts/test-tools.ts` calls `http_request`, `read_local_file`, and `write_local_file` directly (no Anthropic API key, no database required) and asserts that path-traversal attempts are rejected:

```bash
npm run test:tools
```

## API

| Method | Path                   | Description                                                          |
| ------ | ---------------------- | --------------------------------------------------------------------- |
| GET    | `/health`              | Server + database connectivity check                                  |
| POST   | `/workflows`           | Create a workflow: `{ name, description?, goal_prompt }`              |
| GET    | `/workflows`           | List all workflows                                                    |
| POST   | `/workflows/:id/run`   | Run a workflow synchronously; returns the run, its steps, and Claude's final summary |
| GET    | `/runs`                | List recent runs (across all workflows)                               |
| GET    | `/runs/:id`            | Fetch one run's status plus its full step-by-step trace               |

## Database schema

```sql
workflows(id, name, description, goal_prompt, created_at)
runs(id, workflow_id, status, started_at, finished_at)
run_steps(id, run_id, step_number, tool_name, tool_input, tool_output, created_at)
```

See `db/init.sql` for the full DDL.

## Project layout

```
src/
  server.ts             Express app, static frontend, route mounting
  db.ts                 pg Pool + typed query helpers for all three tables
  agent.ts              the Claude tool-use agent loop
  tools/
    index.ts            tool registry: schema + handler pairs
    sandbox.ts           shared path-resolution/validation for file tools
    httpRequest.ts
    readLocalFile.ts
    writeLocalFile.ts
  routes/
    workflows.ts
    runs.ts
public/
  index.html, app.js     vanilla JS frontend, no build step
scripts/
  test-tools.ts          direct tool-function tests incl. path-traversal checks
db/
  init.sql               schema, applied automatically by docker-compose
```

## Notes / caveats

- The run endpoint executes the agent loop **synchronously** inside the HTTP request. That's a deliberate MVP simplification enabled by the 8-step cap — for a production system with longer-running workflows you'd move this to a background job and have the frontend poll `GET /runs/:id` (the schema already supports that; only `POST /workflows/:id/run` would need to become "enqueue and return immediately").
- `ANTHROPIC_MODEL` defaults to `claude-sonnet-5` and can be overridden in `.env`.
