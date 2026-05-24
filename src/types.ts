export const MAIN_MODEL = "kotoba-tech/kotoba-whisper-v2.0" as const;
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
