#!/usr/bin/env node

/**
 * Compare end-to-end turnaround time when submitting RunPod jobs directly vs.
 * through the Global Accelerator + Frankfurt Nginx proxy.
 *
 * Usage:
 *   node scripts/compare-accelerator.mjs [runs=3]
 */

import process from "node:process";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.RUNPOD_API_KEY;
if (!API_KEY) {
  console.error("RUNPOD_API_KEY is required for direct RunPod benchmarking.");
  process.exit(1);
}

const ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "ul5kke5ddlrzhi";
const RUNS_PER_TARGET = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 3;

const DEFAULT_INPUT = {
  image_name:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAn0B9lqQ+wAAAABJRU5ErkJggg==",
  model_name: "svdq-fp4_r128-qwen-image-edit-2509-lightningv2.0-4steps.safetensors",
  lora_name: "Qwen-Anime-V1.safetensors",
  clip_name: "clip/qwen_2.5_vl_7b_fp8_scaled.1.safetensors",
  vae_name: "qwen_image_vae.1.safetensors",
  seed: 659968189596312,
  steps: 2,
  cfg: 1,
  sampler_name: "euler",
  scheduler: "simple",
  denoise: 1,
  shift: 3,
  width: 1024,
  height: 1024,
  batch_size: 1,
  cpu_offload: "disable",
  num_blocks_on_gpu: 40,
  use_pin_memory: "enable",
  prompt:
    "aki_anime, masterpiece, ultra-detailed, cinematic wide shot of a young inventor in a skylit workshop with brass contraptions, chalkboard equations, dramatic rim lighting, cinematic depth of field",
  negative_prompt: "",
  timeout: 180,
};

const TARGETS = [
  {
    key: "direct",
    label: "Direct RunPod (HTTPS, Romania)",
    runUrl: `https://api.runpod.ai/v2/${ENDPOINT_ID}/run`,
    statusUrl: (jobId) => `https://api.runpod.ai/v2/${ENDPOINT_ID}/status/${jobId}`,
    includeAuth: true,
  },
  {
    key: "accelerator",
    label: "Global Accelerator (HTTP, Frankfurt)",
    runUrl: `http://a2ccc7a37a37df10c.awsglobalaccelerator.com/v2/${ENDPOINT_ID}/run`,
    statusUrl: (jobId) =>
      `http://a2ccc7a37a37df10c.awsglobalaccelerator.com/v2/${ENDPOINT_ID}/status/${jobId}`,
    includeAuth: false,
  },
];

const TERMINAL_STATUSES = new Set(["COMPLETED", "FINISHED", "SUCCESS", "FAILED", "ERROR", "CANCELLED"]);
const POLL_INTERVAL_MS = 1500;
const HARD_TIMEOUT_MS = 240_000;

function isTerminal(status) {
  if (!status) {
    return false;
  }
  return TERMINAL_STATUSES.has(String(status).toUpperCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(includeAuth) {
  const headers = { "Content-Type": "application/json" };
  if (includeAuth) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  return headers;
}

async function pollStatus(target, jobId, startedAt) {
  let polls = 0;
  while (true) {
    if (performance.now() - startedAt > HARD_TIMEOUT_MS) {
      throw new Error(`Job ${jobId} exceeded hard timeout (${HARD_TIMEOUT_MS / 1000}s)`);
    }
    await sleep(POLL_INTERVAL_MS);
    polls += 1;
    const response = await fetch(target.statusUrl(jobId), {
      method: "GET",
      headers: buildHeaders(target.includeAuth),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        `Status request failed for ${target.label} job ${jobId} (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    if (isTerminal(payload.status)) {
      return { payload, polls };
    }
  }
}

async function runSingleJob(target, runIndex) {
  const startedAt = performance.now();
  const response = await fetch(target.runUrl, {
    method: "POST",
    headers: buildHeaders(target.includeAuth),
    body: JSON.stringify({ input: DEFAULT_INPUT }),
  });

  const initial = await response.json();
  if (!response.ok) {
    throw new Error(
      `Run request failed for ${target.label} (run #${runIndex + 1}) (${response.status}): ${JSON.stringify(initial)}`,
    );
  }

  if (isTerminal(initial.status)) {
    return {
      jobId: initial.id ?? "n/a",
      totalMs: performance.now() - startedAt,
      queueMs: initial.delayTime ?? null,
      execMs: initial.executionTime ?? null,
      polls: 0,
      status: initial.status ?? "UNKNOWN",
    };
  }

  if (!initial.id) {
    throw new Error(`RunPod did not return a job id for ${target.label} (run #${runIndex + 1}).`);
  }

  const { payload, polls } = await pollStatus(target, initial.id, startedAt);
  return {
    jobId: initial.id,
    totalMs: performance.now() - startedAt,
    queueMs: payload.delayTime ?? null,
    execMs: payload.executionTime ?? null,
    polls,
    status: payload.status ?? "UNKNOWN",
  };
}

function summarize(records) {
  const completed = records.filter((record) => typeof record.totalMs === "number");
  if (!completed.length) {
    return { avgMs: null, minMs: null, maxMs: null };
  }
  const values = completed.map((record) => record.totalMs);
  const avg = values.reduce((sum, ms) => sum + ms, 0) / values.length;
  return { avgMs: avg, minMs: Math.min(...values), maxMs: Math.max(...values) };
}

async function benchmarkTarget(target) {
  console.log(`\n== ${target.label} (${RUNS_PER_TARGET} runs) ==`);
  const records = [];
  for (let i = 0; i < RUNS_PER_TARGET; i += 1) {
    try {
      console.log(`→ Run ${i + 1}/${RUNS_PER_TARGET}`);
      const result = await runSingleJob(target, i);
      records.push(result);
      console.log(
        `← Run ${i + 1} completed in ${(result.totalMs / 1000).toFixed(2)}s (status=${result.status}, job=${result.jobId})`,
      );
    } catch (error) {
      console.error(`✖ Run ${i + 1} failed:`, error);
      records.push({
        jobId: "error",
        totalMs: null,
        queueMs: null,
        execMs: null,
        polls: 0,
        status: "ERROR",
      });
    }
  }

  const summary = summarize(records);
  const table = records.map((record, index) => ({
    run: index + 1,
    jobId: record.jobId,
    status: record.status,
    polls: record.polls,
    total_s: record.totalMs ? (record.totalMs / 1000).toFixed(2) : "—",
    queue_ms: record.queueMs ?? "—",
    exec_ms: record.execMs ?? "—",
  }));
  console.table(table);
  console.log(
    `Summary → avg ${(summary.avgMs ?? NaN) / 1000 || "n/a"} s, min ${
      summary.minMs ? (summary.minMs / 1000).toFixed(2) : "n/a"
    } s, max ${summary.maxMs ? (summary.maxMs / 1000).toFixed(2) : "n/a"} s`,
  );
  return { target, records, summary };
}

async function main() {
  console.log(
    `Benchmarking ${TARGETS.length} targets, ${RUNS_PER_TARGET} runs each (endpoint ${ENDPOINT_ID}). This will submit ${
      TARGETS.length * RUNS_PER_TARGET
    } jobs.`,
  );
  const outcomes = [];
  for (const target of TARGETS) {
    outcomes.push(await benchmarkTarget(target));
  }

  console.log("\n=== Aggregate Comparison ===");
  console.table(
    outcomes.map((entry) => ({
      target: entry.target.label,
      runs: entry.records.length,
      completed: entry.records.filter((record) => record.status && record.status !== "ERROR").length,
      avg_s: entry.summary.avgMs ? (entry.summary.avgMs / 1000).toFixed(2) : "—",
      min_s: entry.summary.minMs ? (entry.summary.minMs / 1000).toFixed(2) : "—",
      max_s: entry.summary.maxMs ? (entry.summary.maxMs / 1000).toFixed(2) : "—",
    })),
  );
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});


