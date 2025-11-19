'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import {
  ClockIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  ServerIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/24/solid";

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
  imageObjectKey?: string;
  image_object_key?: string;
  transport?: string;
  [key: string]: unknown;
};

const MAX_DIMENSION = 768;
const dimensionOptions = [512, 640, MAX_DIMENSION];

type ProcessedImage = {
  dataUrl: string;
  blob: Blob;
};

const clampDimension = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return MAX_DIMENSION;
  }
  return Math.min(value, MAX_DIMENSION);
};

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

async function prepareImagePayload(file: File, maxDimension: number, preserveOriginal: boolean): Promise<ProcessedImage> {
  if (preserveOriginal) {
    const dataUrl = await readFileAsDataUrl(file);
    return { dataUrl, blob: file };
  }

  const baseDataUrl = await readFileAsDataUrl(file);
  try {
    const image = await loadImageElement(baseDataUrl);
    const largestSide = Math.max(image.width, image.height);
    if (!largestSide || largestSide <= maxDimension) {
      return { dataUrl: baseDataUrl, blob: file };
    }

    const scale = maxDimension / largestSide;
    const targetWidth = Math.round(image.width * scale);
    const targetHeight = Math.round(image.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to acquire drawing context.");
    }
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const mime = file.type && file.type.startsWith("image/") ? file.type : "image/png";
    const quality = mime.includes("jpeg") || mime.includes("jpg") ? 0.92 : undefined;
    const blob = await canvasToBlob(canvas, mime, quality);
    const processedDataUrl = canvas.toDataURL(mime, quality);
    return { dataUrl: processedDataUrl, blob };
  } catch (error) {
    console.warn("Image normalization failed, falling back to original data URL.", error);
    return { dataUrl: baseDataUrl, blob: file };
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState(
    "aki_anime, masterpiece, ultra-detailed, cinematic wide shot of a young inventor in a skylit workshop...",
  );
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(2);
  const [cfg, setCfg] = useState(1);
  const [width, setWidth] = useState(MAX_DIMENSION);
  const [height, setHeight] = useState(MAX_DIMENSION);
  const [seed, setSeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RunpodJobResponse | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [inputImageDataUrl, setInputImageDataUrl] = useState<string | null>(null);
  const [preserveInputQuality, setPreserveInputQuality] = useState(true);
  const [imageObjectKey, setImageObjectKey] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [storageUploadsEnabled, setStorageUploadsEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedFileRef = useRef<File | null>(null);

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

  const isBusy = loading || polling || uploadingImage;

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

    const objectKey =
      (typeof payload.imageObjectKey === "string" && payload.imageObjectKey.trim()) ||
      (typeof payload.image_object_key === "string" && payload.image_object_key.trim());
    if (objectKey) {
      try {
        const response = await fetch(`/api/storage/download?key=${encodeURIComponent(objectKey)}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const data = (await response.json()) as { url?: string };
          if (data.url) {
            return data.url;
          }
        }
      } catch (error) {
        console.error("Failed to fetch signed download URL:", error);
      }
    }

    const base64 = extractBase64Image(payload.output);
    if (base64) {
      return `data:image/png;base64,${base64}`;
    }
    return null;
  }, []);

  const uploadReferenceBlob = useCallback(
    async (blob: Blob, contentType: string, filename?: string) => {
      if (!storageUploadsEnabled) {
        return null;
      }

      try {
        setUploadingImage(true);
        setImageUploadError(null);
        const formData = new FormData();
        formData.append("file", blob, filename ?? "upload.bin");
        formData.append("contentType", contentType);

        const uploadResponse = await fetch("/api/storage/upload", {
          method: "POST",
          cache: "no-store",
          body: formData,
        });

        if (uploadResponse.status === 503) {
          setStorageUploadsEnabled(false);
          return null;
        }

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const payload = (await uploadResponse.json()) as { objectKey?: string };
        if (!payload.objectKey) {
          throw new Error("Upload response missing object key.");
        }

        setImageObjectKey(payload.objectKey);
        return payload.objectKey;
      } catch (error) {
        console.error("Image upload failed:", error);
        setImageUploadError("Image upload failed. Falling back to inline payload.");
        setImageObjectKey(null);
        return null;
      } finally {
        setUploadingImage(false);
      }
    },
    [storageUploadsEnabled],
  );

  const processSelectedFile = useCallback(
    async (file: File, options?: { preserve?: boolean }) => {
      setImageObjectKey(null);
      setImageUploadError(null);
      const preserve = options?.preserve ?? preserveInputQuality;
      const processed = await prepareImagePayload(file, MAX_DIMENSION, preserve);
      setInputImageDataUrl(processed.dataUrl);

      if (storageUploadsEnabled) {
        const key = await uploadReferenceBlob(
          processed.blob,
          processed.blob.type || file.type || "application/octet-stream",
          file.name,
        );
        if (!key && !storageUploadsEnabled) {
          setImageObjectKey(null);
        }
      }

      return processed;
    },
    [preserveInputQuality, storageUploadsEnabled, uploadReferenceBlob],
  );

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

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      setInputImageDataUrl(null);
      selectedFileRef.current = null;
      setImageObjectKey(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      event.target.value = "";
      return;
    }

    const maxSizeInBytes = 8 * 1024 * 1024; // 8MB
    if (file.size > maxSizeInBytes) {
      setError("Input image must be 8MB or smaller.");
      event.target.value = "";
      return;
    }

    selectedFileRef.current = file;

    try {
      await processSelectedFile(file);
      setError(null);
    } catch (imageError) {
      console.error("Image processing failed:", imageError);
      setError("We couldn't process the selected file. Try another image.");
      event.target.value = "";
    }
  };

  const handleRemoveImage = () => {
    setInputImageDataUrl(null);
    setImageObjectKey(null);
    setImageUploadError(null);
    selectedFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!prompt.trim()) {
      setError("Prompt cannot be empty.");
      return;
    }

    const parsedSeed = seed.trim()
      ? Number.parseInt(seed.trim(), 10)
      : undefined;

    if (parsedSeed !== undefined && Number.isNaN(parsedSeed)) {
      setError("Seed must be a whole number.");
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
      const imageBase64 = (() => {
        if (!inputImageDataUrl) {
          return undefined;
        }
        const [, encoded] = inputImageDataUrl.split(",");
        if (encoded) {
          return encoded.trim();
        }
        return inputImageDataUrl.trim();
      })();
      const requestImageBase64 = imageObjectKey ? undefined : imageBase64;

      const response = await fetch("/api/runpod", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
                body: JSON.stringify({
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          steps,
          cfg,
                  width: clampDimension(width),
                  height: clampDimension(height),
          seed: parsedSeed,
          imageBase64: requestImageBase64,
          imageObjectKey: imageObjectKey ?? undefined,
        }),
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
          setError(
            "The request was too large for the accelerator. Use storage uploads or disable “Preserve original resolution.”",
          );
        } else {
          setError(
            responseError ??
              "The Runpod endpoint returned an unexpected error. Check the server logs for details.",
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

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-12">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 text-slate-800">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <SparklesIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Blackwell Comfy Client
              </h1>
              <p className="mt-1 text-sm text-slate-500 sm:text-base">
                Launch image jobs on your Runpod endpoint with a clean YC-style control panel.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5" />
              <span>Endpoint: ul5kke5ddlrzhi</span>
            </div>
            <div className="flex items-center gap-2">
              <ClockIcon className="h-5 w-5" />
              <span>Timeout: 180s</span>
            </div>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
          >
            <div>
              <label
                htmlFor="prompt"
                className="flex items-center justify-between text-sm font-medium text-slate-700"
              >
                Prompt
                <span className="text-xs text-slate-400">Required</span>
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Describe the image you want to generate..."
                required
              />
            </div>

            <div>
              <label
                htmlFor="negativePrompt"
                className="text-sm font-medium text-slate-700"
              >
                Negative Prompt
              </label>
              <textarea
                id="negativePrompt"
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                className="mt-2 h-20 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Leave blank to omit. Separate unwanted traits with commas."
              />
            </div>

            <div>
              <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                Input Image
                <span className="text-xs text-slate-400">Optional</span>
              </span>
              <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-inner">
                      <PhotoIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Upload a reference image</p>
                      <p className="text-xs text-slate-400">
                        PNG or JPG up to 8MB. Use the toggle below if you prefer automatic downsizing to ≤{MAX_DIMENSION}px.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      id="inputImage"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-700"
                    >
                      Browse...
                    </button>
                    {inputImageDataUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="inline-flex items-center gap-1 rounded-lg border border-transparent bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        <XMarkIcon className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  {uploadingImage && (
                    <p className="text-slate-500">Uploading image to RunPod storage…</p>
                  )}
                  {imageObjectKey && !uploadingImage && storageUploadsEnabled && (
                    <p className="text-slate-500">
                      Image staged via storage: <span className="font-mono text-slate-700">{imageObjectKey}</span>
                    </p>
                  )}
                  {imageUploadError && <p className="text-red-600">{imageUploadError}</p>}
                  {!storageUploadsEnabled && (
                    <p className="text-amber-600">Storage uploads unavailable—falling back to inline payloads.</p>
                  )}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                      checked={preserveInputQuality}
                      onChange={async (event) => {
                        const next = event.target.checked;
                        setPreserveInputQuality(next);
                        const currentFile = selectedFileRef.current;
                        if (currentFile) {
                          try {
                            await processSelectedFile(currentFile, { preserve: next });
                          } catch (processingError) {
                            console.error("Image reprocessing failed:", processingError);
                            setError("We couldn't process the selected file. Try another image.");
                          }
                        }
                      }}
                    />
                    Preserve original resolution
                  </label>
                  <p className="mt-1 text-xs text-slate-400">
                    When enabled we send your upload untouched (best quality, bigger payloads). Disable to auto-downscale
                    to ≤{MAX_DIMENSION}px for faster, smaller requests.
                  </p>
                </div>
                {inputImageDataUrl ? (
                  <div className="relative mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-950/80">
                    <div className="relative aspect-square w-full">
                      <NextImage
                        src={inputImageDataUrl}
                        alt="Reference preview"
                        fill
                        sizes="(min-width: 1024px) 400px, 100vw"
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-slate-400">
                    No image selected yet. Your job will fall back to the default placeholder image.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="steps"
                  className="text-sm font-medium text-slate-700"
                >
                  Steps
                </label>
                <input
                  id="steps"
                  type="number"
                  min={1}
                  max={60}
                  value={steps}
                  onChange={(event) => setSteps(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                />
                <p className="mt-1 text-xs text-slate-400">Default: 2</p>
              </div>
              <div>
                <label
                  htmlFor="cfg"
                  className="text-sm font-medium text-slate-700"
                >
                  CFG
                </label>
                <input
                  id="cfg"
                  type="number"
                  min={0}
                  max={20}
                  step={0.5}
                  value={cfg}
                  onChange={(event) => setCfg(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                />
                <p className="mt-1 text-xs text-slate-400">Default: 1</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="width"
                  className="text-sm font-medium text-slate-700"
                >
                  Width (max {MAX_DIMENSION}px)
                </label>
                <select
                  id="width"
                  value={width}
                  onChange={(event) => setWidth(clampDimension(Number(event.target.value)))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {dimensionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}px
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="height"
                  className="text-sm font-medium text-slate-700"
                >
                  Height (max {MAX_DIMENSION}px)
                </label>
                <select
                  id="height"
                  value={height}
                  onChange={(event) => setHeight(clampDimension(Number(event.target.value)))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                >
                  {dimensionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}px
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="seed" className="text-sm font-medium text-slate-700">
                Seed
              </label>
              <input
                id="seed"
                type="text"
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
                placeholder="Optional. Leave blank for random."
              />
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
                  : "Start Runpod Job"}
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
                <div className="relative mt-4 aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-900/80">
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
                  Submit a prompt to generate an image. We’ll display the first completed render as soon as Runpod returns it.
                </p>
              )}
              {polling && (
                <p className="mt-3 text-xs text-slate-400">
                  Polling Runpod for the latest output…
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">Job Metadata</h2>
              <p className="mt-2 text-sm text-slate-500">
                Submit a prompt to see response metadata from Runpod. We return the raw job payload so you can track status or fetch results later.
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
                  <div className="text-sm text-slate-400">
                    Nothing yet. Fill in the form and submit to start a run.
                  </div>
                )}
                {job && (
                  jobMetaEntries.length > 0 ? (
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
                            <dd className="max-w-[60%] truncate font-medium text-slate-800">
                              {displayValue}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : (
                    <div className="text-sm text-slate-400">
                      Runpod acknowledged the job but did not return timing metadata yet.
                    </div>
                  )
                )}
              </div>
            </div>

            {job && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Raw Response
                </h3>
                <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950/90 p-4 text-xs leading-relaxed text-slate-100">
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
