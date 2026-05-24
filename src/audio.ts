import type { AudioChunk, DecodePlan, DecodeWarning } from "./types";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const LARGE_FILE_WARNING = 800 * 1024 * 1024;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = [".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac"];

type WakeLockSentinel = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
};

type WavInfo = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  blockAlign: number;
  duration: number;
};

export const supportedExtensions = SUPPORTED_EXTENSIONS;

export const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
};

export const isSupportedAudioFile = (file: File) => {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
};

export const validateAudioFile = (file: File): DecodeWarning[] => {
  const warnings: DecodeWarning[] = [];
  if (!isSupportedAudioFile(file)) {
    warnings.push({
      level: "error",
      message: `未対応の形式です。対応形式: ${SUPPORTED_EXTENSIONS.join(", ")}`
    });
  }
  if (file.size > MAX_FILE_SIZE) {
    warnings.push({
      level: "error",
      message: `ファイルサイズが1GBを超えています（${formatBytes(file.size)}）。PCでも処理できない可能性が高いです。`
    });
  } else if (file.size > LARGE_FILE_WARNING) {
    warnings.push({
      level: "warning",
      message: `800MBを超えています（${formatBytes(file.size)}）。PC推奨です。変換中は他の重いアプリを閉じてください。`
    });
  }
  return warnings;
};

export const getAudioDuration = (file: File) =>
  new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("音声の長さを読み取れませんでした。"));
    };
    audio.src = url;
  });

const parseWavInfo = async (file: File): Promise<WavInfo | null> => {
  const header = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
  const view = new DataView(header);
  if (view.byteLength < 44) {
    return null;
  }
  const fourCC = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  if (fourCC(0) !== "RIFF" || fourCC(8) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = fourCC(offset);
    const size = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (id === "fmt ") {
      audioFormat = view.getUint16(chunkStart, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      blockAlign = view.getUint16(chunkStart + 12, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    }
    if (id === "data") {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }

  if (!dataOffset || !dataSize || !channels || !sampleRate || !blockAlign) {
    return null;
  }

  return {
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    dataOffset,
    dataSize,
    blockAlign,
    duration: dataSize / blockAlign / sampleRate
  };
};

const convertWavPcmToFloat = (buffer: ArrayBuffer, info: WavInfo, frameOffset: number, frames: number) => {
  const view = new DataView(buffer);
  const output = new Float32Array(frames);
  const bytesPerSample = info.bitsPerSample / 8;

  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < info.channels; channel += 1) {
      const offset = frame * info.blockAlign + channel * bytesPerSample;
      if (info.audioFormat === 3 && info.bitsPerSample === 32) {
        sum += view.getFloat32(offset, true);
      } else if (info.bitsPerSample === 16) {
        sum += view.getInt16(offset, true) / 32768;
      } else if (info.bitsPerSample === 24) {
        const sample =
          (view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16)) / 8388608;
        sum += Math.max(-1, Math.min(1, sample));
      } else if (info.bitsPerSample === 32) {
        sum += view.getInt32(offset, true) / 2147483648;
      } else if (info.bitsPerSample === 8) {
        sum += (view.getUint8(offset) - 128) / 128;
      }
    }
    output[frameOffset + frame] = sum / info.channels;
  }
  return output;
};

const resampleTo16k = (input: Float32Array, sourceRate: number) => {
  if (sourceRate === TARGET_SAMPLE_RATE) {
    return input;
  }
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(input.length - 1, lower + 1);
    const weight = sourceIndex - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }

  return output;
};

async function* wavChunks(file: File, info: WavInfo): AsyncGenerator<AudioChunk> {
  const total = Math.ceil(info.duration / CHUNK_SECONDS);

  for (let index = 0; index < total; index += 1) {
    const start = index * CHUNK_SECONDS;
    const end = Math.min(info.duration, start + CHUNK_SECONDS);
    const startFrame = Math.floor(start * info.sampleRate);
    const endFrame = Math.min(Math.ceil(end * info.sampleRate), Math.floor(info.dataSize / info.blockAlign));
    const frames = endFrame - startFrame;
    const byteStart = info.dataOffset + startFrame * info.blockAlign;
    const byteEnd = byteStart + frames * info.blockAlign;
    const raw = await file.slice(byteStart, byteEnd).arrayBuffer();
    const mono = convertWavPcmToFloat(raw, info, 0, frames);
    const samples = resampleTo16k(mono, info.sampleRate);
    yield {
      index: index + 1,
      total,
      start,
      end,
      samples,
      sampleRate: TARGET_SAMPLE_RATE
    };
  }
}

const decodeWithWebAudio = async (buffer: ArrayBuffer) => {
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(buffer);
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        mono[index] += data[index] / decoded.numberOfChannels;
      }
    }
    return {
      samples: resampleTo16k(mono, decoded.sampleRate),
      duration: decoded.duration
    };
  } finally {
    await audioContext.close();
  }
};

async function* shortWebAudioChunks(file: File, duration: number): AsyncGenerator<AudioChunk> {
  const total = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
  const decoded = await decodeWithWebAudio(await file.arrayBuffer());
  const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_SECONDS;

  for (let index = 0; index < total; index += 1) {
    const startSample = index * samplesPerChunk;
    const endSample = Math.min(decoded.samples.length, startSample + samplesPerChunk);
    const start = index * CHUNK_SECONDS;
    const end = Math.min(decoded.duration, start + CHUNK_SECONDS);
    const samples = decoded.samples.slice(startSample, endSample);
    yield {
      index: index + 1,
      total,
      start,
      end,
      samples,
      sampleRate: TARGET_SAMPLE_RATE
    };
  }
}

const waitForMediaEvent = (media: HTMLMediaElement, eventName: keyof HTMLMediaElementEventMap) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, onEvent);
      media.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("音声ファイルの読み込みに失敗しました。"));
    };
    media.addEventListener(eventName, onEvent, { once: true });
    media.addEventListener("error", onError, { once: true });
  });

async function* mediaElementChunks(file: File, duration: number, signal?: AbortSignal): AsyncGenerator<AudioChunk> {
  const total = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  const audioContext = new AudioContext();
  const source = audioContext.createMediaElementSource(audio);
  const destination = audioContext.createMediaStreamDestination();
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  source.connect(destination);
  source.connect(silentGain);
  silentGain.connect(audioContext.destination);
  audio.preload = "auto";
  audio.src = url;

  try {
    await waitForMediaEvent(audio, "loadedmetadata");
    await audioContext.resume();

    for (let index = 0; index < total; index += 1) {
      if (signal?.aborted) {
        throw new DOMException("変換を中止しました。", "AbortError");
      }

      const start = index * CHUNK_SECONDS;
      const end = Math.min(duration, start + CHUNK_SECONDS);
      const recorded: Blob[] = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(destination.stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorded.push(event.data);
        }
      };

      audio.currentTime = start;
      await waitForMediaEvent(audio, "seeked");
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start(1000);
      await audio.play();
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (signal?.aborted) {
            audio.pause();
            reject(new DOMException("変換を中止しました。", "AbortError"));
            return;
          }
          if (audio.currentTime >= end || audio.ended) {
            audio.pause();
            resolve();
            return;
          }
          window.setTimeout(tick, 100);
        };
        tick();
      });
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      await stopped;

      const decoded = await decodeWithWebAudio(await new Blob(recorded, { type: mimeType }).arrayBuffer());
      yield {
        index: index + 1,
        total,
        start,
        end,
        samples: decoded.samples,
        sampleRate: TARGET_SAMPLE_RATE
      };
    }
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
    await audioContext.close();
  }
}

export const createDecodePlan = async (file: File, signal?: AbortSignal): Promise<DecodePlan> => {
  const warnings = validateAudioFile(file);
  if (warnings.some((warning) => warning.level === "error")) {
    return {
      duration: 0,
      chunkCount: 0,
      warnings,
      chunks: (async function* empty() {})()
    };
  }

  const wavInfo = await parseWavInfo(file);
  if (wavInfo) {
    warnings.push({
      level: "info",
      message: "WAVは30秒単位で読み込み、推論後にチャンクを破棄します。"
    });
    return {
      duration: wavInfo.duration,
      chunkCount: Math.ceil(wavInfo.duration / CHUNK_SECONDS),
      warnings,
      chunks: wavChunks(file, wavInfo)
    };
  }

  const duration = await getAudioDuration(file);
  const chunkCount = Math.max(1, Math.ceil(duration / CHUNK_SECONDS));
  warnings.push({
    level: chunkCount > 1 ? "info" : "warning",
    message:
      chunkCount > 1
        ? "圧縮形式の長時間音声はブラウザの再生デコーダーから30秒ずつ取り出します。全PCMは保持しませんが、デコードはほぼ実時間で進みます。"
        : "短い圧縮音声はブラウザ標準デコーダーで読み込みます。最も安定する形式は16bit PCM WAVです。"
  });

  return {
    duration,
    chunkCount,
    warnings,
    chunks: chunkCount > 1 ? mediaElementChunks(file, duration, signal) : shortWebAudioChunks(file, duration)
  };
};

export class WakeLockController {
  private lock: WakeLockSentinel | null = null;

  async request() {
    const wakeNavigator = navigator as WakeLockNavigator;
    if (!wakeNavigator.wakeLock || this.lock) {
      return;
    }
    try {
      this.lock = await wakeNavigator.wakeLock.request("screen");
      this.lock.addEventListener("release", () => {
        this.lock = null;
      });
    } catch {
      this.lock = null;
    }
  }

  async release() {
    if (!this.lock) {
      return;
    }
    const currentLock = this.lock;
    this.lock = null;
    await currentLock.release();
  }
}

export class RecorderController {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private levelFrame = 0;

  async start(onLevel: (level: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      }
    });

    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const updateLevel = () => {
      if (!this.analyser) {
        return;
      }
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      this.levelFrame = requestAnimationFrame(updateLevel);
    };
    updateLevel();

    this.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder.start(1000);
  }

  async stop() {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      throw new Error("録音は開始されていません。");
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    cancelAnimationFrame(this.levelFrame);

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.analyser = null;
    await this.audioContext?.close();
    this.audioContext = null;

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
    this.chunks = [];
    return new File([blob], `recording-${new Date().toISOString()}.webm`, { type: blob.type });
  }
}
