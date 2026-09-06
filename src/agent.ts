import Anthropic from "@anthropic-ai/sdk";
import { getToolSchemas, getToolHandler } from "./tools";
import { addRunStep } from "./db";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_STEPS = Number.parseInt(process.env.MAX_AGENT_STEPS || "8", 10);
const MAX_TOKENS = 4096;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

const SYSTEM_PROMPT = `You are an ops automation agent. You are given a single goal by an operator and you must accomplish it by calling the tools available to you, one step at a time, then reporting back.

Rules:
- You have three tools: http_request (GET/POST to a public URL), read_local_file and write_local_file (both scoped to a fixed sandbox directory — you cannot read or write anything outside it, no matter what path you pass).
- Think about which tool (if any) is needed for each step of the goal, call it, look at the result, and decide the next step.
- You have a hard limit of ${MAX_STEPS} tool-use turns for this run. Work efficiently — don't call a tool you don't need, and don't repeat a call whose result you already have.
- When the goal is fully accomplished, stop calling tools and reply with a short plain-text summary of what you did and what the outcome was. That summary is the last thing you should output — do not keep going after the goal is met.
- If a tool call fails (network error, path rejected, etc.), read the error message, decide whether to adjust and retry once or explain the failure in your final summary — do not loop on the same failing call.`;

export interface AgentRunResult {
  finalMessage: string;
  stepsTaken: number;
  stoppedReason: "finished" | "max_steps_reached";
}

/**
 * Drives the Claude tool-use agent loop for one workflow run: on each turn,
 * Claude either calls one or more tools (executed here, logged to
 * `run_steps`, and fed back as tool_results) or produces a final text
 * answer, which ends the loop. Stops after MAX_AGENT_STEPS turns regardless
 * of whether Claude was done, so a single run can never spin forever.
 */
export async function runAgentLoop(
  runId: number,
  goalPrompt: string
): Promise<AgentRunResult> {
  const client = getClient();
  const tools = getToolSchemas();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: goalPrompt },
  ];

  let stepNumber = 0;
  let finalMessage = "";
  let stoppedReason: AgentRunResult["stoppedReason"] = "max_steps_reached";

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    if (textBlocks.length > 0) {
      finalMessage = textBlocks.map((b) => b.text).join("\n").trim();
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      stoppedReason = "finished";
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      stepNumber += 1;
      const handler = getToolHandler(toolUse.name);

      let outputText: string;
      let isError = false;

      if (!handler) {
        outputText = `Unknown tool "${toolUse.name}". Available tools: ${tools
          .map((t) => t.name)
          .join(", ")}.`;
        isError = true;
      } else {
        try {
          const result = await handler(toolUse.input);
          outputText = JSON.stringify(result);
        } catch (err) {
          outputText = `Tool execution threw an unexpected error: ${
            err instanceof Error ? err.message : String(err)
          }`;
          isError = true;
        }
      }

      await addRunStep(
        runId,
        stepNumber,
        toolUse.name,
        toolUse.input,
        outputText
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: outputText,
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    finalMessage:
      finalMessage ||
      "(The agent stopped without producing a final summary. See the step trace for what it did.)",
    stepsTaken: stepNumber,
    stoppedReason,
  };
}
