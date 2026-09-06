import { Router, Request, Response } from "express";
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  createRun,
  finishRun,
  getRun,
  listRunSteps,
} from "../db";
import { runAgentLoop } from "../agent";

export const workflowsRouter = Router();

// POST /workflows — create a workflow
workflowsRouter.post("/", async (req: Request, res: Response) => {
  const { name, description, goal_prompt } = req.body ?? {};

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "name is required." });
  }
  if (typeof goal_prompt !== "string" || goal_prompt.trim() === "") {
    return res.status(400).json({ error: "goal_prompt is required." });
  }

  try {
    const workflow = await createWorkflow(
      name.trim(),
      typeof description === "string" ? description : null,
      goal_prompt.trim()
    );
    res.status(201).json(workflow);
  } catch (err) {
    res.status(500).json({
      error: `Failed to create workflow: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
});

// GET /workflows — list all workflows
workflowsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const workflows = await listWorkflows();
    res.json(workflows);
  } catch (err) {
    res.status(500).json({
      error: `Failed to list workflows: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
});

// POST /workflows/:id/run — kick off a run synchronously (max 8 agent steps,
// so this comfortably finishes within a normal HTTP request/response cycle).
workflowsRouter.post("/:id/run", async (req: Request, res: Response) => {
  const workflowId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(workflowId)) {
    return res.status(400).json({ error: "Invalid workflow id." });
  }

  const workflow = await getWorkflow(workflowId);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found." });
  }

  const run = await createRun(workflowId);

  try {
    const result = await runAgentLoop(run.id, workflow.goal_prompt);
    await finishRun(run.id, "completed");

    const finalRun = await getRun(run.id);
    const steps = await listRunSteps(run.id);

    res.status(201).json({
      run: finalRun,
      steps,
      final_message: result.finalMessage,
      steps_taken: result.stepsTaken,
      stopped_reason: result.stoppedReason,
    });
  } catch (err) {
    await finishRun(run.id, "failed");
    const finalRun = await getRun(run.id);
    const steps = await listRunSteps(run.id);

    res.status(502).json({
      error: `Agent run failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      run: finalRun,
      steps,
    });
  }
});
