// Sumrize — Content Script
// Injects a floating widget into the page with Shadow DOM isolation
// Handles article extraction, UI, and audio playback (persists after click-away)

(function () {
  // Prevent double-injection
  if (document.getElementById("sumrize-root")) {
    const existing = document.getElementById("sumrize-root");
    const widget = existing.shadowRoot.querySelector(".sumrize-widget");
    const fabBtn = existing.shadowRoot.querySelector(".sumrize-fab");
    if (widget && fabBtn) {
      if (widget.classList.contains("hidden")) {
        fabBtn.click();
      } else {
        widget.classList.toggle("collapsed");
      }
    }
    return;
  }

  // ---- State ----
  let currentSummary = "";
  let currentTitle = "";
  let audioQueue = [];
  let currentChunkIdx = 0;
  let isPlaying = false;
  let totalDuration = 0;
  let elapsedBefore = 0;
  let streamAborted = false;
  let totalChunks = 0;

  // ---- Create Shadow DOM host ----
  const host = document.createElement("div");
  host.id = "sumrize-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  // Load styles
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("content/widget.css");
  shadow.appendChild(styleLink);

  // ---- Build FAB HTML ----
  const fab = document.createElement("button");
  fab.className = "sumrize-fab";
  fab.title = "Summarize & Play";
  fab.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  shadow.appendChild(fab);

  // ---- Build widget HTML ----
  const widget = document.createElement("div");
  widget.className = "sumrize-widget hidden";
  widget.innerHTML = `
    <!-- Header -->
    <div class="widget-header" id="dragHandle">
      <div class="header-left">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#sg)" opacity="0.15"/>
          <path d="M9 9h6M9 12h6M9 15h4" stroke="url(#sg)" stroke-width="1.8" stroke-linecap="round"/>
          <defs><linearGradient id="sg" x1="2" y1="2" x2="22" y2="22"><stop stop-color="#a78bfa"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
        </svg>
        <span class="logo-text">Sumrize</span>
      </div>
      <div class="header-right">
        <button class="icon-btn" id="settingsBtn" title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
        <button class="icon-btn" id="collapseBtn" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="icon-btn" id="closeBtn" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="widget-body">
      <!-- Status -->
      <div class="status-bar hidden" id="statusBar">
        <div class="status-dot"></div>
        <span id="statusText"></span>
      </div>

      <!-- Key warning -->
      <div class="key-warning hidden" id="keyWarning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>API keys missing. <a id="openSettings">Set up keys →</a></span>
      </div>

      <!-- Summary -->
      <div class="summary-box hidden" id="summaryBox">
        <div class="summary-title">
          <span class="summary-title-text" id="articleTitle"></span>
          <button class="copy-btn" id="copyBtn" title="Copy summary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>
        <div class="summary-content" id="summaryText"></div>
      </div>

      <!-- Player -->
      <div class="player-box hidden" id="playerBox">
        <div class="progress-track" id="progressTrack">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div class="time-row">
          <span id="currentTime">0:00</span>
          <span id="totalTime">0:00</span>
        </div>
        <div class="player-controls">
          <button class="play-btn" id="playPauseBtn">
            <svg id="playIcon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg id="pauseIcon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="hidden"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <div class="speed-wrap">
            <span class="speed-label">Speed</span>
            <select id="speedSelect" class="speed-select">
              <option value="0.75">0.75×</option>
              <option value="1" selected>1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="toast" id="toast"></div>
  `;
  shadow.appendChild(widget);

  // ---- DOM refs (inside shadow) ----
  const $ = (sel) => shadow.querySelector(sel);
  const fabBtn = $(".sumrize-fab");
  const statusBar = $("#statusBar");
  const statusText = $("#statusText");
  const keyWarning = $("#keyWarning");
  const keyWarningText = $("#keyWarning span");
  const summaryBox = $("#summaryBox");
  const articleTitle = $("#articleTitle");
  const summaryText = $("#summaryText");
  const playerBox = $("#playerBox");
  const progressFill = $("#progressFill");
  const progressTrack = $("#progressTrack");
  const currentTimeEl = $("#currentTime");
  const totalTimeEl = $("#totalTime");
  const playPauseBtn = $("#playPauseBtn");
  const playIcon = $("#playIcon");
  const pauseIcon = $("#pauseIcon");
  const speedSelect = $("#speedSelect");
  const toastEl = $("#toast");

  // ---- Init ----
  sendBg({ action: "checkKeys" }, (r) => {
    if (r) {
      if (!r.hasGroq && !r.hasTts) {
        keyWarningText.innerHTML = `API keys missing. <a id="openSettings">Set up keys →</a>`;
        keyWarning.classList.remove("hidden");
      } else if (!r.hasGroq) {
        keyWarningText.innerHTML = `AI Provider key missing. <a id="openSettings">Set up key →</a>`;
        keyWarning.classList.remove("hidden");
      } else if (!r.hasTts) {
        keyWarningText.innerHTML = `TTS Audio key missing. <a id="openSettings">Set up key →</a>`;
        keyWarning.classList.remove("hidden");
      }
      
      // Re-attach event listeners for dynamically added links
      const link = $("#openSettings");
      if (link) {
        link.addEventListener("click", () => sendBg({ action: "openOptions" }));
      }
    }
  });

  // ---- Events ----

  $("#settingsBtn").addEventListener("click", () =>
    sendBg({ action: "openOptions" }),
  );

  $("#collapseBtn").addEventListener("click", () =>
    widget.classList.toggle("collapsed"),
  );
  $("#closeBtn").addEventListener("click", () => {
    stopAllAudio();
    widget.classList.add("hidden");
    fabBtn.classList.remove("hidden");
  });

  playPauseBtn.addEventListener("click", togglePlayPause);
  fabBtn.addEventListener("click", handleQuickPlay);

  speedSelect.addEventListener("change", () => {
    if (audioQueue.length > 0 && audioQueue[currentChunkIdx]) {
      audioQueue[currentChunkIdx].audio.playbackRate = parseFloat(
        speedSelect.value,
      );
    }
  });

  progressTrack.addEventListener("click", (e) => {
    // Only allow seeking within the current chunk (approximate)
    if (!audioQueue[currentChunkIdx]) return;
    const rect = progressTrack.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetGlobal = ratio * totalDuration;
    // Find which chunk this falls into
    let cumulative = 0;
    for (let i = 0; i < audioQueue.length; i++) {
      if (!audioQueue[i]) break;
      if (cumulative + audioQueue[i].duration >= targetGlobal) {
        if (i !== currentChunkIdx) {
          audioQueue[currentChunkIdx].audio.pause();
          audioQueue[currentChunkIdx].audio.removeEventListener(
            "timeupdate",
            onTimeUpdate,
          );
        }
        currentChunkIdx = i;
        elapsedBefore = cumulative;
        audioQueue[i].audio.currentTime = targetGlobal - cumulative;
        if (isPlaying) {
          audioQueue[i].audio.playbackRate = parseFloat(speedSelect.value);
          audioQueue[i].audio.addEventListener("timeupdate", onTimeUpdate);
          audioQueue[i].audio.play();
        }
        break;
      }
      cumulative += audioQueue[i].duration;
    }
  });

  // ---- Dragging ----
  setupDrag($("#dragHandle"), widget);

  // ---- Article Extraction ----
  function extractArticle() {
    const article = document.querySelector("article");
    if (article) return cleanExtraction(article);

    const selectors = [
      '[role="main"]',
      "main",
      ".post-content",
      ".article-content",
      ".entry-content",
      ".story-body",
      ".article-body",
      "#article-body",
      ".post-body",
      ".content-body",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 200) return cleanExtraction(el);
    }

    // heuristic paragraph cluster
    const paragraphs = document.querySelectorAll("p");
    const parentMap = new Map();
    let bestParent = null,
      bestScore = 0;
    paragraphs.forEach((p) => {
      const par = p.parentElement;
      if (!par) return;
      const len = p.innerText.trim().length;
      if (len < 20) return;
      const cur = parentMap.get(par) || { el: par, score: 0, count: 0 };
      cur.score += len;
      cur.count++;
      parentMap.set(par, cur);
    });
    parentMap.forEach((v) => {
      if (v.score > bestScore && v.count >= 3) {
        bestScore = v.score;
        bestParent = v.el;
      }
    });
    if (bestParent) return cleanExtraction(bestParent);

    return {
      title: document.title,
      content: document.body.innerText.substring(0, 10000),
      url: location.href,
    };
  }

  function cleanExtraction(el) {
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll(
        'script,style,nav,footer,aside,.ad,.ads,.advertisement,.social-share,.comments,.sidebar,iframe,form,button,input,select,textarea,[role="navigation"],[role="complementary"]',
      )
      .forEach((n) => n.remove());
    const text = clone.innerText
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\t+/g, " ")
      .trim();
    const title =
      document.querySelector("h1")?.innerText?.trim() ||
      document.querySelector('[class*="title"]')?.innerText?.trim() ||
      document.title;
    return { title, content: text.substring(0, 15000), url: location.href };
  }

  // ---- Quick Play ----
  async function handleQuickPlay() {
    fabBtn.classList.add("hidden");
    widget.classList.remove("hidden");
    await handleSummarize();
    if (currentSummary && !streamAborted) {
      await handleListen();
    }
  }

  // ---- Summarize ----
  async function handleSummarize() {
    showStatus("Extracting article...");

    try {
      const result = extractArticle();
      if (!result || !result.content || result.content.trim().length < 50) {
        throw new Error("Could not extract article content from this page.");
      }

      showStatus("Summarizing with AI...");
      const resp = await sendBgAsync({
        action: "summarize",
        title: result.title,
        content: result.content,
      });
      if (resp.error) throw new Error(resp.error);

      currentSummary = resp.summary;
      currentTitle = result.title;

      articleTitle.textContent = currentTitle;
      summaryText.textContent = currentSummary;
      summaryBox.classList.remove("hidden");
      hideStatus();
    } catch (err) {
      showStatus(err.message, true);
      setTimeout(hideStatus, 5000);
    }
  }

  // ---- Streaming TTS ----
  async function handleListen() {
    if (!currentSummary) return;

    stopAllAudio();
    audioQueue = [];
    currentChunkIdx = 0;
    totalDuration = 0;
    elapsedBefore = 0;
    isPlaying = false;
    streamAborted = false;

    showStatus("Preparing audio...");

    try {
      const { chunks, error: cErr } = await sendBgAsync({
        action: "ttsChunks",
        text: currentSummary,
      });
      if (cErr) throw new Error(cErr);
      if (!chunks || chunks.length === 0) throw new Error("No text to convert");

      totalChunks = chunks.length;
      showStatus(`Streaming (0/${totalChunks})...`);
      playerBox.classList.remove("hidden");
      progressFill.style.width = "0%";
      currentTimeEl.textContent = "0:00";
      totalTimeEl.textContent = "...";

      let fetchedCount = 0;

      const fetchChunk = async (i) => {
        if (streamAborted) return;
        const resp = await sendBgAsync({
          action: "ttsOne",
          text: chunks[i]
        });
        if (resp.error) throw new Error(resp.error);

        const blob = base64ToBlob(resp.audioBase64, "audio/mpeg");
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = parseFloat(speedSelect.value);

        await new Promise((res, rej) => {
          audio.addEventListener("loadedmetadata", res, { once: true });
          audio.addEventListener("error", rej, { once: true });
        });

        audioQueue[i] = { audio, duration: audio.duration, url };
        totalDuration += audio.duration;
        totalTimeEl.textContent = formatTime(totalDuration);
        fetchedCount++;
        if (fetchedCount < totalChunks) {
          showStatus(`Streaming (${fetchedCount}/${totalChunks})...`);
        } else {
          hideStatus();
        }

        // Start playback as soon as first chunk is ready
        if (i === 0 && !isPlaying && !streamAborted) {
          playChunk(0);
        }
      };

      // Pre-fetch first 2 chunks in parallel for faster start
      const firstBatch =
        chunks.length >= 2
          ? await Promise.all([fetchChunk(0), fetchChunk(1)]).then(() => 2)
          : await fetchChunk(0).then(() => 1);

      // Fetch remaining chunks sequentially
      for (let i = firstBatch; i < chunks.length; i++) {
        if (streamAborted) break;
        await fetchChunk(i);
      }
    } catch (err) {
      playerBox.classList.add("hidden");
      showStatus(err.message, true);
      setTimeout(hideStatus, 5000);
    }
  }

  function playChunk(idx) {
    if (streamAborted || !audioQueue[idx]) return;
    currentChunkIdx = idx;
    isPlaying = true;
    elapsedBefore = 0;
    for (let i = 0; i < idx; i++)
      if (audioQueue[i]) elapsedBefore += audioQueue[i].duration;

    const { audio } = audioQueue[idx];
    audio.playbackRate = parseFloat(speedSelect.value);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener(
      "ended",
      () => {
        audio.removeEventListener("timeupdate", onTimeUpdate);
        const nextIdx = idx + 1;
        if (nextIdx >= totalChunks) {
          // All chunks truly finished
          isPlaying = false;
          playIcon.classList.remove("hidden");
          pauseIcon.classList.add("hidden");
          progressFill.style.width = "100%";
        } else if (audioQueue[nextIdx]) {
          // Next chunk is ready, play it immediately
          playChunk(nextIdx);
        } else {
          // Next chunk still fetching, wait for it
          showStatus("Buffering...");
          waitForChunk(nextIdx);
        }
      },
      { once: true },
    );

    audio.play();
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
  }

  function waitForChunk(idx) {
    const t = setInterval(() => {
      if (streamAborted) {
        clearInterval(t);
        return;
      }
      if (audioQueue[idx]) {
        clearInterval(t);
        hideStatus();
        playChunk(idx);
      }
    }, 100);
  }

  function onTimeUpdate() {
    if (!audioQueue[currentChunkIdx]) return;
    const cur = audioQueue[currentChunkIdx].audio;
    const g = elapsedBefore + (cur.currentTime || 0);
    progressFill.style.width =
      (totalDuration > 0 ? (g / totalDuration) * 100 : 0) + "%";
    currentTimeEl.textContent = formatTime(g);
  }

  function togglePlayPause() {
    if (audioQueue.length === 0 || !audioQueue[currentChunkIdx]) return;
    const { audio } = audioQueue[currentChunkIdx];
    if (audio.paused) {
      audio.play();
      isPlaying = true;
      playIcon.classList.add("hidden");
      pauseIcon.classList.remove("hidden");
    } else {
      audio.pause();
      isPlaying = false;
      playIcon.classList.remove("hidden");
      pauseIcon.classList.add("hidden");
    }
  }

  function stopAllAudio() {
    streamAborted = true;
    for (const item of audioQueue) {
      if (item?.audio) {
        item.audio.pause();
        item.audio.removeEventListener("timeupdate", onTimeUpdate);
        URL.revokeObjectURL(item.url);
      }
    }
  }

  // ---- Copy ----
  $("#copyBtn").addEventListener("click", () => {
    navigator.clipboard
      .writeText(currentSummary)
      .then(() => showToast("Copied!"));
  });

  // ---- Helpers ----
  function sendBg(msg, cb) {
    chrome.runtime.sendMessage(msg, cb || (() => {}));
  }
  function sendBgAsync(msg) {
    return new Promise((res) =>
      chrome.runtime.sendMessage(msg, (r) =>
        res(r || { error: "No response" }),
      ),
    );
  }

  function base64ToBlob(b64, mime) {
    const chars = atob(b64),
      nums = new Array(chars.length);
    for (let i = 0; i < chars.length; i++) nums[i] = chars.charCodeAt(i);
    return new Blob([new Uint8Array(nums)], { type: mime });
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    return `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, "0")}`;
  }

  function showStatus(msg, isError = false) {
    statusText.textContent = msg;
    statusBar.classList.remove("hidden");
    statusBar.classList.toggle("error", isError);
  }

  function hideStatus() {
    statusBar.classList.add("hidden");
  }

  function setLoading(btn, on) {
    btn.classList.toggle("loading", on);
    btn.disabled = on;
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2000);
  }

  // ---- Drag ----
  function setupDrag(handle, el) {
    let dx = 0,
      dy = 0,
      startX = 0,
      startY = 0,
      dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      dx = rect.left;
      dy = rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const newX = dx + (e.clientX - startX);
      const newY = dy + (e.clientY - startY);
      el.style.left = newX + "px";
      el.style.top = newY + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }
})();
