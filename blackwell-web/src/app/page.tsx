'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import {
  ClockIcon,
  DocumentTextIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  ServerIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
  ATMOSPHERE_OPTIONS,
  BACKGROUND_STYLE_OPTIONS,
  CharacterFormValues,
  CHARACTER_STYLE_OPTIONS,
  ComboFormValues,
  DEFAULT_BACKGROUND_FORM,
  DEFAULT_CHARACTER_FORM,
  DEFAULT_COMBO_FORM,
  ENVIRONMENT_TYPE_OPTIONS,
  FOCAL_ELEMENT_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  LIGHTING_OPTIONS,
  NONE_OPTION,
  BackgroundFormValues,
  EYE_COLOR_OPTIONS,
  EXPRESSION_OPTIONS,
  PALETTE_OPTIONS,
  POSE_OPTIONS,
  TIME_OF_DAY_OPTIONS,
} from "@/lib/generation";

type GenerationMode = "character" | "background" | "combo";

type RunpodJobMetadata = {
  id?: string;
  status?: string;
  streamId?: string;
  delayTime?: number;
  executionTime?: number;
  estimatedTime?: number;
  transport?: string;
  [key: string]: unknown;
};

type RunpodJobResponse = {
  id?: string;
  status?: string;
  output?: unknown;
  delayTime?: number;
  executionTime?: number;
  estimatedTime?: number;
  streamId?: string;
  input?: unknown;
  imageUrl?: string;
  image_url?: string;
  transport?: string;
  [key: string]: unknown;
};

type ReferenceSlotKey = "character" | "background";

type ReferenceSlot = {
  dataUrl: string | null;
  preserveOriginal: boolean;
  rawFile: File | null;
  byteEstimate: number;
};

type ReferencePayload = {
  imageBase64?: string;
};

type ProcessedImage = {
  dataUrl: string;
  blob: Blob;
};

type CharacterFormState = CharacterFormValues;
type BackgroundFormState = BackgroundFormValues;
type ComboFormState = ComboFormValues;

type SubmissionPayload = {
  mode: GenerationMode;
  width: number;
  height: number;
  character?: CharacterFormValues;
  background?: BackgroundFormValues;
  combo?: ComboFormValues;
  imageBase64?: string;
  backgroundImageBase64?: string;
  [key: string]: unknown;
};

const REFERENCE_MAX_DIMENSION = 1536;
const MAX_INLINE_IMAGE_BYTES = 320_000;
const ACCELERATOR_PAYLOAD_LIMIT = 700_000;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const STEPS = 2;
const CFG = 1;

const MODE_COPY: Record<GenerationMode, string> = {
  character: "Design hero characters with cinematic lighting and production-ready detail.",
  background: "Paint atmospheric establishing shots that match the show's palette and depth cues.",
  combo: "Blend a keyed character with a staged background for storyboard-ready stills.",
};

const SUBMIT_LABELS: Record<GenerationMode, string> = {
  character: "Generate Character",
  background: "Generate Background",
  combo: "Merge Character + Background",
};

const RESOLUTION_OPTIONS = [
  {
    key: "square",
    label: "Square 1328 × 1328",
    width: 1328,
    height: 1328,
    description: "Even 1:1 hero boards for character callouts.",
  },
  {
    key: "wide",
    label: "Cinematic 1664 × 928",
    width: 1664,
    height: 928,
    description: "16:9 establishing frames for story beats.",
  },
] as const;

type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];
type ResolutionKey = ResolutionOption["key"];

const RESOLUTION_OPTION_MAP: Record<ResolutionKey, ResolutionOption> = RESOLUTION_OPTIONS.reduce(
  (map, option) => {
    map[option.key] = option;
    return map;
  },
  {} as Record<ResolutionKey, ResolutionOption>,
);

const PSEUDO_REFERENCE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAn0B9lqQ+wAAAABJRU5ErkJggg==";
const PSEUDO_REFERENCE_BYTES = estimateBase64Bytes(PSEUDO_REFERENCE_BASE64);

const TAB_CONFIG: { key: GenerationMode; label: string }[] = [
  { key: "character", label: "Character Generation" },
  { key: "background", label: "Background Generation" },
  { key: "combo", label: "Character + Background" },
];

const createReferenceSlot = (): ReferenceSlot => ({
  dataUrl: null,
  preserveOriginal: true,
  rawFile: null,
  byteEstimate: 0,
});

function extractBase64Image(output: unknown, depth = 0): string | null {
  if (!output || depth > 5) {
    return null;
  }

  if (typeof output === "string") {
    const sanitized = output.startsWith("data:")
      ? output.split(",")[1] ?? ""
      : output.replace(/\s/g, "");

    if (
      sanitized.length > 100 &&
      sanitized.length % 4 === 0 &&
      /^[A-Za-z0-9+/=]+$/.test(sanitized)
    ) {
      return sanitized;
    }
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
    for (const value of Object.values(output as Record<string, unknown>)) {
      const result = extractBase64Image(value, depth + 1);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function redactLargeStrings(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    const compact = value.replace(/\s/g, "");
    if (compact.length > 200 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
      return "[omitted large string]";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLargeStrings(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactLargeStrings(entry, depth + 1),
      ]),
    );
  }

  return value;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as data URL."));
      }
    };
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.Image === "undefined") {
      reject(new Error("Image constructor is not available in this environment."));
      return;
    }
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image."));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Unable to convert canvas to Blob."));
        }
      },
      type,
      quality,
    );
  });
}

function estimateBase64Bytes(base64: string) {
  return Math.floor((base64.length * 3) / 4);
}

function estimateDataUrlBytes(dataUrl: string | null) {
  if (typeof dataUrl !== "string") {
    return 0;
  }
  const [, base64] = dataUrl.split(",");
  const payload = base64 ?? dataUrl;
  return estimateBase64Bytes(payload);
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function renderImageVariant(
  image: HTMLImageElement,
  width: number,
  height: number,
  mime: string,
  quality?: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire drawing context.");
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, mime, quality);
  const dataUrl = canvas.toDataURL(mime, quality);
  return { blob, dataUrl };
}

async function prepareImagePayload(
  file: File,
  maxDimension: number,
  preserveOriginal: boolean,
  maxInlineBytes?: number,
): Promise<ProcessedImage> {
  const baseDataUrl = await readFileAsDataUrl(file);
  if (preserveOriginal || typeof maxInlineBytes !== "number") {
    return { dataUrl: baseDataUrl, blob: file };
  }

  try {
    const image = await loadImageElement(baseDataUrl);
    const largestSide = Math.max(image.width, image.height);
    const initialScale = largestSide > maxDimension && largestSide > 0 ? maxDimension / largestSide : 1;
    let currentWidth = Math.max(64, Math.round(image.width * initialScale));
    let currentHeight = Math.max(64, Math.round(image.height * initialScale));
    const normalizedType = typeof file.type === "string" ? file.type.toLowerCase() : "";
    const initialMime =
      normalizedType.startsWith("image/") && !normalizedType.includes("gif") ? normalizedType : "image/jpeg";
    const workingMime = initialMime.includes("png") ? "image/jpeg" : initialMime;
    let quality = workingMime === "image/jpeg" ? 0.92 : undefined;
    let lastRender: ProcessedImage = { dataUrl: baseDataUrl, blob: file };

    while (currentWidth >= 64 && currentHeight >= 64) {
      const { blob, dataUrl } = await renderImageVariant(image, currentWidth, currentHeight, workingMime, quality);
      lastRender = { blob, dataUrl };
      const base64 = dataUrl.split(",")[1] ?? "";
      const bytes = estimateBase64Bytes(base64);
      if (bytes <= maxInlineBytes) {
        return lastRender;
      }

      if (workingMime === "image/jpeg" && typeof quality === "number" && quality > 0.55) {
        quality = Math.max(0.55, quality - 0.07);
        continue;
      }

      currentWidth = Math.max(64, Math.round(currentWidth * 0.85));
      currentHeight = Math.max(64, Math.round(currentHeight * 0.85));
      if (currentWidth <= 128 || currentHeight <= 128) {
        break;
      }
    }

    return lastRender;
  } catch (error) {
    console.warn("Image normalization failed, falling back to original data URL.", error);
    return { dataUrl: baseDataUrl, blob: file };
  }
}

function extractBase64FromDataUrl(dataUrl?: string | null): string | null {
  if (!dataUrl) {
    return null;
  }
  const [, encoded] = dataUrl.split(",");
  const trimmed = (encoded ?? dataUrl).trim();
  return trimmed || null;
}

function parseSeedInput(value: string): { value?: number; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    return { error: "Seed must be a whole number." };
  }
  return { value: parsed };
}

export default function Home() {
  const [activeMode, setActiveMode] = useState<GenerationMode>("character");
  const [resolutionKey, setResolutionKey] = useState<ResolutionKey>("wide");
  const [characterForm, setCharacterForm] = useState<CharacterFormState>({ ...DEFAULT_CHARACTER_FORM });
  const [backgroundForm, setBackgroundForm] = useState<BackgroundFormState>({ ...DEFAULT_BACKGROUND_FORM });
  const [comboForm, setComboForm] = useState<ComboFormState>({ ...DEFAULT_COMBO_FORM });
  const [referenceSlots, setReferenceSlots] = useState<Record<ReferenceSlotKey, ReferenceSlot>>({
    character: createReferenceSlot(),
    background: createReferenceSlot(),
  });
  const [job, setJob] = useState<RunpodJobResponse | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const fileInputs = useRef<Record<ReferenceSlotKey, HTMLInputElement | null>>({
    character: null,
    background: null,
  });
  const currentResolution = RESOLUTION_OPTION_MAP[resolutionKey] ?? RESOLUTION_OPTIONS[0];
  const selectedWidth = currentResolution.width;
  const selectedHeight = currentResolution.height;
  const resolutionLabel = `${selectedWidth}×${selectedHeight}`;

  const isBusy = loading || polling;

  const jobMeta = useMemo<RunpodJobMetadata | null>(() => {
    if (!job) {
      return null;
    }
    return {
      id: job.id,
      status: job.status,
      streamId: job.streamId,
      delayTime: job.delayTime,
      executionTime: job.executionTime,
      estimatedTime: job.estimatedTime,
      transport:
        (typeof job.transport === "string" && job.transport) ||
        (typeof job["transport"] === "string" ? (job["transport"] as string) : undefined),
    };
  }, [job]);

  const jobMetaEntries = useMemo(
    () =>
      jobMeta
        ? Object.entries(jobMeta).filter(([, value]) => value !== undefined && value !== null)
        : [],
    [jobMeta],
  );

  const jobDisplayPayload = useMemo(() => (job ? redactLargeStrings(job) : null), [job]);

  const elapsedLabel = useMemo(() => {
    if (!submittedAt || !completedAt || !imageDataUrl) {
      return null;
    }

    const elapsed = (completedAt - submittedAt) / 1000;
    if (elapsed < 0) {
      return null;
    }

    return `${elapsed.toFixed(1)}s`;
  }, [submittedAt, completedAt, imageDataUrl]);

  const resolvePreviewFromPayload = useCallback(async (payload: RunpodJobResponse) => {
    const immediateUrl =
      (typeof payload.imageUrl === "string" && payload.imageUrl.trim()) ||
      (typeof payload.image_url === "string" && payload.image_url.trim());
    if (immediateUrl) {
      return immediateUrl;
    }

    const base64 = extractBase64Image(payload.output);
    if (base64) {
      return `data:image/png;base64,${base64}`;
    }
    return null;
  }, []);

  const updateReferenceSlot = useCallback((slot: ReferenceSlotKey, patch: Partial<ReferenceSlot>) => {
    setReferenceSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], ...patch },
    }));
  }, []);

  const processReferenceFile = useCallback(
    async (slot: ReferenceSlotKey, file: File, options?: { preserve?: boolean }) => {
      const preserve = options?.preserve ?? referenceSlots[slot].preserveOriginal;
      const processed = await prepareImagePayload(file, REFERENCE_MAX_DIMENSION, preserve, MAX_INLINE_IMAGE_BYTES);
      const byteEstimate = estimateDataUrlBytes(processed.dataUrl);
      updateReferenceSlot(slot, {
        rawFile: file,
        preserveOriginal: preserve,
        dataUrl: processed.dataUrl,
        byteEstimate,
      });
    },
    [referenceSlots, updateReferenceSlot],
  );

  const handleSlotFileChange = async (slot: ReferenceSlotKey, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      updateReferenceSlot(slot, { dataUrl: null, rawFile: null, byteEstimate: 0 });
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      event.target.value = "";
          return;
        }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Reference images must be 8MB or smaller.");
      event.target.value = "";
          return;
        }

    try {
      await processReferenceFile(slot, file);
      setError(null);
    } catch (processingError) {
      console.error("Image processing failed:", processingError);
      setError("We couldn't process the selected file. Try another image.");
      event.target.value = "";
    }
  };

  const clearReference = (slot: ReferenceSlotKey) => {
    updateReferenceSlot(slot, { dataUrl: null, rawFile: null, byteEstimate: 0 });
    const input = fileInputs.current[slot];
    if (input) {
      input.value = "";
          }
  };

  const handleTogglePreserve = async (slot: ReferenceSlotKey) => {
    const next = !referenceSlots[slot].preserveOriginal;
    updateReferenceSlot(slot, { preserveOriginal: next });
    const rawFile = referenceSlots[slot].rawFile;
    if (rawFile) {
      try {
        await processReferenceFile(slot, rawFile, { preserve: next });
      } catch (toggleError) {
        console.error("Image reprocessing failed:", toggleError);
        setError("We couldn't process the selected file. Try another image.");
      }
    }
  };

  const getReferencePayload = useCallback(
    (slot: ReferenceSlotKey, options?: { fallback?: boolean }): ReferencePayload => {
      const slotState = referenceSlots[slot];
      const inline = extractBase64FromDataUrl(slotState.dataUrl);
      if (inline) {
        return { imageBase64: inline };
        }
      if (options?.fallback) {
        return { imageBase64: PSEUDO_REFERENCE_BASE64 };
      }
      return {};
    },
    [referenceSlots],
  );

  type BuildResult = { body: Record<string, unknown> } | { error: string };

  const buildCharacterSubmission = (): BuildResult => {
    if (!characterForm.concept.trim()) {
      return { error: "Describe the character you want to generate." };
          }
    const { value: seedValue, error: seedError } = parseSeedInput(characterForm.seed);
    if (seedError) {
      return { error: seedError };
    }
    const reference = getReferencePayload("character", { fallback: true });
    const backgroundReference = getReferencePayload("background", { fallback: true });

    const body: Record<string, unknown> = {
      mode: "character",
      character: characterForm,
      steps: STEPS,
      cfg: CFG,
      seed: seedValue,
      metadata: {
        resolution: resolutionLabel,
        wardrobe: characterForm.wardrobe || undefined,
        pose: characterForm.pose || undefined,
        lighting: characterForm.lighting || undefined,
        style: characterForm.style !== NONE_OPTION ? characterForm.style : undefined,
      },
    };

    if (reference.imageBase64) {
      body.imageBase64 = reference.imageBase64;
    }
    if (backgroundReference.imageBase64) {
      body.backgroundImageBase64 = backgroundReference.imageBase64;
    }
    return { body };
  };

  const buildBackgroundSubmission = (): BuildResult => {
    if (!backgroundForm.location.trim()) {
      return { error: "Describe the environment you want to generate." };
          }
    const { value: seedValue, error: seedError } = parseSeedInput(backgroundForm.seed);
    if (seedError) {
      return { error: seedError };
    }
    const reference = getReferencePayload("background", { fallback: true });
    const characterReference = getReferencePayload("character", { fallback: true });

    const body: Record<string, unknown> = {
      mode: "background",
      background: backgroundForm,
      steps: STEPS,
      cfg: CFG,
      seed: seedValue,
      metadata: {
        resolution: resolutionLabel,
        palette: backgroundForm.palette || undefined,
        environmentType: backgroundForm.environmentType || undefined,
        focalElement: backgroundForm.focalElement || undefined,
        atmosphere: backgroundForm.atmosphere || undefined,
        timeOfDay: backgroundForm.timeOfDay || undefined,
        style: backgroundForm.style !== NONE_OPTION ? backgroundForm.style : undefined,
      },
    };

    if (characterReference.imageBase64) {
      body.imageBase64 = characterReference.imageBase64;
    }
    if (reference.imageBase64) {
      body.backgroundImageBase64 = reference.imageBase64;
    }
    return { body };
  };

  const buildComboSubmission = (): BuildResult => {
    if (!comboForm.characterDescription.trim()) {
      return { error: "Describe the character for the combo frame." };
    }
    if (!comboForm.backgroundDescription.trim()) {
      return { error: "Describe the background for the combo frame." };
    }
    const { value: seedValue, error: seedError } = parseSeedInput(comboForm.seed);
    if (seedError) {
      return { error: seedError };
    }

    const characterReference = getReferencePayload("character");
    const backgroundReference = getReferencePayload("background");

    const hasCharacterRef = Boolean(characterReference.imageBase64);
    const hasBackgroundRef = Boolean(backgroundReference.imageBase64);

    if (!hasCharacterRef) {
      return { error: "Upload a character reference before running the combo mode." };
    }
    if (!hasBackgroundRef) {
      return { error: "Upload a background reference before running the combo mode." };
    }

    const body: Record<string, unknown> = {
      mode: "combo",
      combo: comboForm,
      steps: STEPS,
      cfg: CFG,
      seed: seedValue,
      metadata: {
        resolution: resolutionLabel,
        interaction: comboForm.interaction || undefined,
      },
    };

    if (characterReference.imageBase64) {
      body.imageBase64 = characterReference.imageBase64;
    }
    if (backgroundReference.imageBase64) {
      body.backgroundImageBase64 = backgroundReference.imageBase64;
    }

    return { body };
  };

  const builders: Record<GenerationMode, () => BuildResult> = {
    character: buildCharacterSubmission,
    background: buildBackgroundSubmission,
    combo: buildComboSubmission,
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const result = builders[activeMode]();
    if ("error" in result) {
      setError(result.error);
      return;
    }

    const requestBody: SubmissionPayload = {
      ...result.body,
      mode: activeMode,
      width: selectedWidth,
      height: selectedHeight,
    };

    const inlineBytes =
      typeof requestBody.imageBase64 === "string" ? estimateBase64Bytes(requestBody.imageBase64) : 0;
    const backgroundBytes =
      typeof requestBody.backgroundImageBase64 === "string"
        ? estimateBase64Bytes(requestBody.backgroundImageBase64)
        : 0;
    const totalBytes = inlineBytes + backgroundBytes;
    if (totalBytes > ACCELERATOR_PAYLOAD_LIMIT) {
      setError(
        `Your references total ~${formatBytes(totalBytes)}, which exceeds the accelerator limit (~${formatBytes(
          ACCELERATOR_PAYLOAD_LIMIT,
        )}). Disable “Preserve original resolution”, pick the square preset, or upload smaller files.`,
      );
      return;
    }

    setLoading(true);
    setError(null);
    setJob(null);
    setImageDataUrl(null);
    setActiveJobId(null);
    setPolling(false);
    setSubmittedAt(Date.now());
    setCompletedAt(null);

    try {
      const response = await fetch("/api/runpod", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let responseError: string | undefined;
        let details: string | undefined;
        try {
          const payload = await response.json();
          responseError = payload?.error;
          details = payload?.details;
        } catch {
          details = await response.text();
        }
        if (response.status === 413) {
          setError("The request was too large for the accelerator. Disable “Preserve original resolution.” or pick a smaller file.");
        } else {
        setError(
            responseError ?? "The Runpod endpoint returned an unexpected error. Check the server logs for details.",
        );
        }
        if (details) {
          console.error("Runpod error details:", details);
        }
        setPolling(false);
        setActiveJobId(null);
        setCompletedAt(null);
        return;
      }

      const payload: RunpodJobResponse = await response.json();
      setJob(payload);

      const status = payload.status?.toUpperCase();

      if (status && ["COMPLETED", "FINISHED", "SUCCESS"].includes(status)) {
        const previewUrl = await resolvePreviewFromPayload(payload);
        if (previewUrl) {
          setImageDataUrl(previewUrl);
          setCompletedAt(Date.now());
        } else {
          setCompletedAt(null);
        }
        setPolling(false);
        setActiveJobId(null);
        return;
      }

      if (!payload.id) {
        setPolling(false);
        setActiveJobId(null);
        setCompletedAt(null);
        setError("Runpod did not return a job id to poll.");
        return;
      }

      setActiveJobId(payload.id);
    } catch (fetchError) {
      console.error(fetchError);
      setError("Unable to reach the Runpod endpoint. Try again shortly.");
      setPolling(false);
      setActiveJobId(null);
      setCompletedAt(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeJobId) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/runpod?id=${activeJobId}`, {
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (!response.ok) {
          const { error: responseError } = await response.json();
          if (!cancelled) {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            setError(responseError ?? "Failed to fetch job status from Runpod.");
            setPolling(false);
            setActiveJobId(null);
            setCompletedAt(null);
          }
          return;
        }

        const payload: RunpodJobResponse = await response.json();
        if (cancelled) {
          return;
        }

        setJob(payload);

        const status = payload.status?.toUpperCase();

        if (status && ["COMPLETED", "FINISHED", "SUCCESS"].includes(status)) {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          setPolling(false);
          setActiveJobId(null);
          const previewUrl = await resolvePreviewFromPayload(payload);
          if (previewUrl) {
            setImageDataUrl(previewUrl);
            setCompletedAt(Date.now());
          } else {
            setCompletedAt(null);
          }
          return;
        }

        if (status && ["FAILED", "ERROR", "CANCELLED"].includes(status)) {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          setPolling(false);
          setActiveJobId(null);
          setCompletedAt(null);
          setError("Runpod reported the job as failed. Inspect the raw payload for details.");
          return;
        }

        timeoutId = setTimeout(poll, 2000);
      } catch (pollError) {
        if (!cancelled) {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          console.error("Polling error:", pollError);
          setError("Error while polling job status. See console for details.");
          setPolling(false);
          setActiveJobId(null);
          setCompletedAt(null);
        }
      }
    };

    setPolling(true);
    poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [activeJobId, resolvePreviewFromPayload]);

  const renderModeFields = () => {
    switch (activeMode) {
      case "character":
  return (
          <div className="space-y-4">
            <div>
              <label htmlFor="characterConcept" className="text-sm font-semibold text-slate-700">
                Hero concept
              </label>
              <textarea
                id="characterConcept"
                value={characterForm.concept}
                onChange={(event) => setCharacterForm((prev) => ({ ...prev, concept: event.target.value }))}
                className="mt-2 h-28 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Silhouette, archetype, personality beats"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="hairStyle" className="text-sm font-medium text-slate-700">
                  Hair style
                </label>
                <select
                  id="hairStyle"
                  value={characterForm.hairStyle}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, hairStyle: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {HAIR_STYLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
          </div>
              <div>
                <label htmlFor="hairColor" className="text-sm font-medium text-slate-700">
                  Hair color
                </label>
                <select
                  id="hairColor"
                  value={characterForm.hairColor}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, hairColor: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {HAIR_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
            </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="eyeColor" className="text-sm font-medium text-slate-700">
                  Eye color
                </label>
                <select
                  id="eyeColor"
                  value={characterForm.eyeColor}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, eyeColor: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {EYE_COLOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
          </div>
              <div>
                <label htmlFor="expression" className="text-sm font-medium text-slate-700">
                  Expression
                </label>
                <select
                  id="expression"
                  value={characterForm.expression}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, expression: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
          >
                  {EXPRESSION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
            <div>
                <label htmlFor="pose" className="text-sm font-medium text-slate-700">
                  Pose / camera
                </label>
                <select
                  id="pose"
                  value={characterForm.pose}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, pose: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {POSE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lighting" className="text-sm font-medium text-slate-700">
                  Lighting preset
                </label>
                <select
                  id="lighting"
                  value={characterForm.lighting}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, lighting: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {LIGHTING_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="characterWardrobe" className="text-sm font-medium text-slate-700">
                  Wardrobe / materials
                </label>
                <input
                  id="characterWardrobe"
                  type="text"
                  value={characterForm.wardrobe}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, wardrobe: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                  placeholder="Fabric, armor, motifs"
                />
              </div>
              <div>
                <label htmlFor="characterProps" className="text-sm font-medium text-slate-700">
                  Props / tech
                </label>
                <input
                  id="characterProps"
                  type="text"
                  value={characterForm.props}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, props: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                  placeholder="Weapons, gadgets, companions"
                />
              </div>
            </div>
            <div>
              <label htmlFor="characterStyle" className="text-sm font-medium text-slate-700">
                Style / finish
              </label>
              <select
                id="characterStyle"
                value={characterForm.style}
                onChange={(event) => setCharacterForm((prev) => ({ ...prev, style: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
              >
                {CHARACTER_STYLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Choose a rendering style or leave it as {NONE_OPTION} to let the worker decide.</p>
            </div>
            <div>
              <label htmlFor="characterNegative" className="text-sm font-medium text-slate-700">
                Negative prompt additions
              </label>
              <textarea
                id="characterNegative"
                value={characterForm.negative}
                onChange={(event) => setCharacterForm((prev) => ({ ...prev, negative: event.target.value }))}
                className="mt-2 h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Optional: add things to avoid"
              />
            </div>
            <div>
              <label htmlFor="characterSeed" className="text-sm font-medium text-slate-700">
                Seed (optional)
              </label>
              <input
                id="characterSeed"
                type="text"
                inputMode="numeric"
                value={characterForm.seed}
                onChange={(event) => setCharacterForm((prev) => ({ ...prev, seed: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Leave blank for random"
              />
            </div>
          </div>
        );
      case "background":
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="backgroundLocation" className="text-sm font-semibold text-slate-700">
                Environment description
              </label>
              <textarea
                id="backgroundLocation"
                value={backgroundForm.location}
                onChange={(event) => setBackgroundForm((prev) => ({ ...prev, location: event.target.value }))}
                className="mt-2 h-28 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Location, era, structural cues"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
            <div>
                <label htmlFor="environmentType" className="text-sm font-medium text-slate-700">
                  Environment type
                </label>
                <select
                  id="environmentType"
                  value={backgroundForm.environmentType}
                  onChange={(event) =>
                    setBackgroundForm((prev) => ({ ...prev, environmentType: event.target.value }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {ENVIRONMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="focalElement" className="text-sm font-medium text-slate-700">
                  Focal element
                </label>
                <select
                  id="focalElement"
                  value={backgroundForm.focalElement}
                  onChange={(event) => setBackgroundForm((prev) => ({ ...prev, focalElement: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {FOCAL_ELEMENT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="backgroundPalette" className="text-sm font-medium text-slate-700">
                  Color palette
                </label>
                <select
                  id="backgroundPalette"
                  value={backgroundForm.palette}
                  onChange={(event) => setBackgroundForm((prev) => ({ ...prev, palette: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {PALETTE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="timeOfDay" className="text-sm font-medium text-slate-700">
                  Time of day
                </label>
                <select
                  id="timeOfDay"
                  value={backgroundForm.timeOfDay}
                  onChange={(event) => setBackgroundForm((prev) => ({ ...prev, timeOfDay: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {TIME_OF_DAY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="backgroundAtmosphere" className="text-sm font-medium text-slate-700">
                Atmosphere & depth
              </label>
              <select
                id="backgroundAtmosphere"
                value={backgroundForm.atmosphere}
                onChange={(event) => setBackgroundForm((prev) => ({ ...prev, atmosphere: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
              >
                {ATMOSPHERE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="backgroundStyle" className="text-sm font-medium text-slate-700">
                Style / finish
              </label>
              <select
                id="backgroundStyle"
                value={backgroundForm.style}
                onChange={(event) => setBackgroundForm((prev) => ({ ...prev, style: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
              >
                {BACKGROUND_STYLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Select a rendering style or choose {NONE_OPTION} to omit it.</p>
            </div>
            <div>
              <label htmlFor="backgroundNegative" className="text-sm font-medium text-slate-700">
                Negative prompt additions
              </label>
              <textarea
                id="backgroundNegative"
                value={backgroundForm.negative}
                onChange={(event) => setBackgroundForm((prev) => ({ ...prev, negative: event.target.value }))}
                className="mt-2 h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Optional: add things to avoid"
              />
            </div>
            <div>
              <label htmlFor="backgroundSeed" className="text-sm font-medium text-slate-700">
                Seed (optional)
              </label>
              <input
                id="backgroundSeed"
                type="text"
                inputMode="numeric"
                value={backgroundForm.seed}
                onChange={(event) => setBackgroundForm((prev) => ({ ...prev, seed: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Leave blank for random"
              />
            </div>
          </div>
        );
      case "combo":
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="comboCharacter" className="text-sm font-semibold text-slate-700">
                Character description
              </label>
              <textarea
                id="comboCharacter"
                value={comboForm.characterDescription}
                onChange={(event) =>
                  setComboForm((prev) => ({ ...prev, characterDescription: event.target.value }))
                }
                className="mt-2 h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Hero pose, attire, expression"
                required
              />
            </div>
            <div>
              <label htmlFor="comboBackground" className="text-sm font-semibold text-slate-700">
                Background description
              </label>
              <textarea
                id="comboBackground"
                value={comboForm.backgroundDescription}
                onChange={(event) =>
                  setComboForm((prev) => ({ ...prev, backgroundDescription: event.target.value }))
                }
                className="mt-2 h-24 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Environment, time of day, key props"
                required
              />
            </div>
            <div>
              <label htmlFor="comboInteraction" className="text-sm font-medium text-slate-700">
                Interaction / action
              </label>
              <input
                id="comboInteraction"
                type="text"
                value={comboForm.interaction}
                onChange={(event) => setComboForm((prev) => ({ ...prev, interaction: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="How the character engages with the set"
              />
            </div>
            <div>
              <label htmlFor="comboNegative" className="text-sm font-medium text-slate-700">
                Negative prompt additions
              </label>
              <textarea
                id="comboNegative"
                value={comboForm.negative}
                onChange={(event) => setComboForm((prev) => ({ ...prev, negative: event.target.value }))}
                className="mt-2 h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Optional: add things to avoid"
              />
            </div>
            <div>
              <label htmlFor="comboSeed" className="text-sm font-medium text-slate-700">
                Seed (optional)
              </label>
              <input
                id="comboSeed"
                type="text"
                inputMode="numeric"
                value={comboForm.seed}
                onChange={(event) => setComboForm((prev) => ({ ...prev, seed: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Leave blank for random"
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderReferenceUploader = (
    slot: ReferenceSlotKey,
    {
      title,
      helper,
      required,
    }: {
      title: string;
      helper: string;
      required?: boolean;
    },
  ) => {
    const slotState = referenceSlots[slot];
    const inputId = `${slot}-reference`;
    const hasData = Boolean(slotState.dataUrl);
    const exceedsTarget = hasData && slotState.byteEstimate > MAX_INLINE_IMAGE_BYTES;
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-inner">
                      <PhotoIcon className="h-5 w-5" />
                    </span>
                    <div>
              <p className="text-sm font-semibold text-slate-700">
                {title}
                {required && (
                  <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-600">
                    Required
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">{helper}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
              id={inputId}
              ref={(node) => {
                fileInputs.current[slot] = node;
              }}
                      type="file"
                      className="hidden"
              accept="image/*"
              onChange={(event) => handleSlotFileChange(slot, event)}
                    />
                    <button
                      type="button"
              onClick={() => fileInputs.current[slot]?.click()}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-700"
                    >
              Browse…
                    </button>
            {slotState.dataUrl && (
                      <button
                        type="button"
                onClick={() => clearReference(slot)}
                        className="inline-flex items-center gap-1 rounded-lg border border-transparent bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
        <div className="mt-3 space-y-1 text-xs">
          {hasData ? (
            <>
              <p className={exceedsTarget ? "text-rose-600" : "text-slate-500"}>
                Current payload: ~{formatBytes(slotState.byteEstimate)}{" "}
                {exceedsTarget ? "(above the 320 KB target—consider disabling preserve)" : "(within range)"}
              </p>
              <p className="text-slate-500">Remove it above to fall back to the pseudo placeholder.</p>
            </>
          ) : required ? (
            <p className="text-rose-600">Upload an image—combo mode can’t run without this slot.</p>
          ) : (
            <p className="text-slate-500">
              Leave this empty and we’ll send a tiny placeholder (~{formatBytes(PSEUDO_REFERENCE_BYTES)}).
            </p>
          )}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              checked={slotState.preserveOriginal}
              onChange={() => handleTogglePreserve(slot)}
            />
            Preserve original resolution
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Disable to auto-downscale to ≤{REFERENCE_MAX_DIMENSION}px and compress to ~320 KB so the accelerator stays
            happy.
          </p>
        </div>
        {slotState.dataUrl ? (
          <div className="relative mt-4 aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-950/80">
            <NextImage
              src={slotState.dataUrl}
              alt={`${title} preview`}
                        fill
              sizes="(min-width: 1024px) 320px, 100vw"
                        className="object-contain"
                        unoptimized
                      />
                  </div>
                ) : (
          <p className="mt-4 text-xs text-slate-400">No reference selected yet.</p>
                )}
              </div>
    );
  };

  const requireCharacterReference = activeMode === "combo";
  const requireBackgroundReference = activeMode === "combo";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-12">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 text-slate-800">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <SparklesIcon className="h-6 w-6" />
            </span>
              <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Blackwell Generation APIs</h1>
              <p className="mt-1 text-sm text-slate-500 sm:text-base">
                Character, background, and combo flows ride the AWS accelerator—select a square or cinematic preset
                before submitting (currently {resolutionLabel}).
              </p>
              </div>
              </div>
          <div className="flex flex-col gap-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <ServerIcon className="h-5 w-5" />
                <span>Endpoint: ul5kke5ddlrzhi</span>
              </div>
              <div className="flex items-center gap-2">
                <PhotoIcon className="h-5 w-5" />
                <span>Resolution: {resolutionLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5" />
                <span>Timeout: 180s</span>
              </div>
            </div>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              <DocumentTextIcon className="h-4 w-4" />
              API Docs
            </Link>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-slate-700">Choose an API</p>
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Generation modes">
                  {TAB_CONFIG.map((tab) => {
                    const isActive = activeMode === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                          isActive
                            ? "bg-slate-900 text-white shadow"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                        onClick={() => setActiveMode(tab.key)}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
              </div>
                <p className="text-sm text-slate-500">{MODE_COPY[activeMode]}</p>
                <p className="text-xs text-slate-400">
                  Switch tabs to jump between prompt templates—combo mode requires both reference uploads. Use the
                  dropdown below to toggle between square (1328×1328) and cinematic (1664×928) presets. Current
                  selection: {resolutionLabel}.
                </p>
              <div>
                  <label htmlFor="resolution" className="text-sm font-semibold text-slate-700">
                    Resolution preset
                </label>
                <select
                    id="resolution"
                    value={resolutionKey}
                    onChange={(event) => setResolutionKey(event.target.value as ResolutionKey)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                    {RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                    </option>
                  ))}
                </select>
                  <p className="mt-1 text-xs text-slate-400">{currentResolution.description}</p>
              </div>
            </div>
              {renderModeFields()}
            </div>
            <div className="space-y-4">
              {activeMode !== "background" &&
                renderReferenceUploader("character", {
                  title: "Character reference",
                  helper: requireCharacterReference
                    ? "Required: upload a keyed hero plate to align likeness."
                    : "Optional: upload a pose, cleaned plate, or sketch to anchor likeness.",
                  required: requireCharacterReference,
                })}
              {activeMode !== "character" &&
                renderReferenceUploader("background", {
                  title: "Background reference",
                  helper: requireBackgroundReference
                    ? "Required: upload the layout plate you want to merge with the hero."
                    : "Optional: upload layout or color script images to steer the environment.",
                  required: requireBackgroundReference,
                })}
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isBusy}
              className="group flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-60"
            >
              {isBusy ? (
                <ArrowPathIcon className="h-5 w-5 animate-spin" />
              ) : (
                <PaperAirplaneIcon className="h-5 w-5 transition group-hover:translate-x-1" />
              )}
              {loading
                ? "Submitting..."
                : polling
                  ? "Waiting on Runpod..."
                  : SUBMIT_LABELS[activeMode]}
            </button>
          </form>

          <aside className="flex flex-col gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">
                Generated Image
                {elapsedLabel && (
                  <span className="ml-2 text-sm font-medium text-slate-400">({elapsedLabel})</span>
                )}
              </h2>
              {imageDataUrl ? (
                <div className="relative mt-4 aspect-video overflow-hidden rounded-xl border border-slate-200 bg-slate-900/80">
                  <NextImage
                    src={imageDataUrl}
                    alt="Generated result"
                    fill
                    sizes="(min-width: 1024px) 400px, 100vw"
                    className="object-contain"
                    unoptimized
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  Submit a prompt to generate an image. We’ll display the first completed render as soon as Runpod returns
                  it.
                </p>
              )}
              {polling && (
                <p className="mt-3 text-xs text-slate-400">Polling Runpod for the latest output…</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">Job Metadata</h2>
              <p className="mt-2 text-sm text-slate-500">
                Submit a prompt to see response metadata from Runpod. We return the raw job payload so you can track
                status or fetch results later.
              </p>
              <div className="mt-6 space-y-3">
                {(loading || polling) && (
                  <div className="text-sm text-slate-500">
                    {loading
                      ? "Submitting job to Runpod..."
                      : `Polling Runpod for updates${activeJobId ? ` (job ${activeJobId})` : ""}...`}
                  </div>
                )}
                {!loading && !polling && !job && (
                  <div className="text-sm text-slate-400">Nothing yet. Fill in the form and submit to start a run.</div>
                )}
                {job &&
                  (jobMetaEntries.length > 0 ? (
                    <dl className="space-y-3 text-sm text-slate-600">
                      {jobMetaEntries.map(([key, value]) => {
                        const displayValue =
                          typeof value === "number" && Number.isFinite(value)
                            ? value.toString()
                            : String(value);

                        return (
                          <div
                            key={key}
                            className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3"
                          >
                            <dt className="capitalize text-slate-500">{key}</dt>
                            <dd className="max-w-[60%] truncate font-medium text-slate-800">{displayValue}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : (
                    <div className="text-sm text-slate-400">
                      Runpod acknowledged the job but did not return timing metadata yet.
                    </div>
                  ))}
              </div>
            </div>

            {job && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Raw Response</h3>
                <pre className="mt-4 max-h-[420px] overflow-auto rounded-xl bg-slate-950/90 p-4 text-xs leading-relaxed text-slate-100">
                  {JSON.stringify(jobDisplayPayload, null, 2)}
                </pre>
              </div>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
