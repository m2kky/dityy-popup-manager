import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";

const uploadDir = process.env.UPLOAD_DIR || "/data/uploads";

const contentTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const filename = params.filename || "";

  if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(filename)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(uploadDir, filename);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(path.normalize(uploadDir))) {
    return new Response("Not found", { status: 404 });
  }

  try {
    await stat(normalized);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const stream = createReadStream(normalized);
  const body = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    },
  });
};
