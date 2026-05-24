import {
  RecorderController,
  WakeLockController,
  createDecodePlan,
  formatBytes,
  supportedExtensions,
  validateAudioFile
} from "./audio";
import { buildSrt, buildTxt, downloadTextFile } from "./exporter";
import { BrowserTranscriber } from "./transcriber";
import { FALLBACK_MODEL, MAIN_MODEL, type AppSettings, type DecodeWarning, type ModelId, type TranscriptionSegment } from "./types";
import { button, el, fieldLabel, section, select, statusPill } from "./ui/components";

const SETTINGS_KEY = "mtg-transcriber-settings";

const defaultSettings: AppSettings = {
  model: MAIN_MODEL,
  language: "ja",
  timestamps: true,
  acceptedFirstRunNotice: false
};

const VALID_MODELS: ReadonlyArray<string> = [MAIN_MODEL, FALLBACK_MODEL];

const loadSettings = (): AppSettings => {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return defaultSettings;
  }
  try {
    const merged: AppSettings = { ...defaultSettings, ...JSON.parse(raw) };
    // Migrate away from any obsolete model ids (e.g., the pre-fix
    // kotoba-tech/kotoba-whisper-v2.0 which has no ONNX weights).
    if (!VALID_MODELS.includes(merged.model)) {
      merged.model = MAIN_MODEL;
    }
    return merged;
  } catch {
    return defaultSettings;
  }
};

const saveSettings = (settings: AppSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

const formatClock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}時間${minutes}分${rest}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${rest}秒`;
  }
  return `${rest}秒`;
};

const warningTone = (warning: DecodeWarning) => {
  if (warning.level === "error") {
    return "border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100";
  }
  if (warning.level === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";
  }
  return "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100";
};

export const createApp = () => {
  let settings = loadSettings();
  let currentFile: File | null = null;
  let isTranscribing = false;
  let isRecording = false;
  let abortController: AbortController | null = null;
  let recordingStartedAt = 0;
  let recordingTimer = 0;
  let resultText = "";
  let resultSegments: TranscriptionSegment[] = [];

  const transcriber = new BrowserTranscriber();
  const wakeLock = new WakeLockController();
  const recorder = new RecorderController();

  const app = el("main", "mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 safe-bottom sm:px-6 lg:px-8");
  const header = el("header", "flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between");
  const titleWrap = el("div", "space-y-2");
  titleWrap.append(el("p", "text-sm font-semibold text-teal-700 dark:text-teal-300", "ブラウザ完結型"));
  titleWrap.append(el("h1", "text-3xl font-black tracking-normal text-slate-950 dark:text-zinc-50 sm:text-4xl", "MTG文字起こし"));
  titleWrap.append(
    el(
      "p",
      "max-w-2xl text-sm leading-6 text-slate-600 dark:text-zinc-400",
      "データは外部送信されません。すべての処理はブラウザ内で完結します。モデルの初回ダウンロードのみHugging Faceへ接続します。"
    )
  );
  const headerPills = el("div", "flex flex-wrap gap-2");
  headerPills.append(statusPill("外部送信なし", "green"), statusPill("PWA対応", "blue"), statusPill("無料OSS構成", "green"));
  header.append(titleWrap, headerPills);

  const firstRunNotice = el(
    "section",
    "mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
  );
  const firstRunTitle = el("h2", "text-base font-bold", "初回のみモデルをダウンロードします");
  const firstRunText = el(
    "p",
    "mt-1 text-sm leading-6",
    "kotoba-whisper-v2.0 は初回のみ約700MB規模のダウンロードが発生します。Wi-Fi環境での利用を推奨します。音声や文字起こし結果は送信されません。"
  );
  const acceptNoticeButton = button("確認しました", "primary");
  acceptNoticeButton.classList.add("mt-3");
  firstRunNotice.append(firstRunTitle, firstRunText, acceptNoticeButton);
  firstRunNotice.hidden = settings.acceptedFirstRunNotice;

  const content = el("div", "grid flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]");
  const mainColumn = el("div", "space-y-4");
  const sideColumn = el("aside", "space-y-4");

  const uploadSection = section(
    "音声ファイル",
    "ドラッグ&ドロップ、またはクリックで選択できます。PCでは最大1GBまでを想定しています。スマホでは数百MB程度が現実的な上限です。"
  );
  const dropZone = el(
    "button",
    "flex min-h-40 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-teal-600 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-teal-400 dark:hover:bg-zinc-900"
  );
  dropZone.type = "button";
  dropZone.append(
    el("span", "text-base font-bold text-slate-950 dark:text-zinc-50", "音声ファイルを選択"),
    el("span", "mt-2 text-sm leading-6 text-slate-600 dark:text-zinc-400", supportedExtensions.join(", "))
  );
  const fileInput = el("input", "hidden") as HTMLInputElement;
  fileInput.type = "file";
  fileInput.accept = supportedExtensions.join(",");
  const fileStatus = el("div", "mt-3 space-y-2");
  uploadSection.append(dropZone, fileInput, fileStatus);

  const recordSection = section("マイク録音", "録音停止後、自動で文字起こしへ進みます。iOS Safari向けに録音開始時に音声処理を初期化します。");
  const recordControls = el("div", "flex flex-col gap-3 sm:flex-row");
  const recordButton = button("録音開始", "primary");
  const stopRecordButton = button("録音停止", "danger");
  stopRecordButton.disabled = true;
  const recordingTime = el("p", "text-sm font-semibold text-slate-700 dark:text-zinc-300", "録音時間 0:00");
  const levelTrack = el("div", "h-3 w-full overflow-hidden rounded bg-slate-200 dark:bg-zinc-800");
  const levelBar = el("div", "h-full w-0 bg-teal-600 transition-[width] dark:bg-teal-400");
  levelTrack.append(levelBar);
  recordControls.append(recordButton, stopRecordButton);
  recordSection.append(recordControls, recordingTime, levelTrack);

  const settingsSection = section("変換設定");
  const settingsGrid = el("div", "grid gap-4");
  const modelWrap = el("div", "space-y-2");
  const modelSelect = select<ModelId>([
    { value: MAIN_MODEL, label: "kotoba-whisper-v2.2 ONNX（日本語メイン）" },
    { value: FALLBACK_MODEL, label: "whisper-small（多言語フォールバック）" }
  ]);
  modelSelect.value = settings.model;
  modelWrap.append(fieldLabel("モデル"), modelSelect);

  const languageWrap = el("div", "space-y-2");
  const languageSelect = select([
    { value: "ja", label: "日本語" },
    { value: "auto", label: "自動判定" },
    { value: "en", label: "英語" }
  ]);
  languageSelect.value = settings.language;
  languageWrap.append(fieldLabel("言語"), languageSelect);

  const timestampWrap = el("label", "flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900");
  timestampWrap.append(el("span", "", "タイムスタンプ表示"));
  const timestampToggle = el("input") as HTMLInputElement;
  timestampToggle.type = "checkbox";
  timestampToggle.checked = settings.timestamps;
  timestampToggle.className = "h-5 w-5 accent-teal-700";
  timestampWrap.append(timestampToggle);
  settingsGrid.append(modelWrap, languageWrap, timestampWrap);
  settingsSection.append(settingsGrid);

  const runSection = section("変換");
  const runButtons = el("div", "grid gap-3 sm:grid-cols-2");
  const startButton = button("変換開始", "primary");
  const cancelButton = button("変換を中止", "danger");
  const retryButton = button("再変換", "secondary");
  cancelButton.disabled = true;
  retryButton.disabled = true;
  runButtons.append(startButton, cancelButton, retryButton);
  const modelProgressText = el("p", "mt-4 text-sm text-slate-700 dark:text-zinc-300", "モデルDL進捗: 待機中");
  const transcribeProgressText = el("p", "mt-2 text-sm text-slate-700 dark:text-zinc-300", "文字起こし進捗: 待機中");
  const progressTrack = el("div", "mt-3 h-3 overflow-hidden rounded bg-slate-200 dark:bg-zinc-800");
  const progressBar = el("div", "h-full w-0 bg-teal-700 transition-[width] dark:bg-teal-400");
  progressTrack.append(progressBar);
  runSection.append(runButtons, modelProgressText, transcribeProgressText, progressTrack);

  const resultSection = section("結果");
  const resultActions = el("div", "mb-3 grid gap-2 sm:grid-cols-3");
  const copyButton = button("コピー", "secondary");
  const txtButton = button(".txt保存", "secondary");
  const srtButton = button(".srt保存", "secondary");
  copyButton.disabled = true;
  txtButton.disabled = true;
  srtButton.disabled = true;
  resultActions.append(copyButton, txtButton, srtButton);
  const resultArea = el(
    "textarea",
    "min-h-72 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 text-sm leading-6 text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-teal-400 dark:focus:ring-teal-900"
  ) as HTMLTextAreaElement;
  resultArea.readOnly = true;
  resultArea.placeholder = "文字起こし結果がここに表示されます。";
  const liveResult = el("pre", "sr-only");
  resultSection.append(resultActions, resultArea, liveResult);

  const privacySection = section("プライバシー");
  privacySection.append(
    el(
      "p",
      "text-sm leading-6 text-slate-700 dark:text-zinc-300",
      "音声・文字起こし本文は localStorage / IndexedDB に保存しません。設定値のみブラウザに保存します。解析SDKやトラッキングSDKは含めていません。"
    )
  );

  mainColumn.append(uploadSection, recordSection, runSection, resultSection);
  sideColumn.append(settingsSection, privacySection);
  content.append(mainColumn, sideColumn);
  app.append(header, firstRunNotice, content);

  const renderWarnings = (warnings: DecodeWarning[]) => {
    fileStatus.replaceChildren();
    warnings.forEach((warning) => {
      fileStatus.append(el("p", `rounded-md border px-3 py-2 text-sm leading-6 ${warningTone(warning)}`, warning.message));
    });
  };

  const renderFile = (file: File | null) => {
    const warnings = file ? validateAudioFile(file) : [];
    fileStatus.replaceChildren();
    if (!file) {
      return;
    }
    renderWarnings(warnings);
    fileStatus.prepend(
      el("p", "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900", `${file.name} / ${formatBytes(file.size)}`)
    );
    startButton.disabled = warnings.some((warning) => warning.level === "error");
  };

  const updateSettings = () => {
    settings = {
      ...settings,
      model: modelSelect.value as ModelId,
      language: languageSelect.value as AppSettings["language"],
      timestamps: timestampToggle.checked
    };
    saveSettings(settings);
    srtButton.disabled = !resultText || !settings.timestamps;
  };

  const setBusy = (busy: boolean) => {
    isTranscribing = busy;
    startButton.disabled = busy || !currentFile;
    retryButton.disabled = busy || !currentFile || !resultText;
    cancelButton.disabled = !busy;
    modelSelect.disabled = busy;
    languageSelect.disabled = busy;
    timestampToggle.disabled = busy;
    recordButton.disabled = busy || isRecording;
    stopRecordButton.disabled = !isRecording;
  };

  const setResult = (text: string, segments: TranscriptionSegment[]) => {
    resultText = text;
    resultSegments = segments;
    resultArea.value = text;
    liveResult.textContent = text;
    copyButton.disabled = !text;
    txtButton.disabled = !text;
    srtButton.disabled = !text || !settings.timestamps || segments.length === 0;
    retryButton.disabled = isTranscribing || !currentFile || !text;
  };

  const appendChunkResult = (chunkText: string, segments: TranscriptionSegment[]) => {
    const nextText = [resultText, chunkText].filter(Boolean).join("\n\n").trim();
    setResult(nextText, [...resultSegments, ...segments]);
  };

  const PROGRESS_TEXT_DEFAULT_CLASS = "mt-2 text-sm text-slate-700 dark:text-zinc-300";

  const resetProgress = () => {
    progressBar.style.width = "0%";
    modelProgressText.textContent = "モデルDL進捗: 待機中";
    transcribeProgressText.textContent = "文字起こし進捗: 待機中";
    transcribeProgressText.className = PROGRESS_TEXT_DEFAULT_CLASS;
  };

  const transcribeCurrentFile = async () => {
    if (!currentFile || isTranscribing) {
      return;
    }
    updateSettings();
    abortController = new AbortController();
    const startedAt = performance.now();
    setResult("", []);
    resetProgress();
    setBusy(true);
    await wakeLock.request();

    try {
      const plan = await createDecodePlan(currentFile, abortController.signal);
      renderWarnings(plan.warnings);
      if (plan.warnings.some((warning) => warning.level === "error")) {
        throw new Error("ファイルを処理できません。警告内容を確認してください。");
      }

      let completed = 0;
      for await (const chunk of plan.chunks) {
        if (abortController.signal.aborted) {
          throw new DOMException("変換を中止しました。", "AbortError");
        }
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        const average = completed > 0 ? elapsedSeconds / completed : null;
        const remaining = average ? Math.max(0, (plan.chunkCount - completed) * average) : null;
        transcribeProgressText.textContent = `文字起こし進捗: チャンク ${chunk.index} / ${chunk.total}、経過 ${formatDuration(elapsedSeconds)} / 残り ${remaining === null ? "計算中" : formatDuration(remaining)}`;
        progressBar.style.width = `${Math.round(((chunk.index - 1) / chunk.total) * 100)}%`;

        const result = await transcriber.transcribeChunk(
          settings.model,
          chunk,
          {
            language: settings.language,
            timestamps: settings.timestamps,
            signal: abortController.signal
          },
          (event) => {
            if (event.phase === "model") {
              const detail =
                event.progress !== undefined
                  ? `${Math.round(event.progress)}%`
                  : event.loaded && event.total
                    ? `${formatBytes(event.loaded)} / ${formatBytes(event.total)}`
                    : "";
              modelProgressText.textContent = `モデルDL進捗: ${event.label}${detail ? ` (${detail})` : ""}`;
            }
          }
        );

        appendChunkResult(result.text, result.segments);
        completed += 1;
        const elapsedAfter = (performance.now() - startedAt) / 1000;
        const averageAfter = elapsedAfter / completed;
        const remainingAfter = Math.max(0, (plan.chunkCount - completed) * averageAfter);
        progressBar.style.width = `${Math.round((completed / plan.chunkCount) * 100)}%`;
        transcribeProgressText.textContent = `文字起こし進捗: チャンク ${completed} / ${plan.chunkCount}、経過 ${formatDuration(elapsedAfter)} / 残り ${formatDuration(remainingAfter)}`;
      }
      modelProgressText.textContent = "モデルDL進捗: 完了";
      progressBar.style.width = "100%";
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      const message = aborted ? "変換を中止しました。" : error instanceof Error ? error.message : "変換中にエラーが発生しました。";
      transcribeProgressText.textContent = `❌ ${message}`;
      transcribeProgressText.className = "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100";
      if (!aborted) {
        // Surface unexpected errors to the console for diagnostics. Browsers
        // do not silence transformers.js failures, but the in-page text alone
        // can be easy to miss when busy state hides the start button.
        console.error("[MTG文字起こし] 変換失敗:", error);
      }
    } finally {
      await wakeLock.release();
      abortController = null;
      setBusy(false);
    }
  };

  const chooseFile = (file: File | null) => {
    if (!file) {
      return;
    }
    currentFile = file;
    setResult("", []);
    resetProgress();
    renderFile(file);
    startButton.disabled = validateAudioFile(file).some((warning) => warning.level === "error");
  };

  acceptNoticeButton.addEventListener("click", () => {
    settings = { ...settings, acceptedFirstRunNotice: true };
    saveSettings(settings);
    firstRunNotice.hidden = true;
  });

  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => chooseFile(fileInput.files?.[0] ?? null));
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("border-teal-600", "bg-teal-50", "dark:border-teal-400", "dark:bg-zinc-900");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-teal-600", "bg-teal-50", "dark:border-teal-400", "dark:bg-zinc-900");
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("border-teal-600", "bg-teal-50", "dark:border-teal-400", "dark:bg-zinc-900");
    chooseFile(event.dataTransfer?.files[0] ?? null);
  });

  modelSelect.addEventListener("change", updateSettings);
  languageSelect.addEventListener("change", updateSettings);
  timestampToggle.addEventListener("change", updateSettings);
  startButton.addEventListener("click", transcribeCurrentFile);
  retryButton.addEventListener("click", transcribeCurrentFile);
  cancelButton.addEventListener("click", () => abortController?.abort());

  recordButton.addEventListener("click", async () => {
    if (isRecording) {
      return;
    }
    try {
      isRecording = true;
      recordingStartedAt = performance.now();
      setBusy(isTranscribing);
      await wakeLock.request();
      await recorder.start((level) => {
        levelBar.style.width = `${Math.round(level * 100)}%`;
      });
      recordButton.disabled = true;
      stopRecordButton.disabled = false;
      recordingTimer = window.setInterval(() => {
        recordingTime.textContent = `録音時間 ${formatClock((performance.now() - recordingStartedAt) / 1000)}`;
      }, 250);
    } catch (error) {
      isRecording = false;
      setBusy(isTranscribing);
      recordingTime.textContent = error instanceof Error ? error.message : "録音を開始できませんでした。";
      await wakeLock.release();
    }
  });

  stopRecordButton.addEventListener("click", async () => {
    if (!isRecording) {
      return;
    }
    window.clearInterval(recordingTimer);
    levelBar.style.width = "0%";
    recordingTime.textContent = "録音を処理しています";
    try {
      const file = await recorder.stop();
      currentFile = file;
      renderFile(file);
      isRecording = false;
      setBusy(false);
      await wakeLock.release();
      await transcribeCurrentFile();
    } catch (error) {
      isRecording = false;
      setBusy(false);
      await wakeLock.release();
      recordingTime.textContent = error instanceof Error ? error.message : "録音を停止できませんでした。";
    }
  });

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(resultText);
    copyButton.textContent = "コピー済み";
    window.setTimeout(() => {
      copyButton.textContent = "コピー";
    }, 1200);
  });
  txtButton.addEventListener("click", () => downloadTextFile(buildTxt(resultText), "txt"));
  srtButton.addEventListener("click", () => downloadTextFile(buildSrt(resultSegments), "srt"));

  setBusy(false);
  renderFile(null);
  return app;
};
