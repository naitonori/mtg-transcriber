import type { TranscriptionSegment } from "./types";

const fileSafeDate = () => new Date().toISOString().replace(/[:.]/g, "-");

export const buildTxt = (text: string) => `${text.trim()}\n`;

const pad = (value: number, digits = 2) => value.toString().padStart(digits, "0");

export const formatSrtTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const millis = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${pad(millis, 3)}`;
};

export const buildSrt = (segments: TranscriptionSegment[]) =>
  segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(Math.max(segment.end, segment.start + 0.1));
      return `${index + 1}\n${start} --> ${end}\n${segment.text.trim()}\n`;
    })
    .join("\n");

export const downloadTextFile = (content: string, extension: "txt" | "srt") => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mtg-transcriber-${fileSafeDate()}.${extension}`;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
};
