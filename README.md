# literative

Literative is an AI-native poster editor for the desktop. It combines a layer-based canvas with image generation from OpenAI-compatible or Stable Diffusion APIs.

The app shell is Tauri 2. The frontend is React with TypeScript. The image pipeline runs in Rust.

## Features

- Layer-based poster editor with a moodboard for reference images.
- Image generation from two API presets:
  - OpenAI-compatible images API. The app uses `images/edits` for reference images and `images/generations` for text prompts.
  - Stable Diffusion style API (AUTOMATIC1111). The app uses `/sdapi/v1/img2img` for reference images and `/sdapi/v1/txt2img` for text prompts.
- Rust image core for decoding, resizing, and photo filters.
- Text layers rendered with the bundled DejaVu Sans font.
- Export of the final poster as PNG or JPEG through a save dialog.
- Light and dark themes.
- Persistent settings in `settings.json` in the platform config directory.

## Prerequisites

You need these tools to build and run the app.

- Node.js 22 or newer.
- npm.
- Rust stable toolchain with Cargo.
- Tauri 2 system dependencies for your operating system.

### Linux dependencies

Run these commands to install the Tauri system packages on Ubuntu 22.04.

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev javascriptcoregtk-4.1-dev librsvg2-dev
```

### macOS dependencies

Install the Xcode Command Line Tools. Run this command.

```bash
xcode-select --install
```

### Windows dependencies

Install the Microsoft Visual C++ Build Tools and WebView2. See the Tauri v2 prerequisites page for the details.

## Run in development mode

Install the frontend dependencies first.

```bash
npm install
```

Start the app in development mode.

```bash
npm run tauri dev
```

The command starts the Vite dev server and opens the app window. The Rust backend compiles on the first run.

## Build a release bundle

Build the optimized app bundle for your platform.

```bash
npm run tauri build
```

The command creates these artifacts:

- Linux: AppImage and deb package in `src-tauri/target/release/bundle/`.
- macOS: dmg and app bundle in the same directory.
- Windows: NSIS installer and MSI in the same directory.

## Run the tests

Run the frontend test suite.

```bash
npm test
```

Run the Rust test suite.

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The CI workflow runs both suites on every push to the main branch and on every pull request.

## Configure the AI backend

Open the settings dialog inside the app. The default endpoint is `http://127.0.0.1:8000` with the OpenAI-compatible preset.

### Use a Stable Diffusion server

Start an AUTOMATIC1111 WebUI instance with the API enabled. Run this command.

```bash
./webui.sh --api
```

Set the app endpoint to the server address, for example `http://127.0.0.1:7860`. Select the Stable Diffusion preset in the settings dialog.

### Use an OpenAI-compatible server

Point the app at any server that implements the OpenAI images API. Set the endpoint and API key in the settings dialog.

## Project structure

```text
src/                     React frontend
  components/            editor, moodboard, settings, and theme UI
  state/                 contexts for the editor, moodboard, and settings
  lib/                   frontend generation, export, and file helpers
src-tauri/
  src/                   Rust backend
    ai_client/           OpenAI and Stable Diffusion API clients
    image_core/          decode, resize, filters, and text rendering
    poster.rs            text layer compositing and export
    settings.rs          settings persistence
  tests/                 Rust integration tests
.github/workflows/       CI and release pipelines
```

## License

MIT. See the LICENSE file.
