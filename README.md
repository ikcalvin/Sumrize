# Sumrize

A Chrome extension that summarizes any article with AI and reads it aloud using Deepgram's text-to-speech.

## How It Works

1. **Navigate to any article** and click the Sumrize icon in your toolbar (or use the floating widget that appears on the page).
2. **AI summarizes the article** — Sumrize extracts the article content, sends it to your chosen LLM provider, and generates a concise one-paragraph summary.
3. **Listen to the summary** — Hit "Listen" to hear the summary read aloud using Deepgram's Aura TTS voices. Audio streams in chunks for instant playback — no waiting for the full file.

### Under the Hood

- **Article extraction** — Uses smart heuristics: checks for `<article>` tags, common content selectors (`[role="main"]`, `.post-content`, `.entry-content`, etc.), and falls back to paragraph clustering when no semantic markup exists.
- **Summarization** — Supports 6 LLM providers out of the box: Groq, OpenAI, Anthropic (Claude), DeepSeek, Google Gemini, and OpenRouter. You bring your own API key.
- **Text-to-Speech** — Powered by [Deepgram Aura](https://deepgram.com/aura) with 18 voice options. Text is chunked and streamed so playback starts within seconds.
- **Floating widget** — Injected via Shadow DOM for full CSS isolation from the host page. Draggable, collapsible, and works on any site.
- **Privacy** — No data is sent anywhere except to the API providers you configure. No analytics, no tracking.

## Installation

### From Source (Developer Mode)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/ikcalvin/Sumrize.git
   ```

2. **Open Chrome** and go to `chrome://extensions/`

3. **Enable Developer mode** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the `Sumrize` folder

5. **Pin the extension** — Click the puzzle icon in Chrome's toolbar and pin Sumrize for quick access

## Setup

After installing, you need to add your API keys:

1. **Open Settings** — Click the gear icon in the Sumrize popup, or right-click the extension icon and select "Options"

2. **Configure your AI provider:**
   - Choose a provider (Groq is free and recommended for getting started)
   - Paste your API key
   - Optionally set a specific model ID

3. **Add your Deepgram API key:**
   - Sign up at [console.deepgram.com](https://console.deepgram.com)
   - Create an API key with Text-to-Speech permissions
   - Paste it in the Deepgram API Key field

4. **Pick a voice** — Choose from 18 Deepgram Aura voices (10 female, 8 male)

5. **Click Save Settings**

### Where to Get API Keys

| Provider | Free Tier | Sign Up |
|----------|-----------|---------|
| Groq | Yes (generous) | [console.groq.com](https://console.groq.com) |
| OpenAI | No (pay-as-you-go) | [platform.openai.com](https://platform.openai.com) |
| Anthropic | No (pay-as-you-go) | [console.anthropic.com](https://console.anthropic.com) |
| DeepSeek | Yes (limited) | [platform.deepseek.com](https://platform.deepseek.com) |
| Google Gemini | Yes | [aistudio.google.com](https://aistudio.google.com) |
| OpenRouter | Varies by model | [openrouter.ai](https://openrouter.ai) |
| Deepgram (TTS) | Yes ($200 credit) | [console.deepgram.com](https://console.deepgram.com) |

## Usage

### Popup Mode
1. Navigate to an article
2. Click the Sumrize extension icon
3. Select a voice from the dropdown
4. Click **Summarize** — wait a few seconds for the AI summary
5. Click **Listen** — audio starts streaming almost immediately

### Floating Widget Mode
1. Click the Sumrize extension icon on any page — a floating play button appears
2. Click the play button — it automatically summarizes and starts reading
3. Drag the widget header to reposition it
4. Use the collapse/close buttons to minimize or dismiss

### Playback Controls
- **Play/Pause** — Toggle audio playback
- **Progress bar** — Click anywhere to seek (works across chunks)
- **Speed** — Adjust from 0.75x to 2x
- **Copy** — Copy the summary text to clipboard

## Project Structure

```
Sumrize/
  background/
    background.js      # Service worker: LLM summarization, Deepgram TTS, message routing
  content/
    content.js         # Floating widget: article extraction, audio playback, Shadow DOM UI
    widget.css         # Widget styles (injected into Shadow DOM)
  options/
    options.html       # Settings page
    options.js         # Settings save/load logic
    options.css        # Settings page styles
  popup/
    popup.html         # Extension popup UI
    popup.js           # Popup logic (summarize, listen, playback)
    popup.css          # Popup styles
  icons/               # Extension icons (16, 48, 128px)
  manifest.json        # Chrome Extension Manifest V3
```

## Tech Stack

- **Chrome Extension Manifest V3** — Service worker, content scripts, Shadow DOM
- **Vanilla JavaScript** — No frameworks, no build step
- **Deepgram Aura TTS** — REST API for text-to-speech
- **Multi-provider LLM** — OpenAI-compatible, Anthropic, and Gemini API formats

## License

MIT
