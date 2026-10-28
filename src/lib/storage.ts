// src/lib/storage.ts
//
// Thin wrapper around the AWS S3 SDK, pointed at either real S3 or an
// S3-compatible provider (Cloudflare R2, per the blueprint's storage
// recommendation) via S3_ENDPOINT. Generates short-lived presigned PUT URLs
// so the browser uploads the file directly to storage — the file's bytes
// never pass through our own server.

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function client() {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT, // omit for real AWS S3; set for R2
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Returns a presigned URL the browser can PUT the file to directly, plus
 * the storage key to save on the DocumentVersion record once the upload
 * succeeds.
 */
export async function createUploadUrl(eventId: string, fileName: string, contentType: string) {
  const key = `events/${eventId}/documents/${Date.now()}-${sanitiseFileName(fileName)}`;

  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 } // 5 minutes — plenty for a single PDF/image upload
  );

  return { uploadUrl, key };
}

/**
 * Returns a short-lived presigned GET URL for viewing/downloading a
 * document — documents are never made public on the bucket itself, even
 * ones marked isVisibleToClient, since that flag controls *platform* access,
 * not raw bucket access.
 */
export async function createViewUrl(key: string) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }),
    { expiresIn: 3600 }
  );
}

function sanitiseFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
