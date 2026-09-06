import { Router, Request, Response } from "express";
import { getRun, listRunSteps, listRecentRuns } from "../db";

export const runsRouter = Router();

// GET /runs — list recent runs across all workflows
runsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const runs = await listRecentRuns();
    res.json(runs);
  } catch (err) {
    res.status(500).json({
      error: `Failed to list runs: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
});

// GET /runs/:id — run detail with all steps
runsRouter.get("/:id", async (req: Request, res: Response) => {
  const runId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(runId)) {
    return res.status(400).json({ error: "Invalid run id." });
  }

  try {
    const run = await getRun(runId);
    if (!run) {
      return res.status(404).json({ error: "Run not found." });
    }
    const steps = await listRunSteps(runId);
    res.json({ run, steps });
  } catch (err) {
    res.status(500).json({
      error: `Failed to fetch run: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
});
