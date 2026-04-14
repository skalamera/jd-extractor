const container = document.getElementById("clips-container");
const countEl = document.getElementById("clip-count");
const btnDownload = document.getElementById("btn-download");
const btnClear = document.getElementById("btn-clear");

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(clips, activeIdx) {
  countEl.textContent = clips.length;
  btnDownload.disabled = clips.length === 0;
  btnClear.disabled = clips.length === 0;

  if (clips.length === 0) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">&#9986;</div>
      No clips yet.<br>
      Highlight text on any page, right-click,<br>
      and choose <strong>Save to Text Clipper</strong>.
    </div>`;
    return;
  }

  container.innerHTML = "";
  clips.forEach((clip, idx) => {
    const isActive = idx === activeIdx;
    const div = document.createElement("div");
    div.className = "clip" + (isActive ? " active" : "");
    div.dataset.idx = idx;

    const safeText = clip.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeUrl = (clip.url || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    div.innerHTML = `
      <div class="active-label">Active JD &mdash; used for AI answers</div>
      <div class="clip-top">
        <div class="clip-text">${safeText}</div>
        <button class="clip-delete" data-idx="${idx}" title="Remove clip">&times;</button>
      </div>
      <div class="clip-meta">
        <span class="clip-url" title="${safeUrl}">${safeUrl}</span>
        <span class="clip-date">${formatDate(clip.savedAt)}</span>
      </div>
      <div class="clip-actions">
        <button class="btn-action" data-gen="cv" data-idx="${idx}" title="Generate tailored resume for this JD">Resume</button>
        <button class="btn-action" data-gen="cover" data-idx="${idx}" title="Generate tailored cover letter for this JD">Cover Letter</button>
        <button class="btn-action primary" data-gen="both" data-idx="${idx}" title="Generate resume + cover letter">Both</button>
        <button class="btn-active" data-set-active="${idx}" title="Set as active JD for right-click AI answers">Set Active</button>
      </div>
      <div class="gen-feedback" data-fb="${idx}"></div>
    `;
    container.appendChild(div);
  });
}

function load() {
  chrome.storage.local.get({ clips: [], activeClipIdx: null }, (data) => {
    render(data.clips, data.activeClipIdx);
  });
}

// ── Event delegation ──────────────────────────────────────────────────────────

container.addEventListener("click", (e) => {
  // Delete
  const delBtn = e.target.closest(".clip-delete");
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.idx, 10);
    chrome.storage.local.get({ clips: [], activeClipIdx: null }, (data) => {
      data.clips.splice(idx, 1);
      let newActive = data.activeClipIdx;
      if (data.clips.length === 0) {
        newActive = null;
      } else if (newActive === idx) {
        newActive = data.clips.length - 1;
      } else if (newActive > idx) {
        newActive = newActive - 1;
      }
      chrome.storage.local.set({ clips: data.clips, activeClipIdx: newActive }, load);
    });
    return;
  }

  // Set active
  const activeBtn = e.target.closest("[data-set-active]");
  if (activeBtn) {
    const idx = parseInt(activeBtn.dataset.setActive, 10);
    chrome.storage.local.set({ activeClipIdx: idx }, load);
    return;
  }

  // Generate
  const genBtn = e.target.closest(".btn-action[data-gen]");
  if (genBtn && !genBtn.disabled) {
    const idx = parseInt(genBtn.dataset.idx, 10);
    const type = genBtn.dataset.gen;
    handleGenerate(idx, type);
  }
});

// ── Document generation ───────────────────────────────────────────────────────

const GEN_LABELS = { cv: "Resume", cover: "Cover Letter", both: "Both" };

async function handleGenerate(clipIdx, type) {
  const card = container.querySelector(`.clip[data-idx="${clipIdx}"]`);
  if (!card) return;

  const buttons = card.querySelectorAll(".btn-action[data-gen]");
  const clickedBtn = card.querySelector(`.btn-action[data-gen="${type}"]`);
  const feedback = card.querySelector(`[data-fb="${clipIdx}"]`);

  // Lock buttons + show spinner
  buttons.forEach(b => b.disabled = true);
  if (clickedBtn) {
    clickedBtn.dataset.origLabel = clickedBtn.textContent;
    clickedBtn.innerHTML = `<span class="spinner"></span> Generating`;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "generate",
      type,
      clipIdx
    });

    if (result.error) throw new Error(result.error);

    const date = new Date().toISOString().slice(0, 10);
    const { lastName, company } = result;

    const count = result.count || 1;
    const msg = count > 1 ? `${count} tabs opened — save each as PDF` : "Tab opened — save as PDF";
    showFeedback(feedback, "success", msg);
  } catch (err) {
    showFeedback(feedback, "error", err.message);
  }

  // Restore buttons
  buttons.forEach(b => b.disabled = false);
  if (clickedBtn) clickedBtn.textContent = clickedBtn.dataset.origLabel || GEN_LABELS[type];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showFeedback(el, cls, msg) {
  if (!el) return;
  el.innerHTML = `<div class="gen-status ${cls}">${msg.replace(/</g, "&lt;")}</div>`;
  el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); el.innerHTML = ""; }, 4000);
}

// ── Footer ────────────────────────────────────────────────────────────────────

btnDownload.addEventListener("click", () => {
  chrome.storage.local.get({ clips: [] }, (data) => {
    if (!data.clips.length) return;
    const lines = data.clips.map((clip, i) => {
      const divider = "\u2500".repeat(60);
      return [
        `[${i + 1}] ${formatDate(clip.savedAt)}`,
        `URL: ${clip.url}`,
        "",
        clip.text,
        divider
      ].join("\n");
    });
    const content = "TEXT CLIPPER EXPORT\n" + "\u2550".repeat(60) + "\n\n" + lines.join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `text-clips-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

btnClear.addEventListener("click", () => {
  if (!confirm("Clear all saved clips?")) return;
  chrome.storage.local.set({ clips: [], activeClipIdx: null }, load);
});

document.getElementById("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

load();
