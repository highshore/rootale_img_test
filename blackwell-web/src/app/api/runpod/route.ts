import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_DIMENSION = 768;
const DEFAULT_ENDPOINT_ID = "ul5kke5ddlrzhi";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? DEFAULT_ENDPOINT_ID;

const RUNPOD_PROXY_BASE_URL = (process.env.RUNPOD_PROXY_BASE_URL ??
  "http://a2ccc7a37a37df10c.awsglobalaccelerator.com"
).replace(/\/$/, "");
const RUNPOD_DIRECT_BASE_URL = (process.env.RUNPOD_DIRECT_BASE_URL ?? "https://api.runpod.ai").replace(/\/$/, "");

const RUNPOD_ACCELERATOR_BASE = `${RUNPOD_PROXY_BASE_URL}/v2/${RUNPOD_ENDPOINT_ID}`;
const RUNPOD_DIRECT_BASE = `${RUNPOD_DIRECT_BASE_URL}/v2/${RUNPOD_ENDPOINT_ID}`;

const RUNPOD_ACCELERATOR_RUN_URL = `${RUNPOD_ACCELERATOR_BASE}/run`;
const RUNPOD_DIRECT_RUN_URL = `${RUNPOD_DIRECT_BASE}/run`;

const RUNPOD_STATUS_URL = (id: string) => `${RUNPOD_ACCELERATOR_BASE}/status/${id}`;

const ACCELERATOR_MAX_IMAGE_BYTES =
  Number.parseInt(process.env.RUNPOD_ACCELERATOR_MAX_IMAGE_BYTES ?? "", 10) || 700_000;

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
  width: MAX_IMAGE_DIMENSION,
  height: MAX_IMAGE_DIMENSION,
  batch_size: 1,
  cpu_offload: "disable",
  num_blocks_on_gpu: 40,
  use_pin_memory: "enable",
  prompt: "",
  negative_prompt: "",
  timeout: 180,
};

const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;

function clampDimension(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return MAX_IMAGE_DIMENSION;
  }
  return Math.min(value, MAX_IMAGE_DIMENSION);
}

function sanitizeBase64Image(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed.startsWith("data:")
    ? trimmed.split(",")[1] ?? ""
    : trimmed.replace(/\s/g, "");

  if (!sanitized) {
    return null;
  }

  if (!BASE64_REGEX.test(sanitized)) {
    return null;
  }

  return sanitized;
}

function estimateBase64Bytes(base64: string) {
  return Math.floor((base64.length * 3) / 4);
}

type RunpodRequestBody = {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  imageBase64?: string;
  imageObjectKey?: string;
  imageUrl?: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: RunpodRequestBody;

  try {
    body = (await request.json()) as RunpodRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!body.prompt || body.prompt.trim().length === 0) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const payload = {
    ...DEFAULT_INPUT,
    prompt: body.prompt.trim(),
    negative_prompt: body.negativePrompt?.trim() ?? DEFAULT_INPUT.negative_prompt,
    width: clampDimension(body.width ?? DEFAULT_INPUT.width),
    height: clampDimension(body.height ?? DEFAULT_INPUT.height),
    steps: body.steps ?? DEFAULT_INPUT.steps,
    cfg: body.cfg ?? DEFAULT_INPUT.cfg,
    seed:
      typeof body.seed === "number" && Number.isFinite(body.seed)
        ? body.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  };

  const sanitizedImage = sanitizeBase64Image(body.imageBase64);
  let imageBytes = 0;
  if (sanitizedImage) {
    payload.image_name = sanitizedImage;
    imageBytes = estimateBase64Bytes(sanitizedImage);
  }

  if (typeof body.imageObjectKey === "string" && body.imageObjectKey.trim().length > 0) {
    payload.image_object_key = body.imageObjectKey.trim();
  }

  if (typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0) {
    payload.image_url = body.imageUrl.trim();
  }

  const shouldBypassAccelerator = imageBytes > ACCELERATOR_MAX_IMAGE_BYTES;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (shouldBypassAccelerator) {
    const apiKey = process.env.RUNPOD_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "RUNPOD_API_KEY is not configured on the server." },
        { status: 500 },
      );
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const runUrl = shouldBypassAccelerator ? RUNPOD_DIRECT_RUN_URL : RUNPOD_ACCELERATOR_RUN_URL;

  try {
    const response = await fetch(runUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: "Runpod request failed.",
          details: errorText,
          transport: shouldBypassAccelerator ? "direct" : "accelerator",
          status: response.status,
        },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json({
      ...result,
      transport: shouldBypassAccelerator ? "direct" : "accelerator",
    });
  } catch (error) {
    console.error("Runpod proxy error:", error);
    return NextResponse.json(
      { error: "Unexpected error communicating with Runpod." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("id");

  if (!jobId) {
    return NextResponse.json(
      { error: "Job id is required via the 'id' query parameter." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(RUNPOD_STATUS_URL(jobId), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Runpod status request failed.", details: result },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Runpod status error:", error);
    return NextResponse.json(
      { error: "Unexpected error fetching Runpod job status." },
      { status: 500 },
    );
  }
}
