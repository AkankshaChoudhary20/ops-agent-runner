-- Schema for agentic-ops-builder
-- Applied automatically by docker-compose on first Postgres container start
-- (mounted into /docker-entrypoint-initdb.d/). Safe to re-run manually too.

CREATE TABLE IF NOT EXISTS workflows (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    goal_prompt TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS run_steps (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input JSONB,
    tool_output TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id);
