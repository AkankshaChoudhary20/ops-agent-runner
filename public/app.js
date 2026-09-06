const workflowListEl = document.getElementById("workflow-list");
const runListEl = document.getElementById("run-list");
const detailContentEl = document.getElementById("detail-content");
const statusMsgEl = document.getElementById("status-msg");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return body;
}

// ---------- Workflows ----------

let currentWorkflows = [];

async function loadWorkflows() {
  try {
    currentWorkflows = await fetchJson("/workflows");
    renderWorkflows();
  } catch (err) {
    workflowListEl.innerHTML = `<div class="empty">Failed to load workflows: ${escapeHtml(err.message)}</div>`;
  }
}

function renderWorkflows() {
  if (currentWorkflows.length === 0) {
    workflowListEl.innerHTML = `<div class="empty">No workflows yet. Create one on the left.</div>`;
    return;
  }
  workflowListEl.innerHTML = currentWorkflows
    .map(
      (w) => `
      <div class="workflow-item" data-id="${w.id}">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="goal">${escapeHtml(w.goal_prompt)}</div>
        <div class="row" style="margin-top:8px;">
          <button class="run-btn" data-id="${w.id}">Run</button>
        </div>
      </div>`
    )
    .join("");

  document.querySelectorAll(".run-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      await triggerRun(id, btn);
    });
  });
}

async function triggerRun(workflowId, btn) {
  const originalText = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running…";
  }
  setStatus("Running agent — this can take a few seconds per tool call…", null);

  try {
    const result = await fetchJson(`/workflows/${workflowId}/run`, {
      method: "POST",
    });
    setStatus("Run complete.", "ok");
    renderRunDetail(result.run, result.steps, result.final_message);
    await loadRuns();
  } catch (err) {
    setStatus(`Run failed: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// ---------- Create workflow form ----------

document.getElementById("create-btn").addEventListener("click", async () => {
  const name = document.getElementById("wf-name").value.trim();
  const description = document.getElementById("wf-desc").value.trim();
  const goal_prompt = document.getElementById("wf-goal").value.trim();

  if (!name || !goal_prompt) {
    setStatus("Name and goal prompt are required.", "error");
    return;
  }

  try {
    await fetchJson("/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, goal_prompt }),
    });
    document.getElementById("wf-name").value = "";
    document.getElementById("wf-desc").value = "";
    document.getElementById("wf-goal").value = "";
    setStatus("Workflow created.", "ok");
    await loadWorkflows();
  } catch (err) {
    setStatus(`Failed to create workflow: ${err.message}`, "error");
  }
});

function setStatus(message, kind) {
  statusMsgEl.textContent = message;
  statusMsgEl.className = kind ? kind : "";
}

// ---------- Runs ----------

async function loadRuns() {
  try {
    const runs = await fetchJson("/runs");
    renderRuns(runs);
  } catch (err) {
    runListEl.innerHTML = `<div class="empty">Failed to load runs: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRuns(runs) {
  if (runs.length === 0) {
    runListEl.innerHTML = `<div class="empty">No runs yet.</div>`;
    return;
  }
  runListEl.innerHTML = runs
    .map(
      (r) => `
      <div class="run-item" data-id="${r.id}">
        <div class="row" style="justify-content: space-between;">
          <span>#${r.id} · ${escapeHtml(r.workflow_name)}</span>
          <span class="badge ${r.status}">${r.status}</span>
        </div>
        <div class="goal">started ${formatDate(r.started_at)}</div>
      </div>`
    )
    .join("");

  document.querySelectorAll(".run-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const id = item.getAttribute("data-id");
      await loadRunDetail(id);
    });
  });
}

async function loadRunDetail(runId) {
  try {
    const data = await fetchJson(`/runs/${runId}`);
    renderRunDetail(data.run, data.steps, null);
  } catch (err) {
    detailContentEl.innerHTML = `<div class="empty">Failed to load run: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRunDetail(run, steps, finalMessage) {
  const parts = [];

  parts.push(`
    <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
      <div>Run <strong>#${run.id}</strong></div>
      <span class="badge ${run.status}">${run.status}</span>
    </div>
    <div class="goal" style="margin-bottom: 14px;">
      started ${formatDate(run.started_at)} · finished ${formatDate(run.finished_at)}
    </div>
  `);

  if (finalMessage) {
    parts.push(`<div class="final-message"><strong>Agent summary:</strong><br/>${escapeHtml(finalMessage)}</div>`);
  }

  if (!steps || steps.length === 0) {
    parts.push(`<div class="empty">No tool calls were made in this run.</div>`);
  } else {
    parts.push(
      steps
        .map(
          (s) => `
        <div class="step">
          <div class="row" style="justify-content: space-between;">
            <span class="tool-name">Step ${s.step_number} · ${escapeHtml(s.tool_name)}</span>
            <span class="goal">${formatDate(s.created_at)}</span>
          </div>
          <div>
            <div class="goal" style="margin-top:6px;">input</div>
            <pre>${escapeHtml(
              typeof s.tool_input === "string"
                ? s.tool_input
                : JSON.stringify(s.tool_input, null, 2)
            )}</pre>
            <div class="goal" style="margin-top:6px;">output</div>
            <pre>${escapeHtml(s.tool_output ?? "")}</pre>
          </div>
        </div>`
        )
        .join("")
    );
  }

  detailContentEl.innerHTML = parts.join("");
}

// ---------- Init ----------

loadWorkflows();
loadRuns();
