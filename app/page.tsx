"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

type PredictionResult = {
  filename: string;
  status: string;
  targets: {
    caffeine?: { name: string; unit: string; value: number; window?: [number, number]; confidence?: number };
    cga?: { name: string; unit: string; value: number; window?: [number, number]; confidence?: number };
    tds?: { name: string; unit: string; value: number; window?: [number, number]; confidence?: number };
  };
};

const acceptedFormats = ".txt, .csv, .dat";

export default function Home() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!result?.targets) return [];
    return Object.entries(result.targets)
      .filter(([, entry]) => !!entry)
      .map(([rawKey, entry]) => {
        const lowerKey = rawKey.toLowerCase();
        let fallbackLabel = "TDS";

        if (lowerKey.includes("caff")) fallbackLabel = "Caffeine";
        else if (lowerKey.includes("cga")) fallbackLabel = "CGA";
        else if (lowerKey.includes("tds")) fallbackLabel = "TDS";

        return {
          id: rawKey,
          label: entry?.name || fallbackLabel,
          value: Number(entry?.value ?? 0),
          unit: entry?.unit ?? (lowerKey.includes("tds") ? "%" : "ppm"),
          window: entry?.window,
        };
      });
  }, [result]);

  const handleFileSelection = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setResult(null);
    setError(null);
    setProgress(0);
    triggerInference(file);
  };

  const triggerInference = async (file: File) => {
    setIsLoading(true);
    setProgress(10);

    const formData = new FormData();
    formData.append("file", file);

    try {
      setProgress(35);
      const response = await fetch("/api/infer", {
        method: "POST",
        body: formData,
      });

      setProgress(70);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Prediction failed.");
      }

      setResult(data);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setProgress(0);
    } finally {
      setIsLoading(false);
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    handleFileSelection(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    handleFileSelection(file);
  };

  return (
    <main className="min-h-screen px-4 py-8 text-[#2f241d] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-[2rem] border border-[#e6d7c7] bg-[rgba(255,250,243,0.75)] px-6 py-5 shadow-[0_18px_40px_rgba(76,50,36,0.08)] backdrop-blur-sm sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7a5a3d]">
                Voltabrew coffee lab
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#2f241d] sm:text-4xl">
                Coffee voltammetry analysis
              </h1>
            </div>
            <div className="rounded-full border border-[#d7c4ab] bg-[#f7f0e6] px-3 py-1.5 text-sm font-medium text-[#6d4d38]">
              Developed by Ryan Koes
            </div>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] border border-[#e5d6c5] bg-[rgba(255,250,243,0.82)] p-5 shadow-[0_20px_50px_rgba(88,63,44,0.08)] backdrop-blur-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[#82614d]">Upload</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#2f241d]">Voltammetry file</h2>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f1e2cd] text-2xl shadow-inner shadow-[#e2c9a7]">
                ☕
              </div>
            </div>

            <label
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-[370px] cursor-pointer flex-col items-center justify-center rounded-[1.7rem] border-2 border-dashed px-6 py-10 text-center transition-all duration-200 ${
                isDragging
                  ? "border-[#8b6a4d] bg-[#f6ecdf] shadow-[inset_0_0_0_1px_rgba(139,106,77,0.18)]"
                  : "border-[#d4b791] bg-[linear-gradient(135deg,#fffdf9,#f7efe4)] hover:border-[#8b6a4d] hover:bg-[#f8efe3]"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".txt,.csv,.dat"
                className="hidden"
                onChange={onInputChange}
              />

              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#f2dfc2] text-3xl shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                📄
              </div>
              <p className="text-xl font-semibold text-[#35251d]">
                Drop your trace here
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#735b4b]">
                Accepted formats: {acceptedFormats}. We’ll analyze the raw signal and estimate caffeine and CGA levels.
              </p>
              <div className="mt-6 inline-flex items-center justify-center rounded-full bg-[#4b3428] px-5 py-3 text-sm font-medium text-[#fffaf3] shadow-[0_10px_24px_rgba(75,52,40,0.18)] transition hover:bg-[#3b2a23]">
                Select file
              </div>
            </label>

            {selectedFile && (
              <div className="mt-5 rounded-[1.5rem] border border-[#e7d9c6] bg-[#f9f2ea] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#82614d]">
                      Selected file
                    </p>
                    <p className="mt-2 truncate text-base font-medium text-[#2f241d]">{selectedFile.name}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-full border border-[#d0b799] bg-white px-3 py-1.5 text-sm font-medium text-[#4b3428] transition hover:bg-[#f2eadf]"
                    onClick={() => inputRef.current?.click()}
                  >
                    Change
                  </button>
                </div>

                {isLoading && (
                  <div className="mt-5 space-y-3">
                    <div className="flex items-center justify-between text-sm text-[#5a453a]">
                      <span>Processing trace</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#eadfce]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#b7865a,#7a5a3d)] transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="rounded-[2rem] border border-[#d5b89b] bg-[linear-gradient(180deg,#3d2b24,#2d201c)] p-5 text-[#fffaf2] shadow-[0_24px_60px_rgba(42,30,26,0.18)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#e4c49f]">Results</p>
              <div className="rounded-full border border-[#72523c] bg-[#4b3428] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-[#f0d9ba]">
                Live
              </div>
            </div>

            {error ? (
              <div className="mt-5 rounded-[1.25rem] border border-[#d89494] bg-[#6a3636]/25 p-4 text-sm text-[#f7d9db]">
                {error}
              </div>
            ) : result ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] border border-[#5b4136] bg-[rgba(255,255,255,0.04)] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#d9c4a4]">File name</p>
                  <p className="mt-2 break-all text-lg font-medium text-[#fffaf2]">{result.filename}</p>
                </div>

                {summary.length > 0 ? (
                  <div className="space-y-3">
                    {summary.map((item) => (
                      <div key={item.label} className="rounded-[1.4rem] border border-[#5b4136] bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#d9c4a4]">{item.label}</span>
                          <span className="text-[10px] uppercase tracking-[0.2em] text-[#f0d9ba]">{item.unit}</span>
                        </div>
                        <p className="mt-3 text-3xl font-semibold tracking-tight text-[#fffaf2]">
                          {item.value.toFixed(4)}
                        </p>

                        {item.window && (
                          <div className="mt-3 rounded-xl border border-[#6d4b3f] bg-[#2c1d1a] px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[#f0d9ba]">
                            Window: {item.window[0].toFixed(1)} V to {item.window[1].toFixed(1)} V
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[1.25rem] border border-dashed border-[#72523c] p-4 text-sm text-[#d7c0a7]">
                    No results yet. Upload a file to begin inference.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-[#72523c] p-4 text-sm text-[#d7c0a7]">
                Your predicted values will appear here after processing.
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
