import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import {
  buildObjectKey,
  extensionFromMime,
  getS3Client,
  getStorageBucket,
  storageEnabled,
} from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!storageEnabled) {
    return NextResponse.json({ error: "RunPod storage is not configured." }, { status: 503 });
  }

  let file: File | null = null;
  let preferredContentType: string | null = null;

  try {
    const formData = await request.formData();
    const rawFile = formData.get("file");
    if (rawFile instanceof File) {
      file = rawFile;
    }
    const overrideContentType = formData.get("contentType");
    if (typeof overrideContentType === "string") {
      preferredContentType = overrideContentType;
    }
  } catch {
    return NextResponse.json({ error: "Failed to parse upload payload." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
  }

  const contentType = preferredContentType || file.type || "application/octet-stream";
  const extension = extensionFromMime(contentType) ?? null;
  const objectKey = buildObjectKey("uploads", extension);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getStorageBucket(),
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return NextResponse.json({ objectKey });
  } catch (error) {
    console.error("Failed to upload object to RunPod storage:", error);
    return NextResponse.json({ error: "Failed to upload file to storage." }, { status: 500 });
  }
}

