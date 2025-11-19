import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getS3Client, getStorageBucket, storageEnabled } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!storageEnabled) {
    return NextResponse.json({ error: "RunPod storage is not configured." }, { status: 503 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' query parameter." }, { status: 400 });
  }

  try {
    const command = new GetObjectCommand({
      Bucket: getStorageBucket(),
      Key: key,
    });
    const url = await getSignedUrl(getS3Client(), command, { expiresIn: 120 });
    return NextResponse.json({ url, expiresIn: 120 });
  } catch (error) {
    console.error("Failed to create download URL:", error);
    return NextResponse.json({ error: "Failed to create download URL." }, { status: 500 });
  }
}

