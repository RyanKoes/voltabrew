import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getGradioBaseUrl(inferenceUrl: string) {
  const url = new URL(inferenceUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.includes("/gradio_api")) {
    return url.origin;
  }

  if (pathname.endsWith("/call/infer")) {
    return `${url.origin}${pathname.slice(0, -"/call/infer".length)}`;
  }

  if (pathname.endsWith("/call/v2/infer")) {
    return `${url.origin}${pathname.slice(0, -"/call/v2/infer".length)}`;
  }

  if (pathname.endsWith("/infer")) {
    return `${url.origin}${pathname.slice(0, -"/infer".length)}`;
  }

  return `${url.origin}${pathname || ""}`;
}

function normalizeInferencePayload(payload: unknown): Record<string, unknown> {
  if (!payload) return { status: "processed" };

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return { status: "processed" };

    try {
      return normalizeInferencePayload(JSON.parse(trimmed));
    } catch {
      const match = trimmed.match(/^output\s*\((.*)\)\s*$/);
      if (match) {
        const inner = match[1];
        try {
          return normalizeInferencePayload(JSON.parse(inner));
        } catch {
          return { status: "processed", raw_output: trimmed };
        }
      }
      return { status: "processed", raw_output: trimmed };
    }
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return { status: "processed" };
    return normalizeInferencePayload(payload[0]);
  }

  if (typeof payload === "object") {
    return payload as Record<string, unknown>;
  }

  return { status: "processed", raw_output: payload };
}

async function fetchGradioResult(eventId: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}/gradio_api/call/infer/${eventId}`);

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Inference backend returned ${response.status} ${response.statusText}: ${text}`);
  }

  const match = text.match(/event:\s*complete[\s\S]*?data:\s*(.+)/i);
  const data = match?.[1] ?? text;

  try {
    const parsed = JSON.parse(data);
    return normalizeInferencePayload(parsed);
  } catch {
    return { status: "processed", raw_output: data };
  }
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const uploadedFile = formData.get("file");

  if (!(uploadedFile instanceof File)) {
    return NextResponse.json(
      { error: "Please upload a valid .txt or .csv voltammetry file." },
      { status: 400 },
    );
  }

  const fileName = uploadedFile.name || "uploaded_trace.txt";
  const allowed = [".txt", ".csv", ".dat"];
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf("."));

  if (!allowed.includes(extension)) {
    return NextResponse.json(
      { error: "Only .txt, .csv, or .dat files are supported for inference." },
      { status: 400 },
    );
  }

  const inferenceUrl = process.env.HF_SPACE_INFER_URL;

  if (!inferenceUrl) {
    return NextResponse.json(
      {
        error:
          "HF_SPACE_INFER_URL is not set. Add your Hugging Face Space inference URL in the environment variables.",
      },
      { status: 500 },
    );
  }

  try {
    const baseUrl = getGradioBaseUrl(inferenceUrl);

    const uploadResponse = await fetch(`${baseUrl}/gradio_api/upload`, {
      method: "POST",
      body: (() => {
        const uploadFormData = new FormData();
        uploadFormData.append("files", uploadedFile, fileName);
        return uploadFormData;
      })(),
    });

    const uploadResult = await uploadResponse.json().catch(() => null);

    if (!uploadResponse.ok) {
      const errorMessage =
        uploadResult?.error || `Upload backend returned ${uploadResponse.status} ${uploadResponse.statusText}`;
      throw new Error(errorMessage);
    }

    const uploadedPath = Array.isArray(uploadResult)
      ? uploadResult[0]
      : uploadResult?.path || uploadResult?.[0] || null;

    if (!uploadedPath || typeof uploadedPath !== "string") {
      throw new Error("The Hugging Face Space did not return a valid uploaded file path.");
    }

    const callResponse = await fetch(`${baseUrl}/gradio_api/call/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{ path: uploadedPath, meta: { _type: "gradio.FileData" } }],
      }),
    });

    const callResult = await callResponse.json().catch(() => null);

    if (!callResponse.ok) {
      const errorMessage =
        callResult?.error || `Inference backend returned ${callResponse.status} ${callResponse.statusText}`;
      throw new Error(errorMessage);
    }

    const eventId = callResult?.event_id;
    if (!eventId || typeof eventId !== "string") {
      throw new Error("The Hugging Face Space did not return an inference event ID.");
    }

    const payload = await fetchGradioResult(eventId, baseUrl);
    return NextResponse.json(payload ?? { status: "processed" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}