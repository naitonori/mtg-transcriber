// MAIN: whisper-large-v3-turbo is OpenAI's latest production-grade Whisper.
// 4-layer decoder, ~800MB with q8, excellent Japanese accuracy, and (critically)
// uses the standard Whisper pipeline — no custom_pipelines field, so it loads
// cleanly via transformers.js. Most-downloaded transformers.js ASR model.
// (kotoba-whisper-v2.2-ONNX has a custom_pipelines field that transformers.js
// cannot resolve, throwing "Unsupported model type: whisper".)
export const MAIN_MODEL = "onnx-community/whisper-large-v3-turbo" as const;
export const FALLBACK_MODEL = "Xenova/whisper-small" as const;

export type ModelId = typeof MAIN_MODEL | typeof FALLBACK_MODEL;
export type LanguageChoice = "auto" | "ja" | "en";

export type AppSettings = {
  model: ModelId;
  language: LanguageChoice;
  timestamps: boolean;
  acceptedFirstRunNotice: boolean;
};

export type TranscriptionSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
};

export type TranscriptionResult = {
  text: string;
  segments: TranscriptionSegment[];
};

export type AudioChunk = {
  index: number;
  total: number;
  start: number;
  end: number;
  samples: Float32Array;
  sampleRate: 16000;
};

export type DecodeWarning = {
  level: "info" | "warning" | "error";
  message: string;
};

export type DecodePlan = {
  duration: number;
  chunkCount: number;
  warnings: DecodeWarning[];
  chunks: AsyncGenerator<AudioChunk>;
};

export type ProgressEvent =
  | {
      phase: "model";
      label: string;
      loaded?: number;
      total?: number;
      progress?: number;
    }
  | {
      phase: "transcribe";
      chunkIndex: number;
      chunkTotal: number;
      elapsedSeconds: number;
      estimatedRemainingSeconds: number | null;
    };

export type TranscribeChunkOptions = {
  language: LanguageChoice;
  timestamps: boolean;
  signal: AbortSignal;
};
