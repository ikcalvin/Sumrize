// Sumrize — Background Service Worker
// Orchestrates Groq summarization, Unreal Speech TTS, and widget injection

const UNREAL_SPEECH_URL = "https://api.v8.unrealspeech.com/stream";

const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai",
    defaultModel: "llama-3.3-70b-versatile"
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    format: "openai",
    defaultModel: "gpt-4o-mini"
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    format: "openai",
    defaultModel: "deepseek-chat"
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    format: "openai",
    defaultModel: "openai/gpt-4o-mini"
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    format: "anthropic",
    defaultModel: "claude-3-5-haiku-latest"
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
    format: "gemini",
    defaultModel: "gemini-1.5-flash"
  }
};

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
      ["llmProvider", "llmApiKey", "llmModel", "unrealSpeechApiKey", "selectedVoice", "groqApiKey"],
      (result) => {
        resolve({
          llmProvider: result.llmProvider || "groq",
          llmApiKey: result.llmApiKey || result.groqApiKey || "",
          llmModel: result.llmModel || "",
          unrealSpeech: result.unrealSpeechApiKey || "",
          selectedVoice: result.selectedVoice || "Autumn"
        });
      },
    );
  });
}

// ---- Summarization ----
async function summarizeArticle(title, content) {
  const keys = await getApiKeys();
  if (!keys.llmApiKey) {
    throw new Error("AI provider API key not set. Go to extension options to add it.");
  }

  const pInfo = PROVIDERS[keys.llmProvider];
  if (!pInfo) throw new Error("Unknown provider: " + keys.llmProvider);
  
  const model = keys.llmModel || pInfo.defaultModel;

  const systemPrompt = `You are an expert article summarizer. Provide a clear, concise summary of the given article.
The summary should:
- Be 1 paragraph long
- Capture the key points and main arguments
- Be written in a natural, engaging tone suitable for text-to-speech
- Avoid bullet points or special formatting — use flowing prose
- Start directly with the content, no preamble like "Here is a summary"`;

  const userPrompt = `Article Title: ${title}\n\nArticle Content:\n${content}`;

  let requestUrl = pInfo.url;
  let requestHeaders = {
    "Content-Type": "application/json"
  };
  let requestBody = {};
  let extractText = (data) => "";

  if (pInfo.format === "openai") {
    requestHeaders["Authorization"] = `Bearer ${keys.llmApiKey}`;
    if (keys.llmProvider === "openrouter") {
      requestHeaders["HTTP-Referer"] = "https://sumrize.com"; 
      requestHeaders["X-Title"] = "Sumrize";
    }
    requestBody = {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 1024
    };
    extractText = (data) => data.choices[0].message.content;
  } else if (pInfo.format === "anthropic") {
    requestHeaders["x-api-key"] = keys.llmApiKey;
    requestHeaders["anthropic-version"] = "2023-06-01";
    requestHeaders["anthropic-cors-bypass"] = "true";
    requestBody = {
      model: model,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 1024
    };
    extractText = (data) => data.content[0].text;
  } else if (pInfo.format === "gemini") {
    requestUrl = pInfo.url.replace("{MODEL}", model) + `?key=${keys.llmApiKey}`;
    requestBody = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 1024
      }
    };
    extractText = (data) => data.candidates[0].content.parts[0].text;
  }

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    let err = {};
    try { err = JSON.parse(errText); } catch(e) {}
    const msg = err.error?.message || errText;
    throw new Error(`API error (${keys.llmProvider}): ${response.status} - ${msg}`);
  }

  const data = await response.json();
  return extractText(data);
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

  const voice = voiceId || keys.selectedVoice || "Autumn";

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
          hasGroq: !!keys.llmApiKey,
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
