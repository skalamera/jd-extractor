const input = document.getElementById("api-key");
const btnSave = document.getElementById("btn-save");
const status = document.getElementById("status");

// Load existing key on open
chrome.storage.local.get({ geminiApiKey: "" }, (data) => {
  if (data.geminiApiKey) input.value = data.geminiApiKey;
});

btnSave.addEventListener("click", () => {
  const key = input.value.trim();
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    status.classList.add("show");
    setTimeout(() => status.classList.remove("show"), 2500);
  });
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnSave.click();
});
