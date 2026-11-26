# Notes-to-Video (Remotion Edition)

A single-page app that converts text-based PDF study notes into MP4 explainer videos:

1. Upload a PDF (up to 10 MB).
2. Extract and clean its text locally. Scanned/image-only PDFs are rejected; OCR is not used.
3. Ask Google Gemini for a structured scene script, validate it, and verify that it is grounded in the PDF text. Unrelated output is retried once with the source text and rejected if it remains off-topic.
4. Generate spoken narration with Gemini TTS, measure the WAV with Mediabunny, and request a shorter scene-aligned narration up to two times when needed.
5. Compose each scene with Remotion `<Sequence>` elements and embed the narration with `@remotion/media` `<Audio>`.
6. Render an H.264/AAC MP4 server-side and serve it for playback or download.

The composition duration is calculated from the measured narration length. Generated videos, scene JSON, and temporary files are removed after the configured TTL.

## Requirements

- Node.js 20 or newer.
- A Google Gemini API key with access to the configured text and TTS models.
- Internet access for Gemini requests and Remotion's initial Chromium setup.

## Setup and run (Windows PowerShell)

From the project directory:

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Set `GEMINI_API_KEY` in `.env`, save it, and start the app:

```powershell
npm start
```

On the first render, Remotion may set up its Chromium browser. Open [http://localhost:3000](http://localhost:3000), upload a text-based PDF, and choose **Generate Video**.

If PowerShell says the port is occupied, set a different `PORT` value in `.env`.

## Development and checks

```powershell
npm run dev
npm test
npm run build
```

The tests mock Gemini requests and do not require an API key. `npm run build` type-checks the Remotion composition.

To test a real Gemini scene-generation request with synthetic notes, set `RUN_GEMINI_INTEGRATION=1` and run `node --test test/llm-call.test.js`. This uses the configured API key and may consume API quota; the test prints the normalized return value and sanitized provider errors.

## Health check and manual API test

With the server running, check:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Expected response: `{ "ok": true }`.

To exercise PDF upload end-to-end, use a real, text-based PDF:

```powershell
curl.exe -F "pdf=@C:\path\to\study-notes.pdf;type=application/pdf" http://localhost:3000/api/generate
```

The response contains `videoUrl`, `sceneCount`, `durationSeconds`, and `truncated`. Gemini text/TTS generation and Remotion rendering may take several minutes and use API quota.

## Configuration

See [.env.example](.env.example). `GEMINI_TTS_MODEL` defaults to `gemini-3.8-flash-tts`, and `GEMINI_TTS_VOICE` defaults to `Charon`. Other settings include `MAX_UPLOAD_MB`, `MAX_INPUT_CHARS`, `MAX_VIDEO_SECONDS`, `GEMINI_TIMEOUT_MS`, `RENDER_TIMEOUT_MS`, `FILE_TTL_HOURS`, and `LOG_LEVEL`.
