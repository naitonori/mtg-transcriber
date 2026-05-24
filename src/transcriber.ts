import { env, pipeline } from "@huggingface/transformers";
import type {
  AudioChunk,
  LanguageChoice,
  ModelId,
  ProgressEvent,
  TranscribeChunkOptions,
  TranscriptionResult,
  TranscriptionSegment
} from "./types";

type PipelineFunction = (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>;

type ProgressCallbackPayload = {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type TimestampChunk = {
  text?: string;
  timestamp?: [number | null, number | null];
};

type PipelineOutput = {
  text?: string;
  chunks?: TimestampChunk[];
};

const envConfig = env as typeof env & {
  allowLocalModels?: boolean;
  allowRemoteModels?: boolean;
  useBrowserCache?: boolean;
  remoteHost?: string;
};

envConfig.allowLocalModels = false;
envConfig.allowRemoteModels = true;
envConfig.useBrowserCache = true;
envConfig.remoteHost = "https://huggingface.co";

// Configure the ONNX Runtime WASM backend so it does NOT try to import a
// worker proxy module from a jsdelivr CDN at runtime. With our strict CSP
// (`script-src 'self' 'wasm-unsafe-eval'`), that dynamic import is blocked
// and ORT reports "no available backend found. ERR: [wasm] Importing a
// module script failed". Running the WASM session inline on the main
// thread with a single thread of execution removes the need for any
// external worker JS, while still letting ORT pick up the Vite-bundled
// `ort-wasm-simd-threaded.jsep-*.wasm` from the same origin.
type OnnxBackendConfig = {
  backends?: {
    onnx?: {
      wasm?: {
        numThreads?: number;
        proxy?: boolean;
        simd?: boolean;
      };
    };
  };
};
const ortEnv = env as unknown as OnnxBackendConfig;
if (!ortEnv.backends) {
  ortEnv.backends = {};
}
if (!ortEnv.backends.onnx) {
  ortEnv.backends.onnx = {};
}
if (!ortEnv.backends.onnx.wasm) {
  ortEnv.backends.onnx.wasm = {};
}
ortEnv.backends.onnx.wasm.numThreads = 1;
ortEnv.backends.onnx.wasm.proxy = false;
ortEnv.backends.onnx.wasm.simd = true;
// Serve onnxruntime-web's .mjs loader + .wasm binary from our own origin
// (public/ort/ → /mtg-transcriber/ort/). Vite-only bundling skips the .mjs
// loader, leaving the runtime to try a jsdelivr CDN that our CSP blocks.
(ortEnv.backends.onnx.wasm as { wasmPaths?: string }).wasmPaths = "/mtg-transcriber/ort/";

const languageToWhisper = (language: LanguageChoice) => {
  if (language === "ja") {
    return "japanese";
  }
  if (language === "en") {
    return "english";
  }
  return undefined;
};

const asPipelineOutput = (value: unknown): PipelineOutput => {
  if (Array.isArray(value)) {
    return asPipelineOutput(value[0]);
  }
  if (typeof value === "object" && value !== null) {
    return value as PipelineOutput;
  }
  return { text: String(value ?? "") };
};

const normalizeProgress = (payload: unknown): ProgressCallbackPayload => {
  if (typeof payload === "object" && payload !== null) {
    return payload as ProgressCallbackPayload;
  }
  return {};
};

export class BrowserTranscriber {
  private activeModel: ModelId | null = null;
  private activePipeline: PipelineFunction | null = null;

  async load(model: ModelId, onProgress: (event: ProgressEvent) => void, signal: AbortSignal) {
    if (this.activeModel === model && this.activePipeline) {
      return this.activePipeline;
    }

    onProgress({
      phase: "model",
      label: "モデルを準備しています"
    });

    const transcriber = await pipeline("automatic-speech-recognition", model, {
      dtype: "q8",
      progress_callback: (raw: unknown) => {
        const progress = normalizeProgress(raw);
        onProgress({
          phase: "model",
          label: progress.file ?? progress.name ?? progress.status ?? "モデルをダウンロード中",
          loaded: progress.loaded,
          total: progress.total,
          progress: progress.progress
        });
      }
    });

    if (signal.aborted) {
      throw new DOMException("変換を中止しました。", "AbortError");
    }

    this.activeModel = model;
    this.activePipeline = transcriber as PipelineFunction;
    return this.activePipeline;
  }

  async transcribeChunk(
    model: ModelId,
    chunk: AudioChunk,
    options: TranscribeChunkOptions,
    onProgress: (event: ProgressEvent) => void
  ): Promise<TranscriptionResult> {
    const transcriber = await this.load(model, onProgress, options.signal);
    if (options.signal.aborted) {
      throw new DOMException("変換を中止しました。", "AbortError");
    }

    const language = languageToWhisper(options.language);
    const generateKwargs = language
      ? {
          language,
          task: "transcribe"
        }
      : {
          task: "transcribe"
        };

    const output = asPipelineOutput(
      await transcriber(chunk.samples, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: options.timestamps,
        generate_kwargs: generateKwargs
      })
    );

    if (options.signal.aborted) {
      throw new DOMException("変換を中止しました。", "AbortError");
    }

    const baseText = output.text?.trim() ?? "";
    const segments: TranscriptionSegment[] =
      output.chunks?.map((timestampChunk, index) => {
        const [start, end] = timestampChunk.timestamp ?? [0, Math.max(0.1, chunk.end - chunk.start)];
        const safeStart = chunk.start + Math.max(0, start ?? 0);
        const safeEnd = chunk.start + Math.max(start ?? 0, end ?? chunk.end - chunk.start);
        return {
          id: chunk.index * 1000 + index,
          start: safeStart,
          end: safeEnd,
          text: timestampChunk.text?.trim() ?? ""
        };
      }) ?? [
        {
          id: chunk.index,
          start: chunk.start,
          end: chunk.end,
          text: baseText
        }
      ];

    return {
      text: baseText || segments.map((segment) => segment.text).join(" ").trim(),
      segments
    };
  }
}
