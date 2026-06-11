// Sidebar Layout Adjustment
if (window.location.search.includes('sidebar=true')) {
  document.body.style.setProperty('width', '100%', 'important');
  document.body.style.height = '100vh';
  document.body.style.display = 'flex';
  document.body.style.flexDirection = 'column';
  document.body.style.overflow = 'hidden';
  
  // Create stylesheet to override style blocks
  const style = document.createElement('style');
  style.textContent = `
    body { width: 100% !important; height: 100vh !important; }
    #clips-container { max-height: none !important; flex: 1 !important; overflow-y: auto !important; }
  `;
  document.head.appendChild(style);
}

const CLYDE_NONCE = new URLSearchParams(location.search).get('nonce');

const container = document.getElementById("clips-container");
const tabs = document.querySelectorAll(".tab");
const trackerFilters = document.getElementById("tracker-filters");
const trackerSearch = document.getElementById("tracker-search");
const datePicker = document.getElementById("date-picker");
const clearDateBtn = document.getElementById("clear-date-btn");
const sortRatingToggle = document.getElementById("sort-rating-toggle");
const groupBySelect = document.getElementById("group-by-select");
const resumeIndicator = document.getElementById("resume-indicator");
const resNameEl = document.getElementById("res-name-el");
const btnReplaceRes = document.getElementById("btn-replace-res");
const btnDlPlain = document.getElementById("btn-dl-plain");
const popupResumeInput = document.getElementById("popup-resume-input");
const btnGetJd = document.getElementById("btn-get-jd");
const btnAiApplyHeader = document.getElementById("btn-ai-apply");

let currentTab = "clips";
let filterDate = null;
let sortByRating = true;
let groupByOption = "status";
let allClips = [];
let activeClipIdx = null;
let resumeFileName = "None";
let hasActiveTailored = false;
let activeTailoredName = "";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function getIsoDate(iso) {
  if (!iso) return "";
  return iso.split('T')[0];
}

// ── Tabs & Filters ────────────────────────────────────────────────────────────

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    
    // Default visibility for clips tab elements
    resumeIndicator.style.display = currentTab === "clips" ? "flex" : "none";
    
    render();
  });
});

datePicker.addEventListener("change", (e) => {
  filterDate = e.target.value || null;
  clearDateBtn.style.display = filterDate ? "block" : "none";
  render();
});

clearDateBtn.addEventListener("click", () => {
  filterDate = null;
  datePicker.value = "";
  clearDateBtn.style.display = "none";
  render();
});

if (sortRatingToggle) {
  sortRatingToggle.addEventListener("change", (e) => {
    sortByRating = e.target.checked;
    render();
  });
}

if (groupBySelect) {
  groupBySelect.addEventListener("change", (e) => {
    groupByOption = e.target.value;
    render();
  });
}

if (trackerSearch) {
  trackerSearch.addEventListener("input", () => {
    render();
  });
}

if (btnGetJd) {
  btnGetJd.addEventListener("click", async () => {
    btnGetJd.disabled = true;
    const originalText = btnGetJd.textContent;
    btnGetJd.textContent = "Extracting...";

    try {
      const isSidebar = new URLSearchParams(window.location.search).get('sidebar') === 'true';

      if (isSidebar) {
        // Use 100% reliable postMessage to parent host page to bypass all MV3 scripting / tab query restrictions!
        const handleResponse = async (event) => {
          // Only accept responses from the parent frame (web page hosting the sidebar)
          if (event.source !== window.parent) return;
          if (event.data && event.data.type === 'CLYDE_EXTRACT_RESPONSE') {
            // Nonce check: reject messages whose nonce doesn't match the sidebar's nonce
            if (event.data.nonce !== CLYDE_NONCE) return;
            // Validate that text and url are strings, not arbitrary objects
            if (typeof event.data.text !== 'string' || typeof event.data.url !== 'string') return;
            window.removeEventListener('message', handleResponse);
            const text = event.data.text;
            if (text) {
              await chrome.runtime.sendMessage({
                action: "extract-page",
                text: text,
                url: event.data.url
              });
              btnGetJd.textContent = "Extracted \u2713";
            } else {
              btnGetJd.textContent = "Error!";
              alert("No job description text found on page.");
            }
            setTimeout(() => {
              btnGetJd.disabled = false;
              btnGetJd.textContent = originalText;
            }, 3000);
          }
        };
        window.addEventListener('message', handleResponse);
        window.parent.postMessage({ type: 'CLYDE_EXTRACT_REQUEST' }, '*');
        
        // Timeout safety fallback just in case
        setTimeout(() => {
          if (btnGetJd.textContent === "Extracting...") {
            window.removeEventListener('message', handleResponse);
            btnGetJd.disabled = false;
            btnGetJd.textContent = originalText;
          }
        }, 5000);

      } else {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tabs || tabs.length === 0) throw new Error("No active tab found");
        const tab = tabs[0];
        let extractedText = "";
        
        // 1. Try sending a message to the content script first
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JD_FROM_PAGE' });
          extractedText = response?.text || "";
        } catch (err) {
          console.log("[Clyde Popup] Content script extraction message failed:", err);
        }

        // 2. Fallback to executeScript if message failed
        if (!extractedText) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const clone = document.body.cloneNode(true);
                const stripTags = ['script', 'style', 'noscript', 'code', 'iframe', 'header', 'footer', 'nav'];
                for (const tag of stripTags) {
                  clone.querySelectorAll(tag).forEach(el => el.remove());
                }

                let textToExtract = clone.innerText || "";
                const selectors = [
                  '.show-more-less-html__markup',
                  '.jobs-box__html-content',
                  '.jobs-description-content__text',
                  '.jobs-description__content',
                  '.jobs-search__job-details--container',
                  '.jobs-description',
                  '.job-description', 
                  '#job-description',
                  '[data-automation-id="jobPostingDescription"]',
                  '[data-automation-id="job-posting-description"]'
                ];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el && el.innerText && el.innerText.trim().length > 200) {
                    const elClone = el.cloneNode(true);
                    for (const tag of stripTags) {
                      elClone.querySelectorAll(tag).forEach(e => e.remove());
                    }
                    if (elClone.innerText && elClone.innerText.trim().length > 100) {
                      textToExtract = elClone.innerText;
                      break;
                    }
                  }
                }
                return textToExtract;
              }
            });
            extractedText = results && results[0] && results[0].result;
          } catch (execErr) {
            console.log("[Clyde Popup] executeScript extraction fallback failed:", execErr);
          }
        }

        if (extractedText) {
          await chrome.runtime.sendMessage({
            action: "extract-page",
            tabId: tab.id,
            text: extractedText,
            url: tab.url
          });
          btnGetJd.textContent = "Extracted \u2713";
        } else {
          btnGetJd.textContent = "Error: No text found";
        }
        setTimeout(() => {
          btnGetJd.disabled = false;
          btnGetJd.textContent = originalText;
        }, 3000);
      }
    } catch (e) {
      console.error("[Clyde Popup] Extraction failed:", e);
      if (e.message && e.message.includes("Extension context invalidated")) {
        btnGetJd.textContent = "Please refresh page!";
        alert("Clyde has been reloaded. Please refresh the page to reconnect Clyde.");
      } else {
        btnGetJd.textContent = "Error!";
        alert(e.message || "Extraction failed.");
      }
      btnGetJd.disabled = false;
      btnGetJd.textContent = originalText;
    }
  });
}

if (btnAiApplyHeader) {
  btnAiApplyHeader.addEventListener("click", async () => {
    if (activeClipIdx === null) {
      if (allClips.length > 0) {
        activeClipIdx = 0;
      } else {
        alert("Please extract a job description first or set an active JD.");
        return;
      }
    }
    await handleAiApply(activeClipIdx, btnAiApplyHeader);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function getClipDate(clip) {
  return (currentTab === "tracker" || currentTab === "archived") && clip.appliedAt ? clip.appliedAt : clip.savedAt;
}

function render() {
  if (hasActiveTailored) {
    resNameEl.textContent = activeTailoredName || "Tailored Resume (Generated)";
    resNameEl.className = "res-name tailored";
    btnDlPlain.style.display = "block";
  } else {
    resNameEl.textContent = resumeFileName;
    resNameEl.className = "res-name";
    btnDlPlain.style.display = "none";
  }

  let displayClips = [];

  if (currentTab === "clips") {
    const activeJD = activeClipIdx !== null && allClips[activeClipIdx] ? allClips[activeClipIdx] : null;
    
    let others = allClips.map((c, i) => ({ ...c, originalIdx: i }))
      .filter(c => {
        if (c.originalIdx === activeClipIdx) return false;
        const isTracked = c.trackerStatus && c.trackerStatus !== "None";
        if (c.isSaved || isTracked) return false;
        return true;
      });
      
    others.reverse(); // Newest first
    
    if (activeJD) {
      displayClips = [{ ...activeJD, originalIdx: activeClipIdx }, ...others];
    } else {
      displayClips = others;
    }
  } else if (currentTab === "saved") {
    displayClips = allClips.map((c, i) => ({ ...c, originalIdx: i })).filter(c => c.isSaved).reverse();
  } else if (currentTab === "tracker") {
    displayClips = allClips.map((c, i) => ({ ...c, originalIdx: i })).filter(c => c.trackerStatus && c.trackerStatus !== "None" && c.trackerStatus !== "Rejected" && c.trackerStatus !== "Accepted").reverse();
  } else if (currentTab === "archived") {
    displayClips = allClips.map((c, i) => ({ ...c, originalIdx: i })).filter(c => c.trackerStatus === "Rejected" || c.trackerStatus === "Accepted").reverse();
  }
  
  if ((currentTab === "tracker" || currentTab === "archived") && trackerSearch && trackerSearch.value) {
    const term = trackerSearch.value.toLowerCase();
    displayClips = displayClips.filter(c => {
      const company = (c.companyName || "").toLowerCase();
      const title = (c.jobTitle || "").toLowerCase();
      const desc = (c.text || "").toLowerCase();
      return company.includes(term) || title.includes(term) || desc.includes(term);
    });
  }

  if (filterDate) {
    displayClips = displayClips.filter(c => getIsoDate(getClipDate(c)) === filterDate);
  }
  
  if (sortByRating) {
    displayClips.sort((a, b) => {
      // Always keep active JD at the top if we are on the clips tab
      if (currentTab === "clips") {
        if (a.originalIdx === activeClipIdx) return -1;
        if (b.originalIdx === activeClipIdx) return 1;
      }
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA;
    });
  }

  // Update Tab Counters
  const countClipsArr = allClips.filter((c, i) => {
    if (i === activeClipIdx) return true;
    const isTracked = c.trackerStatus && c.trackerStatus !== "None";
    if (c.isSaved || isTracked) return false;
    return true;
  });
  const countSavedArr = allClips.filter(c => c.isSaved);
  const countTrackerArr = allClips.filter(c => c.trackerStatus && c.trackerStatus !== "None" && c.trackerStatus !== "Rejected" && c.trackerStatus !== "Accepted");
  const countArchivedArr = allClips.filter(c => c.trackerStatus === "Rejected" || c.trackerStatus === "Accepted");

  document.getElementById("count-clips").textContent = countClipsArr.length;
  document.getElementById("count-saved").textContent = countSavedArr.length;
  document.getElementById("count-tracker").textContent = countTrackerArr.length;
  const countArchivedEl = document.getElementById("count-archived");
  if (countArchivedEl) countArchivedEl.textContent = countArchivedArr.length;

  // Tracker Filters Visibility
  if (currentTab === "tracker" || currentTab === "archived") {
    trackerFilters.style.display = "flex";
    if (currentTab === "archived") {
      if (groupBySelect) groupBySelect.style.display = "none";
    } else {
      if (groupBySelect) groupBySelect.style.display = "block";
    }
  } else {
    trackerFilters.style.display = "none";
  }

  if (displayClips.length === 0) {
    let emptyMsg = "No clips yet.<br>Highlight text on any page, right-click,<br>and choose <strong>Save to Clyde</strong>.";
    if (currentTab === "saved") emptyMsg = "No saved clips.<br>Click the heart icon on a clip to save it.";
    if (currentTab === "tracker") emptyMsg = filterDate || (trackerSearch && trackerSearch.value) ? "No tracked applications match the filters." : "No tracked applications.<br>Toggle the 'Track' switch on a clip.";
    if (currentTab === "archived") emptyMsg = filterDate || (trackerSearch && trackerSearch.value) ? "No archived applications match the filters." : "No archived applications.<br>Move jobs to Rejected or Accepted to see them here.";
    
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">&#9986;</div>
      ${emptyMsg}
    </div>`;
    resumeIndicator.style.display = currentTab === "clips" ? "flex" : "none";
    return;
  }

  container.innerHTML = "";

  // Group by Date or Status
  const grouped = {};
  displayClips.forEach(clip => {
    let groupKey = "Unknown";
    
    // If it's the active JD on the clips tab, it goes in a special group at the top regardless of sort
    if (currentTab === "clips" && clip.originalIdx === activeClipIdx) {
      groupKey = "__ACTIVE_JD__";
    } else {
      let activeGroupBy = groupByOption;
      if (currentTab === "archived") activeGroupBy = "status";

      if (activeGroupBy === "status") {
        groupKey = (clip.trackerStatus && clip.trackerStatus !== "None") ? clip.trackerStatus : "Not Tracked";
      } else {
        groupKey = getIsoDate(getClipDate(clip)) || "Unknown Date";
      }
    }
    
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(clip);
  });

  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "__ACTIVE_JD__") return -1;
    if (b === "__ACTIVE_JD__") return 1;
    
    let activeGroupBy = groupByOption;
    if (currentTab === "archived") activeGroupBy = "status";

    if (activeGroupBy === "status") {
      // Define a custom sort order for statuses
      const order = { "Interviewing": 1, "Applied": 2, "Accepted": 3, "Rejected": 4, "Not Tracked": 5, "Unknown": 6 };
      return (order[a] || 99) - (order[b] || 99);
    } else {
      // Default Date sort
      return b.localeCompare(a); // Newest first
    }
  });

  groupKeys.forEach(g => {
    let header = null;
    if (g !== "__ACTIVE_JD__") {
      header = document.createElement("div");
      header.className = "date-group-header";
      
      let headerText = g;
      let countHtml = `<span class="group-count">(${grouped[g].length})</span>`;
      if (currentTab === "archived") {
        headerText = `${g} (${grouped[g].length})`;
        countHtml = "";
      } else if (groupByOption === "date" && g !== "Unknown Date") {
          const parts = g.split('-');
          if (parts.length === 3) {
             const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
             headerText = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
          }
      }
      
      header.innerHTML = `<span style="display: flex; align-items: center;">${escapeHtml(headerText)}${countHtml}</span><span class="chevron">&#9660;</span>`;
      container.appendChild(header);
    }

    const groupContainer = document.createElement("div");
    groupContainer.className = "group-items";
    
    if (header) {
      header.addEventListener("click", () => {
        header.classList.toggle("collapsed");
        groupContainer.classList.toggle("collapsed");
      });
    }

    grouped[g].forEach(clip => {
      groupContainer.appendChild(createClipElement(clip, clip.originalIdx === activeClipIdx));
    });
    container.appendChild(groupContainer);
  });
}

function createClipElement(clip, isActive) {
  const idx = clip.originalIdx;
  const div = document.createElement("div");
  div.className = "clip" + (isActive ? " active" : "");
  div.dataset.idx = idx;

  const safeText = escapeHtml(clip.text || "");
  const safeUrl = escapeHtml(clip.url || "");
  
  const title = escapeHtml(clip.jobTitle || "Unknown Title");
  const company = escapeHtml(clip.companyName || "Unknown Company");
  const loc = escapeHtml(clip.location || "Unknown Location");
  const archetype = clip.archetype && clip.archetype !== "Unknown" ? escapeHtml(clip.archetype) : "";
  const salary = clip.salary && clip.salary !== "Unknown" ? escapeHtml(clip.salary) : "";
  const score = clip.score !== undefined ? clip.score : null;
  
  let scoreHtml = '';
  let gapAnalysisHtml = '';
  
  if (score !== null) {
    let scoreClass = 'pending';
    if (score >= 4.5) scoreClass = 'excellent';
    else if (score >= 3.5) scoreClass = 'good';
    else if (score >= 2.5) scoreClass = 'fair';
    else scoreClass = 'poor';
    
    scoreHtml = `<div class="clip-score ${scoreClass}" data-toggle-gap="${idx}" title="Click to view match analysis">★ ${score.toFixed(1)}</div>`;
    
    gapAnalysisHtml = `
      <div class="clip-gap-analysis" id="gap-${idx}">
        <div class="clip-gap-row"><strong>✓ Top Strength:</strong> ${escapeHtml(clip.topStrength || "Not calculated.")}</div>
        <div class="clip-gap-row"><strong>✗ Main Gap:</strong> ${escapeHtml(clip.mainGap || "Not calculated.")}</div>
        <div class="clip-gap-row"><strong>💡 Mitigation:</strong> ${escapeHtml(clip.mitigation || "Not calculated.")}</div>
      </div>
    `;
  }
  
  const archMetaHtml = archetype || salary 
    ? `<div class="clip-arch-meta">${archetype}${archetype && salary ? ' &bull; ' : ''}${salary}</div>` 
    : '';
  
  const isApplied = clip.trackerStatus && clip.trackerStatus !== "None";

  const heartSvg = clip.isSaved 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

  const starSvg = isActive 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

  const bookmarkSvg = isApplied 
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;

  const heartBtnHtml = `<button class="icon-btn heart ${clip.isSaved ? 'saved' : ''}" data-heart-idx="${idx}" title="${clip.isSaved ? 'Remove from Saved' : 'Save to Favorites'}">${heartSvg}</button>`;
  const activeBtnHtml = `<button class="icon-btn star ${isActive ? 'active-jd' : ''}" data-set-active="${idx}" title="${isActive ? 'Current Active JD for AI' : 'Set as Active JD for AI'}">${starSvg}</button>`;
  
  let trackBtnHtml = "";
  if (currentTab !== "tracker" && currentTab !== "archived") {
    trackBtnHtml = `<button class="icon-btn bookmark ${isApplied ? 'tracked' : ''}" data-track-idx="${idx}" title="${isApplied ? 'Remove from Tracker' : 'Add to Tracker'}">${bookmarkSvg}</button>`;
  }

  // Tracker status dropdown ONLY on tracker tab
  let statusControl = "";
  if (currentTab === "tracker" || currentTab === "archived") {
    statusControl = `
      <select class="status-dropdown full-width ${escapeHtml(clip.trackerStatus || '')}" data-status-idx="${idx}">
        <option value="Applied" ${clip.trackerStatus === 'Applied' ? 'selected' : ''}>Applied</option>
        <option value="Interviewing" ${clip.trackerStatus === 'Interviewing' ? 'selected' : ''}>Interviewing</option>
        <option value="Rejected" ${clip.trackerStatus === 'Rejected' ? 'selected' : ''}>Rejected</option>
        <option value="Accepted" ${clip.trackerStatus === 'Accepted' ? 'selected' : ''}>Accepted</option>
        <option value="None">Remove from Tracker</option>
      </select>
    `;
  }

  const titleHtml = `<span class="editable-title" data-idx="${idx}" contenteditable="true" spellcheck="false" title="Click to edit title">${title}</span>` + 
    (safeUrl ? ` <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="Go to application" style="color: #9ca3af; margin-left: 4px; text-decoration: none; vertical-align: middle;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>` : '');

  div.innerHTML = `
    ${statusControl}
    <div class="active-label">Active JD &mdash; used for AI answers</div>
    <div class="clip-header-info">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: flex-start; gap: 8px;">
          ${scoreHtml}
          <div class="clip-job-title">${titleHtml}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${trackBtnHtml}
          ${activeBtnHtml}
          ${heartBtnHtml}
        </div>
      </div>
      <div class="clip-company-meta"><span class="editable-company" data-idx="${idx}" contenteditable="true" spellcheck="false" title="Click to edit company">${company}</span> &bull; ${loc}</div>
      ${archMetaHtml}
      ${gapAnalysisHtml}
    </div>
    <button class="clip-delete" data-idx="${idx}" title="Delete clip">&times;</button>
    <div class="clip-top">
      <div class="clip-text" title="Click to expand/collapse full description">${safeText}</div>
    </div>
    <div class="clip-meta">
      <span class="clip-url" title="${safeUrl}">${safeUrl}</span>
      <span class="clip-date">${formatDate(clip.savedAt)}</span>
    </div>
    <div class="clip-actions">
      <div class="dropdown">
        <button class="btn-action btn-doc dropdown-toggle" data-toggle="dropdown-${idx}">Generate Docs &#9662;</button>
        <div class="dropdown-menu" id="dropdown-${idx}">
          <button class="dropdown-item" data-gen="cv" data-idx="${idx}" title="Generate Tailored Resume PDF">Resume PDF</button>
          <button class="dropdown-item" data-gen="cover" data-idx="${idx}" title="Generate Tailored Cover Letter PDF">Cover Letter PDF</button>
          <button class="dropdown-item primary-item" data-gen="both" data-idx="${idx}" title="Generate both Resume & Cover Letter PDFs">Resume + Cover Letter</button>
        </div>
      </div>
      ${(currentTab === 'tracker' || currentTab === 'archived') ? `<button class="btn-action btn-prep" data-gen="prep" data-idx="${idx}" title="Generate STAR behavioral interview stories">Interview Prep</button>` : ''}
      <button class="btn-action btn-linkedin" data-gen="network" data-idx="${idx}" title="Copy LinkedIn outreach message">LinkedIn Message</button>
      <button class="btn-action btn-clyde" data-clyde-sync="${idx}" title="Sync job description to Clyde Desktop App" data-clyde-idx="${idx}">Sync to&nbsp;<span style="font-weight:700;">Cockpit</span></button>
    </div>
    <div class="gen-feedback" data-fb="${idx}"></div>
  `;
  return div;
}

function load() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.storage || !chrome.storage.local) {
    console.warn("[Clyde Popup] Extension context is invalidated or chrome APIs are unavailable.");
    return;
  }
  try {
    chrome.storage.local.get({
      clips: [],
      activeClipIdx: null,
      resumeFile: null,
      activeResumeText: null,
      activeResumeName: null,
      useTailoredResume: true
    }, (data) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || chrome.runtime.lastError) {
        console.warn("[Clyde Popup] Storage get failed (context might be invalidated):", chrome.runtime?.lastError);
        return;
      }
      allClips = data.clips;
      activeClipIdx = data.activeClipIdx;

      // Resolve active tailored resume from the active clip!
      const activeClip = (activeClipIdx !== null && allClips[activeClipIdx]) ? allClips[activeClipIdx] : null;
      let tailoredText = null;
      let tailoredName = null;
      if (activeClip && activeClip.tailoredResumeText) {
        tailoredText = activeClip.tailoredResumeText;
        tailoredName = activeClip.tailoredResumeName;
      }

      // Only write back to storage if it changed, to prevent infinite storage onChanged loops
      if (data.activeResumeText !== tailoredText || data.activeResumeName !== tailoredName) {
        chrome.storage.local.set({
          activeResumeText: tailoredText,
          activeResumeName: tailoredName
        });
      }

      resumeFileName = data.resumeFile ? data.resumeFile.fileName : "None (Upload required)";
      hasActiveTailored = !!tailoredText;
      activeTailoredName = tailoredName || "";
      const useTailored = data.useTailoredResume !== false;

    // Populates active resume select options
    const activeResumeSelect = document.getElementById("active-resume-select");
    const optMasterResume = document.getElementById("opt-master-resume");
    const optTailoredResume = document.getElementById("opt-tailored-resume");

    if (activeResumeSelect && optMasterResume && optTailoredResume) {
      optMasterResume.textContent = `Master - ${resumeFileName}`;
      
      if (hasActiveTailored) {
        optTailoredResume.disabled = false;
        optTailoredResume.textContent = `Tailored - ${activeTailoredName || "Tailored Resume"}`;
        activeResumeSelect.value = useTailored ? "tailored" : "master";
      } else {
        optTailoredResume.disabled = true;
        optTailoredResume.textContent = "Tailored Resume (Not generated)";
        activeResumeSelect.value = "master";
      }
    }

    // Default visibility for clips tab elements
    if (resumeIndicator) {
      resumeIndicator.style.display = currentTab === "clips" ? "flex" : "none";
    }

    // Populates active cover letter widget
    const clWidget = document.getElementById("clyde-active-cl-widget");
    const clTextarea = document.getElementById("clyde-active-cl-textarea");

    if (clWidget && clTextarea) {
      if (currentTab === "clips" && activeClip && activeClip.coverLetterText) {
        clWidget.style.display = "flex";
        if (document.activeElement !== clTextarea) {
          clTextarea.value = activeClip.coverLetterText;
        }
      } else {
        clWidget.style.display = "none";
      }
    }
    
    render();
  });
  } catch (err) {
    console.error("[Clyde Popup] Error inside load():", err);
  }
}

function save(callback) {
  chrome.storage.local.set({ clips: allClips, activeClipIdx }, () => {
    render();
    if (callback) callback();
  });
}

// ── Resume Replacement ────────────────────────────────────────────────────────

btnReplaceRes.addEventListener("click", () => {
  popupResumeInput.click();
});

btnDlPlain.addEventListener("click", async () => {
  try {
    const data = await chrome.storage.local.get(['activeResumeText', 'activeResumeName']);
    if (data.activeResumeText) {
      const fileName = data.activeResumeName ? data.activeResumeName.replace('.pdf', '') + '.txt' : 'tailored_resume.txt';
      const blob = new Blob([data.activeResumeText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.error("Error downloading plain text resume", err);
  }
});

popupResumeInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== 'application/pdf') {
    alert("Please upload a PDF file.");
    return;
  }

  resNameEl.textContent = "Parsing...";
  resNameEl.className = "res-name";
  btnReplaceRes.disabled = true;

  try {
    const base64Data = await fileToBase64(file);
    const parseResult = await chrome.runtime.sendMessage({
      type: 'PARSE_PDF',
      payload: { base64Data, fileName: file.name }
    });
    if (parseResult.error) throw new Error(parseResult.error);

    resNameEl.textContent = "Analyzing with AI...";
    
    console.log('[Popup UI Log] Sending ANALYZE_RESUME to background service worker...');
    const analysis = await chrome.runtime.sendMessage({
      type: 'ANALYZE_RESUME',
      payload: { resumeText: parseResult.text }
    });
    console.log('[Popup UI Log] ANALYZE_RESUME response received:', analysis);
    if (analysis.error) {
      console.error('[Popup UI Log] Background reported error during analysis:', analysis.error);
      throw new Error(analysis.error);
    }

    // Also clear activeResumeText since we uploaded a new master resume
    await chrome.storage.local.remove('activeResumeText');
    
    load();
  } catch (err) {
    alert(`Error replacing resume: ${err.message}`);
    load();
  } finally {
    e.target.value = '';
    btnReplaceRes.disabled = false;
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Event delegation ──────────────────────────────────────────────────────────

container.addEventListener("click", (e) => {
  // Expand Job Description
  const clipText = e.target.closest(".clip-text");
  if (clipText) {
    clipText.classList.toggle("expanded");
    return;
  }

  // Gap Analysis Toggle
  const gapBtn = e.target.closest("[data-toggle-gap]");
  if (gapBtn) {
    const idx = gapBtn.dataset.toggleGap;
    const gapDiv = document.getElementById(`gap-${idx}`);
    if (gapDiv) gapDiv.classList.toggle("show");
    return;
  }

  // Delete
  const delBtn = e.target.closest(".clip-delete");
  if (delBtn) {
    const idx = parseInt(delBtn.dataset.idx, 10);
    allClips.splice(idx, 1);
    if (allClips.length === 0) {
      activeClipIdx = null;
    } else if (activeClipIdx === idx) {
      activeClipIdx = allClips.length - 1;
    } else if (activeClipIdx > idx) {
      activeClipIdx = activeClipIdx - 1;
    }
    save();
    return;
  }

  // Heart
  const heartBtn = e.target.closest("[data-heart-idx]");
  if (heartBtn) {
    const idx = parseInt(heartBtn.dataset.heartIdx, 10);
    allClips[idx].isSaved = !allClips[idx].isSaved;
    save();
    return;
  }

  // Track (Bookmark icon)
  const trackBtn = e.target.closest("[data-track-idx]");
  if (trackBtn) {
    const idx = parseInt(trackBtn.dataset.trackIdx, 10);
    const isCurrentlyTracked = allClips[idx].trackerStatus && allClips[idx].trackerStatus !== "None";
    
    if (isCurrentlyTracked) {
      allClips[idx].trackerStatus = "None";
    } else {
      allClips[idx].trackerStatus = "Applied";
      if (!allClips[idx].appliedAt) {
        allClips[idx].appliedAt = new Date().toISOString();
      }
    }
    save();
    return;
  }

  // Set active
  const activeBtn = e.target.closest("[data-set-active]");
  if (activeBtn) {
    activeClipIdx = parseInt(activeBtn.dataset.setActive, 10);
    save();
    return;
  }

  // Dropdown Toggle
  const toggleBtn = e.target.closest(".dropdown-toggle");
  if (toggleBtn) {
    const menuId = toggleBtn.dataset.toggle;
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const isShowing = menu.classList.contains("show");
    
    // Hide all others
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    
    if (!isShowing) {
      menu.classList.add("show");
    }
    return;
  }

  // Generate
  const genBtn = e.target.closest("[data-gen]");
  if (genBtn && !genBtn.disabled) {
    const idx = parseInt(genBtn.dataset.idx, 10);
    const type = genBtn.dataset.gen;
    // Close dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    handleGenerate(idx, type);
    return;
  }

  // AI Apply
  const applyBtn = e.target.closest(".btn-action[data-autofill]");
  if (applyBtn && !applyBtn.disabled) {
    const idx = parseInt(applyBtn.dataset.autofill, 10);
    handleAiApply(idx, applyBtn);
    return;
  }

  // Sync to Cockpit (Clyde Desktop)
  const clydeBtn = e.target.closest("[data-clyde-sync]");
  if (clydeBtn && !clydeBtn.disabled) {
    const idx = parseInt(clydeBtn.dataset.clydeSync, 10);
    handleClydeSync(idx, clydeBtn);
    return;
  }
});

container.addEventListener("focusout", (e) => {
  if (e.target.classList.contains("editable-title")) {
    const idx = parseInt(e.target.dataset.idx, 10);
    const newText = e.target.textContent.trim();
    if (newText && newText !== allClips[idx].jobTitle) {
      allClips[idx].jobTitle = newText;
      save();
    }
  } else if (e.target.classList.contains("editable-company")) {
    const idx = parseInt(e.target.dataset.idx, 10);
    const newText = e.target.textContent.trim();
    if (newText && newText !== allClips[idx].companyName) {
      allClips[idx].companyName = newText;
      save();
    }
  }
});

container.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target.classList.contains("editable-title") || e.target.classList.contains("editable-company"))) {
    e.preventDefault();
    e.target.blur();
  }
});

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  }
});

// Toggle Switch (Track)
container.addEventListener("change", (e) => {
  if (e.target.matches("[data-apply-idx]")) {
    const idx = parseInt(e.target.dataset.applyIdx, 10);
    const isChecked = e.target.checked;
    
    if (isChecked) {
      allClips[idx].trackerStatus = "Applied";
      if (!allClips[idx].appliedAt) {
        allClips[idx].appliedAt = new Date().toISOString();
      }
    } else {
      allClips[idx].trackerStatus = "None";
    }
    save();
  }
  
  if (e.target.matches("[data-status-idx]")) {
    const idx = parseInt(e.target.dataset.statusIdx, 10);
    allClips[idx].trackerStatus = e.target.value;
    save();
  }
});

// ── Document generation ───────────────────────────────────────────────────────

async function handleAiApply(clipIdx, applyBtn) {
  applyBtn.disabled = true;
  const originalText = applyBtn.textContent;
  applyBtn.innerHTML = `<span class="spinner"></span> Applying...`;

  try {
    // Make sure we have an API key or Pro Token and active resume
    const data = await chrome.storage.local.get(['geminiApiKey', 'clydeProToken', 'activeResumeText', 'masterResumeText']);
    if (!data.geminiApiKey && !data.clydeProToken) throw new Error("Please set your Gemini API key or Clyde Pro License Token in Settings.");
    if (!data.activeResumeText && !data.masterResumeText) throw new Error("Please upload your resume in the extension popup.");

    // Set this clip as active JD so the background script uses it for FILL_FIELDS
    activeClipIdx = clipIdx;
    await new Promise(r => chrome.storage.local.set({ activeClipIdx }, r));

    // Tell the content script in the active tab to start filling
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) throw new Error("No active tab found");
    
    await chrome.tabs.sendMessage(tab.id, { type: 'START_AUTOFILL' });
    
    applyBtn.textContent = "Started!";
    setTimeout(() => {
      applyBtn.disabled = false;
      applyBtn.textContent = originalText;
    }, 5000);
    
    if (window.location.search.includes('sidebar=true')) {
      setTimeout(() => {
        window.parent.postMessage({ type: 'CLOSE_SIDEBAR' }, '*');
      }, 1500);
    } else {
      setTimeout(() => window.close(), 1500);
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
    applyBtn.disabled = false;
    applyBtn.textContent = originalText;
  }
}

const GEN_LABELS = { cv: "Resume", cover: "Cover Letter", both: "Both", prep: "Prep", network: "Network" };

async function handleGenerate(clipIdx, type) {
  const card = container.querySelector(`.clip[data-idx="${clipIdx}"]`);
  if (!card) return;

  const buttons = card.querySelectorAll("[data-gen], .dropdown-toggle");
  const clickedBtn = card.querySelector(`[data-gen="${type}"]`);
  const feedback = card.querySelector(`[data-fb="${clipIdx}"]`);

  // Lock buttons + show spinner
  buttons.forEach(b => b.disabled = true);
  if (clickedBtn) {
    clickedBtn.dataset.origLabel = clickedBtn.textContent;
    // If it's the dropdown toggle, we don't want to replace text if the clicked button is a menu item
    if (clickedBtn.classList.contains('dropdown-item')) {
       // update the parent toggle button instead
       const toggle = card.querySelector('.dropdown-toggle');
       if (toggle) {
         toggle.dataset.origLabel = toggle.textContent;
         toggle.innerHTML = `<span class="spinner" style="border-width:2px;width:10px;height:10px;margin-right:6px;"></span> Generating...`;
       }
    } else {
      clickedBtn.innerHTML = `<span class="spinner"></span> Generating`;
    }
  }

    try {
      if (type === 'network') {
        const data = await chrome.storage.local.get(['geminiApiKey', 'clydeProToken', 'masterResumeText']);
        if (!data.geminiApiKey && !data.clydeProToken) throw new Error("Please set your Gemini API key or Clyde Pro License Token in Settings.");
        const resumeText = data.masterResumeText || "";
        if (!resumeText) throw new Error("No master resume uploaded.");
      
      const response = await chrome.runtime.sendMessage({
        action: "network",
        clipIdx
      });
      
      if (response.error) throw new Error(response.error);
      
      // Copy to clipboard
      await copyTextToClipboard(response.message);
      showFeedback(feedback, "success", "Message copied to clipboard!");
    } else {
      const result = await chrome.runtime.sendMessage({
        action: "generate",
        type,
        clipIdx
      });

      if (result.error) throw new Error(result.error);

      const count = result.count || 1;
      const msg = count > 1 ? `${count} tabs opened — save each as PDF` : "Tab opened — save as PDF";
      showFeedback(feedback, "success", msg);
      
      // Resume is generated, update active resume text indicator
      if (type === 'cv' || type === 'both') {
         setTimeout(load, 500); 
      }
    }
  } catch (err) {
    showFeedback(feedback, "error", err.message);
  }

  // Restore buttons
  buttons.forEach(b => b.disabled = false);
  if (clickedBtn) {
    if (clickedBtn.classList.contains('dropdown-item')) {
       const toggle = card.querySelector('.dropdown-toggle');
       if (toggle && toggle.dataset.origLabel) toggle.innerHTML = toggle.dataset.origLabel;
    } else {
       clickedBtn.textContent = clickedBtn.dataset.origLabel || GEN_LABELS[type];
    }
  }
}

// ── Clyde Desktop Sync ─────────────────────────────────────────────────────────

async function handleClydeSync(clipIdx, btn) {
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="border-width:2px;width:10px;height:10px;"></span> Syncing...';

  const clip = allClips[clipIdx];
  if (!clip) {
    btn.disabled = false;
    btn.innerHTML = originalText;
    return;
  }

  try {
    const data = await chrome.storage.local.get(['clydeHost', 'clydePort']);
    const host = data.clydeHost || '127.0.0.1';
    const port = parseInt(data.clydePort) || 4593;
    const opts = { host, port };

    const clydeClient = await loadClydeClient();

    // Check if Clyde is reachable first
    const availability = await clydeClient.isAvailable(opts);
    if (!availability.available) {
      throw new Error('Clyde Desktop not reachable. Ensure the app is running and check settings.');
    }

    await clydeClient.syncJobToClyde(
      clip.companyName || 'Unknown Company',
      clip.text || '',
      clip.jobTitle || '',
      opts,
      {
        score: clip.score,
        topStrength: clip.topStrength,
        mainGap: clip.mainGap,
        mitigation: clip.mitigation
      }
    );

    const card = container.querySelector(`.clip[data-idx="${clipIdx}"]`);
    const feedback = card ? card.querySelector('[data-fb]') : null;
    showFeedback(feedback, 'success', `Synced to Clyde Cockpit ${'\u2705'}`);
    btn.innerHTML = 'Synced!';
    setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 2000);
  } catch (e) {
    const card = container.querySelector(`.clip[data-idx="${clipIdx}"]`);
    const feedback = card ? card.querySelector('[data-fb]') : null;
    showFeedback(feedback, 'error', `Clyde sync failed: ${e.message}`);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

/**
 * Dynamically load the clyde-client.js module in the popup context.
 * Uses the global ClydeClient loaded via script tag to comply with CSP.
 */
async function loadClydeClient() {
  return window.ClydeClient || window.__clydeClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showFeedback(el, cls, msg) {
  if (!el) return;
  el.innerHTML = `<div class="gen-status ${cls}">${escapeHtml(msg)}</div>`;
  el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); el.innerHTML = ""; }, 4000);
}

document.getElementById("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

const btnGuide = document.getElementById("btn-guide");
if (btnGuide) {
  btnGuide.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("user-guide.html") });
  });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.clips || changes.activeClipIdx || changes.activeResumeText)) {
    load();
  }
});

// ── Active Resume & Cover Letter Widget Event Listeners ───────────────────────

const activeResumeSelect = document.getElementById("active-resume-select");
if (activeResumeSelect) {
  activeResumeSelect.addEventListener("change", async (e) => {
    const value = e.target.value;
    await chrome.storage.local.set({ useTailoredResume: (value === "tailored") });
    load();
  });
}

const clHeader = document.getElementById("clyde-active-cl-header");
const clBody = document.getElementById("clyde-active-cl-body");
const clToggleIcon = document.getElementById("clyde-active-cl-toggle-icon");
if (clHeader && clBody && clToggleIcon) {
  clHeader.addEventListener("click", () => {
    const isHidden = clBody.style.display === "none" || !clBody.style.display;
    clBody.style.display = isHidden ? "flex" : "none";
    clToggleIcon.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
  });
}

const clCopyBtn = document.getElementById("clyde-active-cl-copy");
const clTextarea = document.getElementById("clyde-active-cl-textarea");
if (clCopyBtn && clTextarea) {
  clCopyBtn.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(clTextarea.value);
      clCopyBtn.textContent = "Copied ✓";
      setTimeout(() => { clCopyBtn.textContent = "Copy"; }, 2000);
    } catch (err) {
      console.error("Failed to copy cover letter:", err);
    }
  });
}

const clDlBtn = document.getElementById("clyde-active-cl-dl");
if (clDlBtn && clTextarea) {
  clDlBtn.addEventListener("click", () => {
    const activeClip = (activeClipIdx !== null && allClips[activeClipIdx]) ? allClips[activeClipIdx] : null;
    const comp = activeClip ? (activeClip.companyName || "Company") : "Company";
    const role = activeClip ? (activeClip.jobTitle || "Role") : "Role";
    const fileName = `${comp.replace(/\s+/g, '_')}_${role.replace(/\s+/g, '_')}_Cover_Letter.txt`;
    
    const blob = new Blob([clTextarea.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  });
}

if (clTextarea) {
  clTextarea.addEventListener("input", async () => {
    const activeClip = (activeClipIdx !== null && allClips[activeClipIdx]) ? allClips[activeClipIdx] : null;
    if (activeClip && activeClipIdx !== null) {
      activeClip.coverLetterText = clTextarea.value;
      allClips[activeClipIdx].coverLetterText = clTextarea.value;
      
      // Quietly save back to storage
      await chrome.storage.local.set({ clips: allClips });
      
      // Show temporary saved indicator
      const clStatus = document.getElementById("clyde-active-cl-status");
      if (clStatus) {
        clStatus.style.display = "inline";
        if (window.clSaveTimer) clearTimeout(window.clSaveTimer);
        window.clSaveTimer = setTimeout(() => { clStatus.style.display = "none"; }, 1500);
      }
    }
  });
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn("navigator.clipboard.writeText failed, trying fallback:", err);
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (successful) return true;
      throw new Error("execCommand copy returned false");
    } catch (fallbackErr) {
      console.error("Fallback clipboard copy failed:", fallbackErr);
      throw new Error("Clipboard copy blocked by browser security policy. Please copy manually.");
    }
  }
}

// --- Clyde Desktop Connection Status Monitor ---
async function startClydeConnectionMonitor() {
  const dot = document.getElementById("clyde-connection-dot");
  const text = document.getElementById("clyde-connection-text");

  if (!dot || !text) {
    return;
  }

  async function checkConnection() {
    try {
      const data = await chrome.storage.local.get(['clydeHost', 'clydePort']);
      const host = data.clydeHost || '127.0.0.1';
      const port = parseInt(data.clydePort) || 4593;
      const opts = { host, port };

      const clydeClient = await loadClydeClient();
      if (!clydeClient) {
        throw new Error('No Clyde client');
      }

      const availability = await clydeClient.isAvailable(opts);
      if (availability.available) {
        dot.style.backgroundColor = "#4ade80";
        dot.style.boxShadow = "0 0 8px #4ade80";
        text.textContent = "Connected to Clyde Desktop";
      } else {
        dot.style.backgroundColor = "#ef4444";
        dot.style.boxShadow = "0 0 8px #ef4444";
        text.textContent = "Disconnected from Clyde Desktop";
      }
    } catch (_) {
      dot.style.backgroundColor = "#ef4444";
      dot.style.boxShadow = "0 0 8px #ef4444";
      text.textContent = "Disconnected from Clyde Desktop";
    }
  }

  // Check immediately, then poll every 4 seconds
  checkConnection();
  setInterval(checkConnection, 4000);
}

startClydeConnectionMonitor();

load();