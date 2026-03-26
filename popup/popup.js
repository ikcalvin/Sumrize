// Sumrize — Popup Logic

document.addEventListener('DOMContentLoaded', init);

// State
let currentSummary = '';
let currentTitle = '';
let audioPlayer = null;

// DOM refs
const voiceSelect = document.getElementById('voiceSelect');
const summarizeBtn = document.getElementById('summarizeBtn');
const listenBtn = document.getElementById('listenBtn');
const settingsBtn = document.getElementById('settingsBtn');
const openSettings = document.getElementById('openSettings');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');
const keyWarning = document.getElementById('keyWarning');
const summaryContainer = document.getElementById('summaryContainer');
const summaryTextEl = document.getElementById('summaryText');
const articleTitleEl = document.getElementById('articleTitle');
const copySummary = document.getElementById('copySummary');
const playerContainer = document.getElementById('playerContainer');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const progressFill = document.getElementById('progressFill');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const speedSelect = document.getElementById('speedSelect');
const progressBar = document.querySelector('.player-progress-bar');

async function init() {
  // Load saved voice
  chrome.storage.sync.get(['selectedVoice'], (result) => {
    if (result.selectedVoice) {
      voiceSelect.value = result.selectedVoice;
    }
  });

  // Check API keys
  chrome.runtime.sendMessage({ action: 'checkKeys' }, (response) => {
    if (response && (!response.hasGroq || !response.hasDeepgram)) {
      keyWarning.classList.remove('hidden');
    }
  });

  // Event listeners
  voiceSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ selectedVoice: voiceSelect.value });
  });

  summarizeBtn.addEventListener('click', handleSummarize);
  listenBtn.addEventListener('click', handleListen);

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  openSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  copySummary.addEventListener('click', () => {
    navigator.clipboard.writeText(currentSummary).then(() => {
      showToast('Summary copied!');
    });
  });

  playPauseBtn.addEventListener('click', togglePlayPause);

  speedSelect.addEventListener('change', () => {
    if (audioQueue.length > 0 && audioQueue[currentChunkIdx]) {
      audioQueue[currentChunkIdx].audio.playbackRate = parseFloat(speedSelect.value);
    }
  });

  progressBar.addEventListener('click', (e) => {
    if (!audioPlayer) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioPlayer.currentTime = ratio * audioPlayer.duration;
  });
}

// ---- Summarize ----
async function handleSummarize() {
  showStatus('Extracting article...');
  setLoading(summarizeBtn, true);
  listenBtn.disabled = true;

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject content script if needed and extract article
    let result;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' });
      result = response;
    } catch {
      // Content script not loaded, inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js'],
      });
      // Small delay to let content script initialize
      await new Promise((r) => setTimeout(r, 200));
      result = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' });
    }

    if (!result || !result.content || result.content.trim().length < 50) {
      throw new Error('Could not extract article content from this page.');
    }

    showStatus('Summarizing with AI...');

    // Send to background for summarization
    const summaryResponse = await sendMessage({
      action: 'summarize',
      title: result.title,
      content: result.content,
    });

    if (summaryResponse.error) {
      throw new Error(summaryResponse.error);
    }

    currentSummary = summaryResponse.summary;
    currentTitle = result.title;

    // Display summary
    articleTitleEl.textContent = currentTitle;
    summaryTextEl.textContent = currentSummary;
    summaryContainer.classList.remove('hidden');
    listenBtn.disabled = false;

    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
    setTimeout(hideStatus, 5000);
  } finally {
    setLoading(summarizeBtn, false);
  }
}

// ---- Listen (Streaming TTS) ----
// Audio chunk queue for streaming playback
let audioQueue = [];       // Array of { audio: Audio, duration: number }
let currentChunkIdx = 0;
let isPlaying = false;
let totalDuration = 0;
let elapsedBefore = 0;     // cumulative duration of chunks already played
let streamAborted = false;

async function handleListen() {
  if (!currentSummary) return;

  // Reset streaming state
  stopAllAudio();
  audioQueue = [];
  currentChunkIdx = 0;
  totalDuration = 0;
  elapsedBefore = 0;
  isPlaying = false;
  streamAborted = false;

  showStatus('Preparing audio stream...');
  setLoading(listenBtn, true);

  try {
    const voice = voiceSelect.value;

    // 1. Get text chunks from background
    const { chunks, error: chunkErr } = await sendMessage({
      action: 'ttsChunks',
      text: currentSummary,
    });

    if (chunkErr) throw new Error(chunkErr);
    if (!chunks || chunks.length === 0) throw new Error('No text to convert');

    showStatus(`Streaming audio (0/${chunks.length})...`);
    playerContainer.classList.remove('hidden');
    progressFill.style.width = '0%';
    currentTimeEl.textContent = '0:00';
    totalTimeEl.textContent = '...';

    // 2. Start fetching chunks — pre-fetch 1 ahead for smooth playback
    let fetchedCount = 0;

    const fetchChunk = async (index) => {
      if (streamAborted) return;
      const resp = await sendMessage({
        action: 'ttsOne',
        text: chunks[index],
        voice: voice,
      });
      if (resp.error) throw new Error(resp.error);

      // Create Audio element from base64
      const blob = base64ToBlob(resp.audioBase64, 'audio/mpeg');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = parseFloat(speedSelect.value);

      // Wait for metadata to get duration
      await new Promise((resolve, reject) => {
        audio.addEventListener('loadedmetadata', resolve, { once: true });
        audio.addEventListener('error', reject, { once: true });
      });

      audioQueue[index] = { audio, duration: audio.duration, url };
      totalDuration += audio.duration;
      totalTimeEl.textContent = formatTime(totalDuration);

      fetchedCount++;
      showStatus(`Streaming audio (${fetchedCount}/${chunks.length})...`);

      // Start playback as soon as the first chunk is ready
      if (index === 0 && !isPlaying && !streamAborted) {
        playChunk(0);
        setLoading(listenBtn, false);
        hideStatus();
      }
    };

    // Fetch first chunk, then pipeline the rest
    await fetchChunk(0);

    // Fetch remaining chunks with 1-ahead buffering
    for (let i = 1; i < chunks.length; i++) {
      if (streamAborted) break;
      await fetchChunk(i);
    }

  } catch (err) {
    showStatus(err.message, true);
    setTimeout(hideStatus, 5000);
    setLoading(listenBtn, false);
  }
}

function playChunk(index) {
  if (streamAborted || index >= audioQueue.length || !audioQueue[index]) return;

  currentChunkIdx = index;
  isPlaying = true;

  // Calculate elapsed time from previous chunks
  elapsedBefore = 0;
  for (let i = 0; i < index; i++) {
    if (audioQueue[i]) elapsedBefore += audioQueue[i].duration;
  }

  const { audio } = audioQueue[index];
  audio.playbackRate = parseFloat(speedSelect.value);

  // Progress tracking
  audio.addEventListener('timeupdate', onTimeUpdate);

  // When this chunk ends, play the next one
  audio.addEventListener('ended', () => {
    audio.removeEventListener('timeupdate', onTimeUpdate);

    if (index + 1 < audioQueue.length && audioQueue[index + 1]) {
      playChunk(index + 1);
    } else if (index + 1 >= audioQueue.length) {
      // All chunks finished
      isPlaying = false;
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      progressFill.style.width = '100%';
    }
    // else: next chunk not ready yet — wait via polling
    else {
      waitForChunk(index + 1);
    }
  }, { once: true });

  audio.play();
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');
}

function waitForChunk(index) {
  const check = setInterval(() => {
    if (streamAborted) {
      clearInterval(check);
      return;
    }
    if (audioQueue[index]) {
      clearInterval(check);
      playChunk(index);
    }
  }, 100);
}

function onTimeUpdate() {
  if (!audioQueue[currentChunkIdx]) return;
  const current = audioQueue[currentChunkIdx].audio;
  const globalTime = elapsedBefore + (current.currentTime || 0);
  const pct = totalDuration > 0 ? (globalTime / totalDuration) * 100 : 0;
  progressFill.style.width = pct + '%';
  currentTimeEl.textContent = formatTime(globalTime);
}

function stopAllAudio() {
  streamAborted = true;
  for (const item of audioQueue) {
    if (item && item.audio) {
      item.audio.pause();
      item.audio.removeEventListener('timeupdate', onTimeUpdate);
      URL.revokeObjectURL(item.url);
    }
  }
  audioPlayer = null;
}

// ---- Playback controls ----
function togglePlayPause() {
  if (audioQueue.length === 0) return;
  const current = audioQueue[currentChunkIdx];
  if (!current) return;

  if (current.audio.paused) {
    current.audio.play();
    isPlaying = true;
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  } else {
    current.audio.pause();
    isPlaying = false;
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  }
}

// ---- Helpers ----
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response || { error: 'No response from background worker' });
    });
  });
}

function base64ToBlob(base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusBanner.classList.remove('hidden');
  const dot = statusBanner.querySelector('.status-dot');
  dot.style.background = isError ? 'var(--error)' : 'var(--accent)';
  statusBanner.style.borderColor = isError
    ? 'rgba(248, 113, 113, 0.2)'
    : 'var(--border-color)';
  statusBanner.style.background = isError
    ? 'rgba(248, 113, 113, 0.08)'
    : 'var(--accent-dim)';
  statusBanner.style.color = isError ? 'var(--error)' : 'var(--accent-hover)';
}

function hideStatus() {
  statusBanner.classList.add('hidden');
}

function setLoading(btn, loading) {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
