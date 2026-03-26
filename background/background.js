// Sumrize — Background Service Worker
// Orchestrates Groq summarization, Unreal Speech TTS, and widget injection

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const UNREAL_SPEECH_URL = "https://api.v8.unrealspeech.com/stream";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---- Extension icon click → inject floating widget ----
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/content.js"],
    });
  } catch (err) {
    console.error("Failed to inject content script:", err);
  }
});

// ---- API Keys ----
async function getApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["unrealSpeechApiKey", "groqApiKey"],
      (result) => {
        resolve({
          unrealSpeech: result.unrealSpeechApiKey || "",
          groq: result.groqApiKey || "",
        });
      },
    );
  });
}

// ---- Groq Summarization ----
async function summarizeArticle(title, content) {
  const keys = await getApiKeys();
  if (!keys.groq) {
    throw new Error("Groq API key not set. Go to extension options to add it.");
  }

  const systemPrompt = `You are an expert article summarizer. Provide a clear, concise summary of the given article.
The summary should:
- Be 1 paragraph long
- Capture the key points and main arguments
- Be written in a natural, engaging tone suitable for text-to-speech
- Avoid bullet points or special formatting — use flowing prose
- Start directly with the content, no preamble like "Here is a summary"`;

  const userPrompt = `Article Title: ${title}\n\nArticle Content:\n${content}`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keys.groq}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ---- Text Chunking (Unreal Speech 1000-char limit for /stream) ----
// First chunk is kept smaller (~400 chars) for faster initial playback
function chunkText(text) {
  const FIRST_CHUNK_MAX = 400;
  const REST_CHUNK_MAX = 950;
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks = [];
  let current = "";
  let isFirst = true;

  for (const sentence of sentences) {
    const maxLen = isFirst ? FIRST_CHUNK_MAX : REST_CHUNK_MAX;
    if ((current + sentence).length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        isFirst = false;
      }
      if (sentence.length > REST_CHUNK_MAX) {
        for (let i = 0; i < sentence.length; i += REST_CHUNK_MAX) {
          chunks.push(sentence.substring(i, i + REST_CHUNK_MAX).trim());
        }
        current = "";
      } else {
        current = sentence;
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ---- Unreal Speech TTS (single chunk via /stream endpoint) ----
async function ttsOneChunk(text, voiceId) {
  const keys = await getApiKeys();
  if (!keys.unrealSpeech) {
    throw new Error(
      "Unreal Speech API key not set. Go to extension options to add it.",
    );
  }

  const voice = voiceId || "Autumn";

  const response = await fetch(UNREAL_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keys.unrealSpeech}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Text: text,
      VoiceId: voice,
      Bitrate: "192k",
      Speed: 0,
      Pitch: 1.0,
      Codec: "libmp3lame",
      Temperature: 0.25,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `Unreal Speech error: ${response.status} - ${errText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    summarizeArticle(request.title, request.content)
      .then((summary) => sendResponse({ summary }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === "ttsChunks") {
    const chunks = chunkText(request.text);
    sendResponse({ chunks });
    return false;
  }

  if (request.action === "ttsOne") {
    ttsOneChunk(request.text, request.voice)
      .then((audioBase64) => sendResponse({ audioBase64 }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === "checkKeys") {
    getApiKeys()
      .then((keys) =>
        sendResponse({
          hasGroq: !!keys.groq,
          hasTts: !!keys.unrealSpeech,
        }),
      )
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === "openOptions") {
    chrome.runtime.openOptionsPage();
    return false;
  }
});
