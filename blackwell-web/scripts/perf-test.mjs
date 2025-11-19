#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const API_KEY = process.env.RUNPOD_API_KEY;
if (!API_KEY) {
  console.error("RUNPOD_API_KEY is not set. Export it before running this script.");
  process.exit(1);
}

const ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? "ul5kke5ddlrzhi";
const BASE_URL = `https://api.runpod.ai/v2/${ENDPOINT_ID}`;
const RUN_URL = `${BASE_URL}/run`;
const STATUS_URL = (id) => `${BASE_URL}/status/${id}`;

const PROMPT =
  "aki_anime, masterpiece, ultra-detailed, cinematic wide shot of a young inventor in a skylit workshop with brass contraptions, chalkboard equations, dramatic rim lighting, cinematic depth of field";

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
  prompt: "",
  negative_prompt: "",
  timeout: 180,
};

const POLL_INTERVAL_MS = 2000;
const HARD_TIMEOUT_MS = 240_000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const RUN_STARTED_AT = new Date();
const RUN_STAMP = RUN_STARTED_AT.toISOString().replace(/[:.]/g, "-");
const OUTPUT_ROOT = path.resolve(PROJECT_ROOT, "tmp", "perf_outputs", RUN_STAMP);
const SUMMARY_PATH = path.join(OUTPUT_ROOT, "summary.json");
const LATEST_POINTER = path.resolve(PROJECT_ROOT, "tmp", "perf_outputs", "latest-run.txt");

const BASE_IMAGE_DEFS = [
  { id: "demo-image", label: "Demo image 1" },
  { id: "demo-image2", label: "Demo image 2" },
  { id: "demo-image3", label: "Demo image 3" },
  { id: "demo-image4", label: "Demo image 4" },
  { id: "demo-image5", label: "Demo image 5" },
];

const VARIANT_SIZES = [512, 640, 720, 1024, 1536];

const BASE_IMAGES = BASE_IMAGE_DEFS.map((entry) => ({
  ...entry,
  variants: VARIANT_SIZES.reduce((acc, size) => {
    acc[size] = `tmp/perf_inputs/${entry.id}-${size}.png`;
    return acc;
  }, {}),
}));

const INPUT_VARIANTS = [
  { key: "input-512", label: "Input 512×512", width: 1024, height: 1024, variantSize: 512 },
  { key: "input-640", label: "Input 640×640", width: 1024, height: 1024, variantSize: 640 },
  { key: "input-720", label: "Input 720×720", width: 1024, height: 1024, variantSize: 720 },
  { key: "input-1024", label: "Input 1024×1024", width: 1024, height: 1024, variantSize: 1024 },
  { key: "input-1536", label: "Input 1536×1536", width: 1024, height: 1024, variantSize: 1536 },
];

const OUTPUT_VARIANTS = [
  { key: "output-512", label: "Output 512×512", width: 512, height: 512, variantSize: 1024 },
  { key: "output-640", label: "Output 640×640", width: 640, height: 640, variantSize: 1024 },
  { key: "output-720", label: "Output 720×720", width: 720, height: 720, variantSize: 1024 },
  { key: "output-1024", label: "Output 1024×1024", width: 1024, height: 1024, variantSize: 1024 },
  { key: "output-1536", label: "Output 1536×1536", width: 1536, height: 1536, variantSize: 1024 },
];

const COHORT_ORDER = [...INPUT_VARIANTS.map((variant) => variant.key), ...OUTPUT_VARIANTS.map((variant) => variant.key)];

function isTerminalStatus(status) {
  if (!status) {
    return false;
  }
  const normalized = status.toUpperCase();
  return ["COMPLETED", "FINISHED", "SUCCESS", "FAILED", "ERROR", "CANCELLED"].includes(normalized);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBase64(filePath) {
  const absolute = path.resolve(PROJECT_ROOT, filePath);
  const data = await fs.readFile(absolute);
  return { base64: data.toString("base64"), bytes: data.byteLength, absolute };
}

async function pollJob(jobId, startedAt) {
  let attempts = 0;
  while (true) {
    if (performance.now() - startedAt > HARD_TIMEOUT_MS) {
      throw new Error(`Job ${jobId} exceeded hard timeout (${HARD_TIMEOUT_MS / 1000}s).`);
    }
    await sleep(POLL_INTERVAL_MS);
    attempts += 1;
    const response = await fetch(STATUS_URL(jobId), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        `Status check failed for ${jobId} (${response.status}): ${JSON.stringify(payload).slice(0, 200)}`,
      );
    }
    if (isTerminalStatus(payload.status)) {
      return { payload, attempts };
    }
  }
}

async function runJob(payload, label) {
  const startedAt = performance.now();
  const response = await fetch(RUN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ input: payload }),
  });

  const initial = await response.json();
  if (!response.ok) {
    throw new Error(
      `Run request failed for ${label} (${response.status}): ${JSON.stringify(initial).slice(0, 200)}`,
    );
  }

  if (isTerminalStatus(initial.status)) {
    const totalMs = performance.now() - startedAt;
    return { finalPayload: initial, totalMs, polls: 0, jobId: initial.id ?? null };
  }

  if (!initial.id) {
    throw new Error(`Runpod did not return a job id for ${label}. Raw response: ${JSON.stringify(initial)}`);
  }

  const { payload: finalPayload, attempts } = await pollJob(initial.id, startedAt);
  const totalMs = performance.now() - startedAt;
  return { finalPayload, totalMs, polls: attempts, jobId: initial.id };
}

function extractBase64Image(output, depth = 0) {
  if (!output || depth > 6) {
    return null;
  }

  if (typeof output === "string") {
    const sanitized = output.startsWith("data:") ? output.split(",")[1] ?? "" : output.replace(/\s/g, "");
    if (
      sanitized.length > 100 &&
      sanitized.length % 4 === 0 &&
      /^[A-Za-z0-9+/=]+$/.test(sanitized)
    ) {
      return sanitized;
    }
    return null;
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      const result = extractBase64Image(item, depth + 1);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (typeof output === "object") {
    for (const value of Object.values(output)) {
      const result = extractBase64Image(value, depth + 1);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function sanitizeSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function saveOutputImage(base64, { kind, cohortKey, imageId }) {
  const dir = path.join(OUTPUT_ROOT, kind.toLowerCase(), sanitizeSegment(cohortKey));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${sanitizeSegment(cohortKey)}-${sanitizeSegment(imageId)}.png`;
  const target = path.join(dir, filename);
  await fs.writeFile(target, Buffer.from(base64, "base64"));
  return path.relative(PROJECT_ROOT, target);
}

async function runCohort({
  kind,
  cohortKey,
  cohortLabel,
  label,
  overrides,
  imageBytes,
  inputLabel,
  imageId,
  imageLabel,
  imageIndex,
}) {
  const payload = {
    ...DEFAULT_INPUT,
    prompt: PROMPT,
    width: overrides.width ?? DEFAULT_INPUT.width,
    height: overrides.height ?? DEFAULT_INPUT.height,
    image_name: overrides.imageBase64 ?? DEFAULT_INPUT.image_name,
  };

  const summaryLabel = `${kind} | ${label}`;
  console.log(`→ ${summaryLabel}`);
  const { finalPayload, totalMs, polls, jobId } = await runJob(payload, summaryLabel);
  const status = finalPayload.status ?? "UNKNOWN";
  const normalized = status.toUpperCase();
  if (!["COMPLETED", "FINISHED", "SUCCESS"].includes(normalized)) {
    console.warn(`⚠️  ${summaryLabel} finished with status ${status}`);
  }

  const queueMs = finalPayload.delayTime ?? null;
  const execMs = finalPayload.executionTime ?? null;
  let outputPath = null;
  const base64 = extractBase64Image(finalPayload.output);
  if (base64) {
    outputPath = await saveOutputImage(base64, { kind, cohortKey, imageId });
  }

  const result = {
    kind,
    cohortKey,
    cohortLabel,
    label,
    jobId: jobId ?? finalPayload.id ?? "n/a",
    status,
    polls,
    width: payload.width,
    height: payload.height,
    totalMs,
    queueMs,
    execMs,
    inputBytes: imageBytes ?? null,
    inputLabel: inputLabel ?? null,
    imageId,
    imageLabel,
    imageIndex,
    outputPath,
  };

  console.log(
    `← ${summaryLabel} completed in ${(totalMs / 1000).toFixed(2)}s (queue=${queueMs ?? "?"}ms, exec=${
      execMs ?? "?"
    }ms)`,
  );
  return result;
}

function summarizeCohorts(results) {
  const map = new Map();
  for (const record of results) {
    const key = record.cohortKey;
    if (!map.has(key)) {
      map.set(key, {
        cohortKey: key,
        cohortLabel: record.cohortLabel,
        kind: record.kind,
        values: [],
      });
    }
    if (typeof record.totalMs === "number") {
      map.get(key).values.push(record.totalMs);
    }
  }
  return Array.from(map.values()).map((entry) => {
    const values = entry.values;
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    return {
      cohortKey: entry.cohortKey,
      cohortLabel: entry.cohortLabel,
      kind: entry.kind,
      runs: values.length,
      avg_total_ms: avg,
      min_total_ms: min,
      max_total_ms: max,
    };
  });
}

async function loadBaseImageData() {
  const result = {};
  for (const image of BASE_IMAGES) {
    const variants = {};
    for (const [size, relativePath] of Object.entries(image.variants)) {
      variants[size] = await readBase64(relativePath);
    }
    result[image.id] = { ...image, variants };
  }
  return result;
}

async function main() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });

  const baseImageData = await loadBaseImageData();
  const runDescriptors = [];

  BASE_IMAGES.forEach((image, imageIndex) => {
    INPUT_VARIANTS.forEach((variant) => {
      const variantData = baseImageData[image.id].variants[variant.variantSize];
      runDescriptors.push({
        kind: "Input",
        cohortKey: variant.key,
        cohortLabel: variant.label,
        label: `${variant.label} • ${image.label}`,
        overrides: {
          width: variant.width,
          height: variant.height,
          imageBase64: variantData.base64,
        },
        imageBytes: variantData.bytes,
        inputLabel: `${image.label} (${variant.variantSize}px)`,
        imageId: image.id,
        imageLabel: image.label,
        imageIndex,
      });
    });

    OUTPUT_VARIANTS.forEach((variant) => {
      const variantData = baseImageData[image.id].variants[variant.variantSize];
      runDescriptors.push({
        kind: "Output",
        cohortKey: variant.key,
        cohortLabel: variant.label,
        label: `${variant.label} • ${image.label}`,
        overrides: {
          width: variant.width,
          height: variant.height,
          imageBase64: variantData.base64,
        },
        imageBytes: variantData.bytes,
        inputLabel: `${image.label} (${variant.variantSize}px input)`,
        imageId: image.id,
        imageLabel: image.label,
        imageIndex,
      });
    });
  });

  console.log(
    `Planned runs: ${runDescriptors.length} (cohorts: ${COHORT_ORDER.length}, images per cohort: ${BASE_IMAGES.length})`,
  );

  const results = [];
  for (const descriptor of runDescriptors) {
    try {
      const record = await runCohort(descriptor);
      results.push(record);
    } catch (error) {
      console.error(`✖ Failed run for ${descriptor.label}:`, error);
      results.push({
        ...descriptor,
        jobId: "n/a",
        status: "ERROR",
        polls: 0,
        width: descriptor.overrides.width,
        height: descriptor.overrides.height,
        totalMs: null,
        queueMs: null,
        execMs: null,
        outputPath: null,
      });
    }
  }

  const summaryRows = results.map((record) => ({
    kind: record.kind,
    cohort: record.cohortLabel,
    image: record.imageLabel,
    size: `${record.width}×${record.height}`,
    total_s: record.totalMs ? (record.totalMs / 1000).toFixed(2) : "—",
    queue_ms: record.queueMs ?? "—",
    exec_ms: record.execMs ?? "—",
    job_id: record.jobId,
    status: record.status ?? "UNKNOWN",
  }));

  console.log("\n=== Turnaround Samples ===");
  console.table(summaryRows);

  const aggregates = summarizeCohorts(results);
  console.log("\n=== Per-cohort averages (seconds) ===");
  console.table(
    aggregates.map((entry) => ({
      cohort: entry.cohortLabel,
      kind: entry.kind,
      runs: entry.runs,
      avg_s: entry.avg_total_ms ? (entry.avg_total_ms / 1000).toFixed(2) : "—",
      min_s: entry.min_total_ms ? (entry.min_total_ms / 1000).toFixed(2) : "—",
      max_s: entry.max_total_ms ? (entry.max_total_ms / 1000).toFixed(2) : "—",
    })),
  );

  const summaryPayload = {
    generatedAt: RUN_STARTED_AT.toISOString(),
    endpointId: ENDPOINT_ID,
    prompt: PROMPT,
    imagesPerCohort: BASE_IMAGES.length,
    cohortOrder: COHORT_ORDER,
    results,
    aggregates,
  };

  await fs.writeFile(SUMMARY_PATH, JSON.stringify(summaryPayload, null, 2));
  await fs.mkdir(path.dirname(LATEST_POINTER), { recursive: true });
  await fs.writeFile(LATEST_POINTER, `${SUMMARY_PATH}\n`);
  console.log(`\nSummary saved to ${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error("Performance test failed:", error);
  process.exit(1);
});

