import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // eslint-disable-next-line no-console
  console.warn(
    "[db] DATABASE_URL is not set. Set it in .env (see .env.example). Falling back to local default."
  );
}

export const pool = new Pool({
  connectionString:
    connectionString ||
    "postgres://postgres:postgres@localhost:5435/agentic_ops_builder",
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] Unexpected error on idle Postgres client", err);
});

export interface WorkflowRow {
  id: number;
  name: string;
  description: string | null;
  goal_prompt: string;
  created_at: Date;
}

export interface RunRow {
  id: number;
  workflow_id: number;
  status: "pending" | "running" | "completed" | "failed";
  started_at: Date | null;
  finished_at: Date | null;
}

export interface RunStepRow {
  id: number;
  run_id: number;
  step_number: number;
  tool_name: string;
  tool_input: unknown;
  tool_output: string | null;
  created_at: Date;
}

export async function createWorkflow(
  name: string,
  description: string | null,
  goalPrompt: string
): Promise<WorkflowRow> {
  const result = await pool.query<WorkflowRow>(
    `INSERT INTO workflows (name, description, goal_prompt)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, goal_prompt, created_at`,
    [name, description, goalPrompt]
  );
  return result.rows[0];
}

export async function listWorkflows(): Promise<WorkflowRow[]> {
  const result = await pool.query<WorkflowRow>(
    `SELECT id, name, description, goal_prompt, created_at
     FROM workflows
     ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function getWorkflow(id: number): Promise<WorkflowRow | null> {
  const result = await pool.query<WorkflowRow>(
    `SELECT id, name, description, goal_prompt, created_at
     FROM workflows WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createRun(workflowId: number): Promise<RunRow> {
  const result = await pool.query<RunRow>(
    `INSERT INTO runs (workflow_id, status, started_at)
     VALUES ($1, 'running', now())
     RETURNING id, workflow_id, status, started_at, finished_at`,
    [workflowId]
  );
  return result.rows[0];
}

export async function finishRun(
  runId: number,
  status: "completed" | "failed"
): Promise<void> {
  await pool.query(
    `UPDATE runs SET status = $2, finished_at = now() WHERE id = $1`,
    [runId, status]
  );
}

export async function addRunStep(
  runId: number,
  stepNumber: number,
  toolName: string,
  toolInput: unknown,
  toolOutput: string
): Promise<RunStepRow> {
  const result = await pool.query<RunStepRow>(
    `INSERT INTO run_steps (run_id, step_number, tool_name, tool_input, tool_output)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, run_id, step_number, tool_name, tool_input, tool_output, created_at`,
    [runId, stepNumber, toolName, JSON.stringify(toolInput ?? {}), toolOutput]
  );
  return result.rows[0];
}

export async function getRun(runId: number): Promise<RunRow | null> {
  const result = await pool.query<RunRow>(
    `SELECT id, workflow_id, status, started_at, finished_at FROM runs WHERE id = $1`,
    [runId]
  );
  return result.rows[0] ?? null;
}

export async function listRunSteps(runId: number): Promise<RunStepRow[]> {
  const result = await pool.query<RunStepRow>(
    `SELECT id, run_id, step_number, tool_name, tool_input, tool_output, created_at
     FROM run_steps WHERE run_id = $1 ORDER BY step_number ASC`,
    [runId]
  );
  return result.rows;
}

export async function listRecentRuns(limit = 50): Promise<
  (RunRow & { workflow_name: string })[]
> {
  const result = await pool.query<RunRow & { workflow_name: string }>(
    `SELECT r.id, r.workflow_id, r.status, r.started_at, r.finished_at, w.name AS workflow_name
     FROM runs r
     JOIN workflows w ON w.id = r.workflow_id
     ORDER BY r.id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}
