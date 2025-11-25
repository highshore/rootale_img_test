import { NextRequest, NextResponse } from "next/server";
import type { BackgroundFormValues, CharacterFormValues, ComboFormValues } from "@/lib/generation";

const OUTPUT_WIDTH = Number.parseInt(process.env.RUNPOD_OUTPUT_WIDTH ?? "1664", 10);
const OUTPUT_HEIGHT = Number.parseInt(process.env.RUNPOD_OUTPUT_HEIGHT ?? "928", 10);
const DEFAULT_ENDPOINT_ID = "ul5kke5ddlrzhi";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID ?? DEFAULT_ENDPOINT_ID;

const RUNPOD_PROXY_BASE_URL = (process.env.RUNPOD_PROXY_BASE_URL ??
  "http://a2ccc7a37a37df10c.awsglobalaccelerator.com"
).replace(/\/$/, "");
const RUNPOD_ACCELERATOR_BASE = `${RUNPOD_PROXY_BASE_URL}/v2/${RUNPOD_ENDPOINT_ID}`;
const RUNPOD_ACCELERATOR_RUN_URL = `${RUNPOD_ACCELERATOR_BASE}/run`;
const RUNPOD_STATUS_URL = (id: string) => `${RUNPOD_ACCELERATOR_BASE}/status/${id}`;

const ACCELERATOR_MAX_IMAGE_BYTES =
  Number.parseInt(process.env.RUNPOD_ACCELERATOR_MAX_IMAGE_BYTES ?? "", 10) || 700_000;
const ALLOWED_RESOLUTIONS = new Set(["1328x1328", "1664x928"]);

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
  width: OUTPUT_WIDTH,
  height: OUTPUT_HEIGHT,
  batch_size: 1,
  cpu_offload: "disable",
  num_blocks_on_gpu: 40,
  use_pin_memory: "enable",
  prompt: "",
  negative_prompt: "",
  timeout: 180,
};

type GenerationMode = "character" | "background" | "combo";
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;

function resolveDimensions(width?: number, height?: number) {
  if (typeof width === "number" && typeof height === "number") {
    const key = `${width}x${height}`;
    if (ALLOWED_RESOLUTIONS.has(key)) {
      return { width, height };
    }
  }
  return { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
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
  mode?: GenerationMode;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  imageBase64?: string;
  imageUrl?: string;
  backgroundImageBase64?: string;
  backgroundImageUrl?: string;
  character?: CharacterFormValues;
  background?: BackgroundFormValues;
  combo?: ComboFormValues;
  metadata?: Record<string, unknown>;
};

type RunpodInputPayload = typeof DEFAULT_INPUT & {
  image_url?: string;
  background_image_base64?: string;
  mode?: GenerationMode;
  character?: CharacterFormValues;
  background?: BackgroundFormValues;
  combo?: ComboFormValues;
  metadata?: Record<string, unknown>;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: RunpodRequestBody;

  try {
    body = (await request.json()) as RunpodRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { width, height } = resolveDimensions(body.width, body.height);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const negativePrompt = typeof body.negativePrompt === "string" ? body.negativePrompt.trim() : "";

  const payload: RunpodInputPayload = {
    ...DEFAULT_INPUT,
    width,
    height,
    steps: body.steps ?? DEFAULT_INPUT.steps,
    cfg: body.cfg ?? DEFAULT_INPUT.cfg,
    seed:
      typeof body.seed === "number" && Number.isFinite(body.seed)
        ? body.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  };

  const sanitizedImage = sanitizeBase64Image(body.imageBase64);
  let totalImageBytes = 0;
  if (sanitizedImage) {
    payload.image_name = sanitizedImage;
    totalImageBytes += estimateBase64Bytes(sanitizedImage);
  }

  if (typeof body.imageUrl === "string" && body.imageUrl.trim().length > 0) {
    payload.image_url = body.imageUrl.trim();
  }

  if (prompt) {
    payload.prompt = prompt;
  }
  if (negativePrompt) {
    payload.negative_prompt = negativePrompt;
  }
  if (body.character) {
    payload.character = body.character;
  }
  if (body.background) {
    payload.background = body.background;
  }
  if (body.combo) {
    payload.combo = body.combo;
  }

  const sanitizedBackground = sanitizeBase64Image(body.backgroundImageBase64);
  if (sanitizedBackground) {
    payload.background_image_base64 = sanitizedBackground;
    totalImageBytes += estimateBase64Bytes(sanitizedBackground);
  }

  if (body.mode) {
    payload.mode = body.mode;
  }

  if (body.metadata && typeof body.metadata === "object") {
    payload.metadata = body.metadata;
  }

  if (totalImageBytes > ACCELERATOR_MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error:
          "The request payload is too large for the accelerator. Reduce the reference size, disable “Preserve original resolution,” or select the 1328×1328 preset.",
      },
      { status: 413 },
    );
  }

  try {
    const response = await fetch(RUNPOD_ACCELERATOR_RUN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: "Runpod request failed.",
          details: errorText,
          transport: "accelerator",
          status: response.status,
        },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json({
      ...result,
      transport: "accelerator",
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
