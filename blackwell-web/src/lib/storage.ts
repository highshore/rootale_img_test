import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const STORAGE_ENDPOINT = process.env.RUNPOD_STORAGE_ENDPOINT;
const STORAGE_BUCKET = process.env.RUNPOD_STORAGE_BUCKET;
const STORAGE_ACCESS_KEY = process.env.RUNPOD_STORAGE_ACCESS_KEY;
const STORAGE_SECRET_KEY = process.env.RUNPOD_STORAGE_SECRET_KEY;
const inferRegionFromEndpoint = (endpoint?: string | null): string | null => {
  if (!endpoint) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    const match = url.hostname.match(/s3api-([^.]+)\./i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // ignore parsing errors and fall back
  }
  return null;
};

const STORAGE_REGION =
  process.env.RUNPOD_STORAGE_REGION ??
  inferRegionFromEndpoint(process.env.RUNPOD_STORAGE_ENDPOINT) ??
  "us-east-1";
const STORAGE_FORCE_PATH_STYLE = process.env.RUNPOD_STORAGE_FORCE_PATH_STYLE ?? "1";

export const storageEnabled =
  Boolean(STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS_KEY && STORAGE_SECRET_KEY) ?? false;

let client: S3Client | null = null;

function resolveForcePathStyle(): boolean {
  return (STORAGE_FORCE_PATH_STYLE ?? "").toLowerCase() !== "0";
}

export function getStorageBucket(): string {
  if (!STORAGE_BUCKET) {
    throw new Error("RUNPOD_STORAGE_BUCKET is not configured");
  }
  return STORAGE_BUCKET;
}

export function getS3Client(): S3Client {
  if (!storageEnabled) {
    throw new Error("RunPod storage is not configured.");
  }
  if (!client) {
    client = new S3Client({
      region: STORAGE_REGION,
      endpoint: STORAGE_ENDPOINT,
      forcePathStyle: resolveForcePathStyle(),
      credentials: {
        accessKeyId: STORAGE_ACCESS_KEY as string,
        secretAccessKey: STORAGE_SECRET_KEY as string,
      },
    });
  }
  return client;
}

export function sanitizeKeyPrefix(prefix: string): string {
  return prefix.replace(/^\/*/, "").replace(/\/*$/, "");
}

export function buildObjectKey(prefix: string, extension: string | null = null): string {
  const safePrefix = sanitizeKeyPrefix(prefix || "uploads");
  const timestamp = new Date().toISOString().split("T")[0];
  const random = randomUUID();
  const suffix = extension ? (extension.startsWith(".") ? extension : `.${extension}`) : "";
  return `${safePrefix}/${timestamp}/${random}${suffix}`;
}

export function extensionFromMime(contentType: string | undefined | null): string | null {
  if (!contentType) {
    return null;
  }
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  return null;
}

