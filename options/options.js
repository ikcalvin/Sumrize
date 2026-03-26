// Sumrize — Options Page Logic

document.addEventListener("DOMContentLoaded", () => {
  const groqInput = document.getElementById("groqKey");
  const unrealSpeechInput = document.getElementById("unrealSpeechKey");
  const saveBtn = document.getElementById("saveBtn");
  const successMsg = document.getElementById("successMsg");

  // Load saved keys
  chrome.storage.sync.get(
    ["groqApiKey", "unrealSpeechApiKey"],
    (result) => {
      if (result.groqApiKey) groqInput.value = result.groqApiKey;
      if (result.unrealSpeechApiKey)
        unrealSpeechInput.value = result.unrealSpeechApiKey;
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
    const groqKey = groqInput.value.trim();
    const unrealSpeechKey = unrealSpeechInput.value.trim();

    chrome.storage.sync.set(
      {
        groqApiKey: groqKey,
        unrealSpeechApiKey: unrealSpeechKey,
      },
      () => {
        successMsg.classList.remove("hidden");
        setTimeout(() => successMsg.classList.add("hidden"), 3000);
      },
    );
  });
});
