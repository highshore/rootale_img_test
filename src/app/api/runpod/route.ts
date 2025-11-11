import { NextRequest, NextResponse } from "next/server";

const RUNPOD_API_URL = "https://api.runpod.ai/v2/ul5kke5ddlrzhi/run";

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

type RunpodRequestBody = {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!process.env.RUNPOD_API_KEY) {
    return NextResponse.json(
      {
        error: "RUNPOD_API_KEY is not configured on the server.",
      },
      { status: 500 },
    );
  }

  let body: RunpodRequestBody;

  try {
    body = (await request.json()) as RunpodRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  if (!body.prompt || body.prompt.trim().length === 0) {
    return NextResponse.json(
      { error: "Prompt is required." },
      { status: 400 },
    );
  }

  const payload = {
    ...DEFAULT_INPUT,
    prompt: body.prompt.trim(),
    negative_prompt: body.negativePrompt?.trim() ?? DEFAULT_INPUT.negative_prompt,
    width: body.width ?? DEFAULT_INPUT.width,
    height: body.height ?? DEFAULT_INPUT.height,
    steps: body.steps ?? DEFAULT_INPUT.steps,
    cfg: body.cfg ?? DEFAULT_INPUT.cfg,
    seed:
      typeof body.seed === "number" && Number.isFinite(body.seed)
        ? body.seed
        : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  };

  try {
    const response = await fetch(RUNPOD_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({ input: payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Runpod request failed.", details: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Runpod proxy error:", error);
    return NextResponse.json(
      { error: "Unexpected error communicating with Runpod." },
      { status: 500 },
    );
  }
}

