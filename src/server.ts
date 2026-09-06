import path from "path";
import dotenv from "dotenv";

dotenv.config();

import express from "express";
import { workflowsRouter } from "./routes/workflows";
import { runsRouter } from "./routes/runs";
import { ensureSandboxDirExists } from "./tools/sandbox";
import { pool } from "./db";

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

app.use(express.json({ limit: "1mb" }));

// Static frontend (plain HTML/JS, no build step). Resolved from the current
// working directory rather than __dirname so it works identically whether
// run via `npm run dev` (ts-node, src/server.ts) or `npm start` (compiled,
// dist/src/server.js) — both are started from the project root.
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      database: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.use("/workflows", workflowsRouter);
app.use("/runs", runsRouter);

// Fallback JSON 404 for unmatched API-shaped routes
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

ensureSandboxDirExists();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`agentic-ops-builder listening on http://localhost:${PORT}`);
});
