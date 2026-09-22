import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

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

  // FIX: Write directly to tmpdir() using correct template literal syntax `${...}`
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const tempPath = join(tmpdir(), `\({Date.now()}-\){sanitizedName}`);

  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  await writeFile(tempPath, buffer);

  const scriptPath = join(process.cwd(), "scripts", "infer_voltammetry.py");

  try {
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn("python3", [scriptPath, tempPath], {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ stdout, stderr, code });
      });
    });

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "The model failed to process the uploaded file.");
    }

    const parsed = JSON.parse(result.stdout.trim());
    return NextResponse.json(parsed, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // best effort cleanup
    }
  }
}