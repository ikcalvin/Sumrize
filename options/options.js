// Sumrize — Options Page Logic

document.addEventListener("DOMContentLoaded", () => {
  const llmProvider = document.getElementById("llmProvider");
  const llmKey = document.getElementById("llmKey");
  const llmModel = document.getElementById("llmModel");
  const llmKeyDesc = document.getElementById("llmKeyDesc");
  const deepgramInput = document.getElementById("deepgramKey");
  const voiceSelect = document.getElementById("voiceSelect");
  const saveBtn = document.getElementById("saveBtn");
  const successMsg = document.getElementById("successMsg");

  const providerDefaults = {
    groq: { desc: "Free at console.groq.com", model: "llama-3.3-70b-versatile" },
    openai: { desc: "Get your key at platform.openai.com", model: "gpt-4o-mini" },
    anthropic: { desc: "Get your key at console.anthropic.com", model: "claude-3-5-haiku-latest" },
    deepseek: { desc: "Get your key at platform.deepseek.com", model: "deepseek-chat" },
    gemini: { desc: "Get your key at aistudio.google.com", model: "gemini-1.5-flash" },
    openrouter: { desc: "Get your key at openrouter.ai", model: "openai/gpt-4o-mini" }
  };

  function updatePlaceholders() {
    const provider = llmProvider.value;
    const defs = providerDefaults[provider];
    if (defs) {
      llmKeyDesc.textContent = defs.desc;
      llmModel.placeholder = `e.g. ${defs.model}`;
      if (!llmModel.value) llmModel.value = defs.model;
    }
  }

  llmProvider.addEventListener("change", updatePlaceholders);

  // Load saved keys
  chrome.storage.sync.get(
    ["llmProvider", "llmApiKey", "llmModel", "deepgramApiKey", "selectedVoice"],
    (result) => {
      if (result.llmProvider) llmProvider.value = result.llmProvider;
      if (result.llmApiKey) llmKey.value = result.llmApiKey;
      if (result.llmModel) llmModel.value = result.llmModel;
      if (result.deepgramApiKey) deepgramInput.value = result.deepgramApiKey;
      if (result.selectedVoice) voiceSelect.value = result.selectedVoice;

      updatePlaceholders();
    },
  );

  // Toggle visibility buttons
  document.querySelectorAll(".toggle-vis").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      target.type = target.type === "password" ? "text" : "password";
    });
  });

  // Save
  saveBtn.addEventListener("click", () => {
    chrome.storage.sync.set(
      {
        llmProvider: llmProvider.value,
        llmApiKey: llmKey.value.trim(),
        llmModel: llmModel.value.trim(),
        deepgramApiKey: deepgramInput.value.trim(),
        selectedVoice: voiceSelect.value
      },
      () => {
        successMsg.classList.remove("hidden");
        setTimeout(() => successMsg.classList.add("hidden"), 3000);
      },
    );
  });
});
