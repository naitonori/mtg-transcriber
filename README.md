# MTG文字起こし

## 納品物の概要

Vite + TypeScript + TailwindCSS で実装した、ブラウザ完結型の音声文字起こし Web アプリです。`@huggingface/transformers` で Whisper 系モデルをブラウザ内実行し、GitHub Pages のサブパス `/mtg-transcriber/` で配信できるように構成しています。

## 既知の懸念点

- 初回利用時はモデルファイルのダウンロードが大きく、`onnx-community/kotoba-whisper-v2.2-ONNX` は数百MB規模の通信が発生します。
- WAV は30秒単位でファイルを読み込み、推論後に破棄します。MP3/M4A/WebM/OGG/FLAC の長時間音声はブラウザの再生デコーダーから30秒ずつ取り出すため、全PCM保持は避けられますが、デコードがほぼ実時間で進みます。長時間・大容量ファイルは 16bit PCM WAV が最も高速で安定します。
- iPhone Safari はメモリ上限が低く、数百MB以上の音声ではPCより失敗しやすいです。録音や音声処理はユーザー操作後に開始する実装にしています。
- 実機のマイク録音、iOS Safari、1GB近いファイル処理は端末依存が強いため、利用予定端末で追加検証してください。

## プロジェクト概要

「MTG文字起こし」は、会議や面談の音声をブラウザ内で文字起こしする PWA です。音声・文字起こし本文は外部サービスへ送信せず、モデルの初回ダウンロードのみ Hugging Face へ接続します。

主な機能:

- 音声ファイルのドラッグ&ドロップ / クリック選択
- マイク録音と録音後の自動文字起こし
- 日本語 / 英語 / 自動判定の言語選択
- kotoba-whisper-v2.2 ONNX / whisper-small のモデル切替
- モデルDL進捗、文字起こし進捗、経過時間 / 推定残り時間表示
- 変換中止、途中結果の逐次表示
- コピー、`.txt`、`.srt` エクスポート
- PWA manifest + Service Worker

## 起動手順

```bash
npm install
npm run dev
```

ローカルURL:

```text
http://localhost:5173/mtg-transcriber/
```

## ビルド手順

```bash
npm run build
```

生成物は `dist/` に出力されます。

## GitHub Pages デプロイ手順

`.github/workflows/deploy.yml` を同梱しています。`main` ブランチへ push すると GitHub Actions が以下を実行します。

1. `npm ci`
2. `npm run build`
3. `actions/deploy-pages` による GitHub Pages デプロイ

GitHub リポジトリ側では Pages の Source を GitHub Actions に設定してください。

## 使用モデルとサイズ

- メイン: `onnx-community/kotoba-whisper-v2.2-ONNX`（transformers.jsでブラウザ実行可能なONNX版。日本語に強い）
- フォールバック: `Xenova/whisper-small`（多言語対応）

モデルは `@huggingface/transformers` 経由で Hugging Face から取得します。初回のみ大きなダウンロードが発生し、以後はブラウザキャッシュと Service Worker キャッシュが利用されます。

## 既知の制約

- 初回モデルDLは大容量です。Wi-Fi環境を推奨します。
- iPhone Safari はメモリ上限が低く、大容量音声では失敗する可能性があります。
- WAV は30秒チャンク単位で読み込みます。圧縮形式の長時間音声は30秒ずつ再生デコードするため、巨大ファイルでは WAV より時間がかかります。
- ブラウザ内推論のため、端末性能によって変換時間が大きく変わります。
- WebGPU が利用できない環境では WASM 実行になり、変換に時間がかかります。

## Privacy & Security

- 音声データと文字起こし本文は外部送信しません。
- 外部通信はモデルDLのための Hugging Face (`https://huggingface.co`, `https://cdn-lfs.huggingface.co`) のみに限定しています。
- `index.html` に CSP メタタグを設定し、`connect-src` を Hugging Face のみに制限しています。
- 音声・文字起こし本文は `localStorage` / `IndexedDB` に保存しません。保存するのはモデル選択、言語、タイムスタンプ表示、初回警告確認などの設定値のみです。
- 文字起こし結果は DOM のテキストとして扱い、HTMLとして差し込みません。
- Google Analytics、Sentry、PostHog、Plausible などの解析・トラッキングSDKは含めていません。
- Service Worker の scope は `/mtg-transcriber/` 配下に限定しています。

## 受け入れ確認コマンド

```bash
npm install
npm run build
npm audit --production
```

## ファイル構成

```text
mtg-transcriber/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── public/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable.png
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── transcriber.ts
│   ├── audio.ts
│   ├── exporter.ts
│   ├── ui/
│   │   ├── components.ts
│   │   └── styles.css
│   └── types.ts
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
└── README.md
```
