importScripts('lib/storage.js', 'lib/gemini.js', 'lib/clyde-client.js');

function cleanUrl(url) {
  if (!url) return "";
  const hrefMatch = url.match(/href=["'](.*?)["']/i);
  if (hrefMatch && hrefMatch[1]) {
    url = hrefMatch[1];
  }
  return url.replace(/<[^>]*>/g, "").trim();
}

// ── Context menus ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // 1. "Save Job Description to Clyde" (Only when text is highlighted)
  chrome.contextMenus.create({
    id: "save-selection",
    title: "📥 Save Job Description to Clyde",
    contexts: ["selection"]
  });

  // 2. "Draft a Tailored Cover Letter" (Always at top-level)
  chrome.contextMenus.create({
    id: "ai-answer-cover-letter",
    title: "📄 Draft a Tailored Cover Letter",
    contexts: ["selection", "page", "editable"]
  });

  // 3. "What makes you a good fit?" (Only when no text is highlighted)
  chrome.contextMenus.create({
    id: "ai-answer-fit",
    title: "🤔 What makes you a good fit?",
    contexts: ["page", "editable"]
  });

  // 4. Parent menu: "Answer with Clyde"
  chrome.contextMenus.create({
    id: "ai-answer",
    title: "💼 Answer with Clyde",
    contexts: ["selection", "page", "editable"]
  });

  // 5. Submenu under "Answer with Clyde": "Answer (General)" (Only when selection exists)
  chrome.contextMenus.create({
    id: "ai-answer-default",
    parentId: "ai-answer",
    title: "💬 Answer (General)",
    contexts: ["selection"]
  });

  // 6. Submenu under "Answer with Clyde": "Answer (Custom Instructions)" (Only when selection exists)
  chrome.contextMenus.create({
    id: "ai-answer-custom",
    parentId: "ai-answer",
    title: "🔧 Answer (Custom Instructions)",
    contexts: ["selection"]
  });

  // 7. Right-click pinned toolbar icon: "Clyde"
  chrome.contextMenus.create({
    id: "clyde-marketing-action",
    title: "🌐 Clyde",
    contexts: ["action"]
  });

  // 8. Right-click pinned toolbar icon: "Settings"
  chrome.contextMenus.create({
    id: "settings-action",
    title: "⚙️ Settings",
    contexts: ["action"]
  });

  // 9. Right-click pinned toolbar icon: "User Guide"
  chrome.contextMenus.create({
    id: "user-guide-action",
    title: "📖 User Guide",
    contexts: ["action"]
  });
});

// ── Context menu click handler ─────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText?.trim();
  const url = info.pageUrl || tab?.url;

  if (info.menuItemId === "save-selection") {
    if (!selectedText) return;
    chrome.storage.local.get({ clips: [], geminiApiKey: "", clydeProToken: "" }, async (data) => {
      const clips = data.clips;
      const newClip = { 
        id: crypto.randomUUID(),
        text: selectedText, 
        url, 
        savedAt: new Date().toISOString(), 
        isSaved: false, 
        trackerStatus: "None",
        jobTitle: "Extracting...",
        companyName: "...",
        location: "..." 
      };
      clips.push(newClip);
      const activeClipIdx = clips.length - 1;
      
      await new Promise(r => chrome.storage.local.set({ clips, activeClipIdx }, r));
      showToast(tab.id, "Saved to Clyde ✓", "#1a1a2e");

      // Extract details in background
      const apiKey = data.geminiApiKey?.trim();
      const proToken = data.clydeProToken?.trim();
      const resumeText = data.activeResumeText || data.masterResumeText || "";
      
      if (apiKey || proToken) {
         try {
           const extracted = await extractJobInfoJson(apiKey, selectedText, resumeText);
           const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
           const targetIdx = freshData.clips.findIndex(c => c.id === newClip.id);
           
           if (targetIdx !== -1) {
              let companyFallback = "Company";
              if (url) {
                try {
                  const host = new URL(url).hostname;
                  const parts = host.replace(/^www\./i, '').split('.');
                  if (parts.length > 0) {
                    companyFallback = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                  }
                } catch (e) {}
              }

              freshData.clips[targetIdx].jobTitle = extracted.title || "Job Title";
              freshData.clips[targetIdx].companyName = extracted.company || companyFallback;
              freshData.clips[targetIdx].location = extracted.location || "Location";
              freshData.clips[targetIdx].score = extracted.score || null;
              freshData.clips[targetIdx].archetype = extracted.archetype || "Unknown";
              freshData.clips[targetIdx].salary = extracted.salary || "Unknown";
              freshData.clips[targetIdx].topStrength = extracted.top_strength || "";
              freshData.clips[targetIdx].mainGap = extracted.main_gap || "";
              freshData.clips[targetIdx].mitigation = extracted.mitigation || "";
              await chrome.storage.local.set({ clips: freshData.clips });
              
              // Trigger auto-sync to Clyde Desktop App
              await autoSyncClipToClyde(freshData.clips[targetIdx]);
           }
         } catch(e) {
           console.error("Extraction failed", e);
           const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
           const targetIdx = freshData.clips.findIndex(c => c.id === newClip.id);
           if (targetIdx !== -1) {
              freshData.clips[targetIdx].jobTitle = "Unknown Title";
              freshData.clips[targetIdx].companyName = "Unknown Company";
              freshData.clips[targetIdx].location = "Unknown Location";
              await chrome.storage.local.set({ clips: freshData.clips });
           }
         }
      } else {
         const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
         const targetIdx = freshData.clips.findIndex(c => c.id === newClip.id);
         if (targetIdx !== -1) {
            freshData.clips[targetIdx].jobTitle = "Unknown Title";
            freshData.clips[targetIdx].companyName = "Unknown Company";
            freshData.clips[targetIdx].location = "Unknown Location";
            await chrome.storage.local.set({ clips: freshData.clips });
         }
      }
    });
    return;
  }

  if (info.menuItemId === "ai-answer" || info.menuItemId === "ai-answer-custom") {
    handleAiAnswer(selectedText || null, tab, "custom");
  }

  if (info.menuItemId === "ai-answer-default") {
    handleAiAnswer(selectedText || "Please provide an answer based on my resume and the job description.", tab, "default");
  }

  if (info.menuItemId === "ai-answer-cover-letter") {
    handleContextCoverLetter(tab);
  }

  if (info.menuItemId === "ai-answer-fit") {
    handleAiAnswer("What makes you a good fit?", tab, "fit");
  }

  if (info.menuItemId === "clyde-marketing-action") {
    chrome.tabs.create({ url: "https://clydeai.live" });
    return;
  }

  if (info.menuItemId === "settings-action") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (info.menuItemId === "user-guide-action") {
    chrome.tabs.create({ url: chrome.runtime.getURL("user-guide.html") });
    return;
  }
});

async function injectScripts(tabId) {
  try {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => { console.log("[Clyde Go] No active sidebar listener found on page. Initiating script injection..."); }
    }).catch(() => {});

    const manifest = chrome.runtime.getManifest();
    const jsFiles = manifest.content_scripts[0].js;
    
    await chrome.scripting.executeScript({
      target: { tabId }, // Target top-level main frame first to prevent ActiveTab third-party iframe CORS failures
      files: jsFiles
    });
    
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => { console.log("[Clyde Go] Script files injected successfully! Handshake pending..."); }
    }).catch(() => {});
  } catch (err) {
    console.error('[background] ActiveTab content script injection failed:', err.message);
    chrome.scripting.executeScript({
      target: { tabId },
      func: (errMsg) => { alert("[Clyde Go Error] Script injection failed: " + errMsg); },
      args: [err.message]
    }).catch(() => {});
  }
}

// Toggle on-page sidebar iframe when clicking the browser extension toolbar action icon
chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) {
    // Debug step: Alert the user that the background script has detected the click!
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { console.log("[Clyde Go] Toolbar action icon clicked! Initiating sidebar loader..."); }
    }).catch(() => {});

    // Standard Chromium callback-based sendMessage with lastError checks for absolute 100% compatibility across all engines (prevents silent Promise drop bugs)
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_SIDEBAR' }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        injectScripts(tab.id);
      }
    });
  }
});

// ── Message handler (popup-initiated generation) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from the extension itself
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === 'CONTENT_SCRIPT_LOADED') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'TOGGLE_SIDEBAR' }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'AUTOFILL_PROGRESS' || msg.type === 'AUTOFILL_DONE' || msg.type === 'AUTOFILL_ERROR') {
    if (sender.tab) {
      chrome.tabs.sendMessage(sender.tab.id, msg).catch(() => {});
    }
    return false;
  }

  if (msg.action === "generate") {
    handlePopupGenerate(msg.type, msg.clipIdx)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.action === "consume-credit") {
    chrome.storage.local.get('clydeProToken', (data) => {
      const proToken = data.clydeProToken?.trim();
      if (!proToken) {
        sendResponse({ error: 'Clyde Pro License Token not set in settings' });
        return;
      }
      consumeProCredit(proToken)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }
  
  if (msg.action === "extract-page") {
    handleExtractPage(msg.tabId, msg.text, msg.url)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "extract-page-from-sidebar") {
    handleExtractFromSidebar()
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "extract-page-from-content") {
    // Open the popup immediately to preserve the user gesture token
    if (chrome.action && chrome.action.openPopup) {
      chrome.action.openPopup().catch(err => console.log("Could not open popup:", err));
    }
    
    handleExtractPage(sender.tab?.id, msg.text, msg.url)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "network") {
    handleNetworkDraft(msg.clipIdx)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  
  // Extension-page-only actions: these should never come from a content script (tab context)
  const EXTENSION_PAGE_ONLY_ACTIONS = ['generate', 'consume-credit', 'network', 'extract-page-from-sidebar'];
  if (EXTENSION_PAGE_ONLY_ACTIONS.includes(msg.action) && sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    console.warn('Blocked privileged action from content script:', msg.action);
    return false;
  }

  // Extension-page-only types: these should never come from a content script (tab context)
  const EXTENSION_PAGE_ONLY_TYPES = ['TEST_PRO_TOKEN', 'CLEAR_RESUME', 'DOWNLOAD_COVER_LETTER'];
  if (EXTENSION_PAGE_ONLY_TYPES.includes(msg.type) && sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    console.warn('Blocked privileged message from content script:', msg.type);
    return false;
  }

  // Known handleMessage types
  const KNOWN_HANDLE_TYPES = ['ANALYZE_RESUME', 'FILL_FIELDS', 'GENERATE_COVER_LETTER',
    'GET_PROFILE', 'GET_RESUME_FILE', 'PARSE_PDF', 'TEST_API_KEY', 'TEST_PRO_TOKEN',
    'CLEAR_RESUME', 'DOWNLOAD_COVER_LETTER', 'AUDIT_RESUME'];

  if (msg.type && KNOWN_HANDLE_TYPES.includes(msg.type)) {
    handleMessage(msg, sender).then(sendResponse).catch(err => {
      console.error('Service worker error:', err);
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async response
  }

  // Unknown message type — log warning and reject
  if (msg.type) {
    console.warn('Unknown message type received:', msg.type);
    return false;
  }
});

async function handleExtractFromSidebar() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) throw new Error("No active tab found");
  const tab = tabs[0];

  let extractedText = "";

  // 1. Try sending a message to the content script first
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JD_FROM_PAGE' });
    extractedText = response?.text || "";
  } catch (err) {
    console.log("[background] Content script extraction message failed:", err);
  }

  // 2. Fallback to executeScript if message failed
  if (!extractedText) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          let textToExtract = "";
          if (typeof PortalHandlers !== 'undefined' && typeof PortalHandlers.detect === 'function') {
            const handler = PortalHandlers.detect();
            if (handler && typeof handler.getJobDescription === 'function') {
              textToExtract = handler.getJobDescription() || "";
            }
          }

          if (!textToExtract) {
            const clone = document.body.cloneNode(true);
            const stripTags = ['script', 'style', 'noscript', 'code', 'iframe', 'header', 'footer', 'nav'];
            for (const tag of stripTags) {
              clone.querySelectorAll(tag).forEach(el => el.remove());
            }

            textToExtract = clone.innerText || "";
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
          }
          return textToExtract;
        }
      });
      extractedText = results && results[0] && results[0].result;
    } catch (execErr) {
      console.error("[background] executeScript extraction fallback failed:", execErr);
      throw new Error("Could not extract page content. Please refresh the page and try again.");
    }
  }

  if (extractedText) {
    await handleExtractPage(tab.id, extractedText, tab.url);
    return { success: true, text: extractedText };
  } else {
    throw new Error("No job description text found on page.");
  }
}

async function handleExtractPage(tabId, selectedText, url) {
  if (!selectedText) throw new Error("No text found on page.");
  const data = await new Promise(r => chrome.storage.local.get({ clips: [], geminiApiKey: "", clydeProToken: "", activeResumeText: null, masterResumeText: null }, r));
  const clips = data.clips;
  const newClip = { 
    id: crypto.randomUUID(),
    text: selectedText, 
    url, 
    savedAt: new Date().toISOString(), 
    isSaved: false, 
    trackerStatus: "None",
    jobTitle: "Extracting...",
    companyName: "...",
    location: "..." 
  };
  clips.push(newClip);
  const activeClipIdx = clips.length - 1;
  
  await new Promise(r => chrome.storage.local.set({ clips, activeClipIdx }, r));
  if (tabId) showToast(tabId, "Saved to Clyde ✓", "#1a1a2e");

  // Run the heavy Gemini extraction and Clyde Desktop auto-sync asynchronously
  // so that the popup gets an immediate success response and doesn't freeze/hang.
  const apiKey = data.geminiApiKey?.trim();
  const proToken = data.clydeProToken?.trim();
  const resumeText = data.activeResumeText || data.masterResumeText || "";
  
  if (apiKey || proToken) {
    (async () => {
       try {
         const extracted = await extractJobInfoJson(apiKey, selectedText, resumeText);
         const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
         const targetIdx = freshData.clips.findIndex(c => c.id === newClip.id);
         
         if (targetIdx !== -1) {
            let companyFallback = "Company";
            if (url) {
              try {
                const host = new URL(url).hostname;
                const parts = host.replace(/^www\./i, '').split('.');
                if (parts.length > 0) {
                  companyFallback = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                }
              } catch (e) {}
            }

            freshData.clips[targetIdx].jobTitle = extracted.title || "Job Title";
            freshData.clips[targetIdx].companyName = extracted.company || companyFallback;
            freshData.clips[targetIdx].location = extracted.location || "Location";
            freshData.clips[targetIdx].score = extracted.score || null;
            freshData.clips[targetIdx].archetype = extracted.archetype || "Unknown";
            freshData.clips[targetIdx].salary = extracted.salary || "Unknown";
            freshData.clips[targetIdx].topStrength = extracted.top_strength || "";
            freshData.clips[targetIdx].mainGap = extracted.main_gap || "";
            freshData.clips[targetIdx].mitigation = extracted.mitigation || "";
            
            await new Promise(r => chrome.storage.local.set({clips: freshData.clips}, r));
            
            // Trigger auto-sync to Clyde Desktop App
            await autoSyncClipToClyde(freshData.clips[targetIdx]);
         }
       } catch (err) {
         console.error("Extraction error:", err);
       }
    })();
  }
  return { success: true };
}

  async function handlePopupGenerate(type, clipIdx) {
    const data = await new Promise(r =>
      chrome.storage.local.get({ geminiApiKey: "", clydeProToken: "", clips: [], masterResumeText: null, profile: {} }, r)
    );
    const apiKey = data.geminiApiKey?.trim();
    const proToken = data.clydeProToken?.trim();
    if (!apiKey && !proToken) throw new Error("No Gemini API key or Clyde Pro License Token. Open Settings.");
  
    const clip = data.clips[clipIdx];
    if (!clip) throw new Error("Clip not found");

    // Automatically make this clip active when generating documents for it
    await chrome.storage.local.set({ activeClipIdx: clipIdx });
  
    // CRITICAL: Always use the master resume for generation, never the active (previously tailored) resume
    const resumeText = data.masterResumeText || "";
    if (!resumeText) throw new Error("No master resume uploaded. Please upload a resume in Settings.");

  const profile = data.profile || {};
  const docs = [];
  const promises = [];

  const cvKey = `_tc_${Date.now()}_cv`;
  const coverKey = `_tc_${Date.now() + 1}_cover`;

  if (type === "cv" || type === "both") {
    promises.push(generateCvJson(apiKey, clip.text, resumeText).then(async d => {
      docs.push({ html: buildCvHtml(d, profile.portfolioUrl), order: 0, key: cvKey });
      // Generate flat text CV and save as active resume
      const flatText = generateFlatCvText(d, profile.portfolioUrl);
      const activeName = `${d.job_title || 'Role'} - ${d.company_name || 'Company'} - CV`;
      
      const freshData = await new Promise(r => chrome.storage.local.get({ clips: [] }, r));
      if (freshData.clips[clipIdx]) {
        freshData.clips[clipIdx].tailoredResumeText = flatText;
        freshData.clips[clipIdx].tailoredResumeName = activeName;
        freshData.clips[clipIdx].tailoredResumeKey = cvKey;
        await chrome.storage.local.set({ 
          clips: freshData.clips,
          activeResumeText: flatText,
          activeResumeName: activeName 
        });

        // Asynchronously sync tailored resume to Clyde Desktop (Task 3.1)
        (async () => {
          try {
            const config = await chrome.storage.local.get(['clydeHost', 'clydePort']);
            await ClydeClient.saveTailoredDocToClyde({
              company: freshData.clips[clipIdx].companyName || 'Unknown Company',
              role: freshData.clips[clipIdx].jobTitle || '',
              filename: activeName,
              content: flatText,
              type: 'resume'
            }, {
              host: config.clydeHost,
              port: config.clydePort
            });
            console.log('[background] Synced tailored resume to Clyde Desktop');
          } catch (syncErr) {
            console.warn('[background] Deferring resume sync (desktop offline):', syncErr.message);
          }
        })();
      }
    }));
  }

  if (type === "cover" || type === "both") {
    promises.push(generateCoverJson(apiKey, clip.text, resumeText).then(async d => {
      if (d && d.paragraphs) {
        const portfolioUrl = cleanUrl(profile.portfolioUrl);
        if (portfolioUrl) {
          d.paragraphs.push(`Thank you for considering my application. My portfolio can be found at ${portfolioUrl.replace(/^https?:\/\/(www\.)?/, '')}.`);
        } else {
          d.paragraphs.push("Thank you for considering my application.");
        }
      }
      docs.push({ html: buildCoverHtml(d, resumeText, cleanUrl(profile.portfolioUrl)), order: 1, key: coverKey });
      
      const contactInfo = [];
      const city = profile.address?.city;
      const state = profile.address?.state;
      if (city && state) {
        contactInfo.push(`${city}, ${state}`);
      } else if (city || state) {
        contactInfo.push(city || state);
      }
      if (profile.phone) contactInfo.push(profile.phone);
      if (profile.email) contactInfo.push(profile.email);

      const headerBlock = [
        d.name || profile.fullName || "Applicant",
        contactInfo.join(' | ') || (d.email || d.location ? `${d.location || ''} | ${d.email || ''}` : '')
      ].join('\n');

      const plainText = [
        headerBlock,
        "",
        `Dear Hiring Manager,`,
        "",
        ...(d.paragraphs || [])
      ].join('\n\n');

      const freshData = await new Promise(r => chrome.storage.local.get({ clips: [] }, r));
      if (freshData.clips[clipIdx]) {
        freshData.clips[clipIdx].coverLetterText = plainText;
        freshData.clips[clipIdx].coverLetterKey = coverKey;
        await chrome.storage.local.set({ clips: freshData.clips });

        // Asynchronously sync cover letter to Clyde Desktop (Task 3.1)
        (async () => {
          try {
            const config = await chrome.storage.local.get(['clydeHost', 'clydePort']);
            const clName = `${freshData.clips[clipIdx].jobTitle || 'Role'} - ${freshData.clips[clipIdx].companyName || 'Company'} - Cover Letter`;
            await ClydeClient.saveTailoredDocToClyde({
              company: freshData.clips[clipIdx].companyName || 'Unknown Company',
              role: freshData.clips[clipIdx].jobTitle || '',
              filename: clName,
              content: plainText,
              type: 'cover-letter'
            }, {
              host: config.clydeHost,
              port: config.clydePort
            });
            console.log('[background] Synced cover letter to Clyde Desktop');
          } catch (syncErr) {
            console.warn('[background] Deferring cover letter sync (desktop offline):', syncErr.message);
          }
        })();
      }
    }));
  }

  if (type === "prep") {
    const prepKey = `_tc_${Date.now()}_prep`;
    promises.push(generatePrepJson(apiKey, clip.text, resumeText).then(async d => {
      docs.push({ html: buildPrepHtml(d, clip.jobTitle, clip.companyName), order: 2, key: prepKey });
      
      const freshData = await new Promise(r => chrome.storage.local.get({ clips: [] }, r));
      if (freshData.clips[clipIdx]) {
        freshData.clips[clipIdx].interviewPrepText = JSON.stringify(d);
        freshData.clips[clipIdx].interviewPrepKey = prepKey;
        await chrome.storage.local.set({ clips: freshData.clips });
      }
    }));
  }

  await Promise.all(promises);
  docs.sort((a, b) => a.order - b.order);

  for (let i = 0; i < docs.length; i++) {
    await new Promise(r => chrome.storage.local.set({ [docs[i].key]: docs[i].html }, r));
  }

  return { success: true, count: docs.length, keys: docs.map(d => d.key) };
}

  async function handleNetworkDraft(clipIdx) {
    const data = await new Promise(r =>
      chrome.storage.local.get({ geminiApiKey: "", clydeProToken: "", clips: [], masterResumeText: null }, r)
    );
    const apiKey = data.geminiApiKey?.trim();
    const proToken = data.clydeProToken?.trim();
    if (!apiKey && !proToken) throw new Error("No Gemini API key or Clyde Pro License Token.");
  
    const clip = data.clips[clipIdx];
    if (!clip) throw new Error("Clip not found");

    // Automatically make this clip active when generating documents for it
    await chrome.storage.local.set({ activeClipIdx: clipIdx });
  
    // CRITICAL: Always use the master resume for generation, never the active (previously tailored) resume
    const resumeText = data.masterResumeText || "";
  
  const systemInstruction = `You are an expert career coach writing a professional, thoughtful LinkedIn outreach message or InMail to a hiring manager or recruiter.
  
WRITING RULES:
- Tone: Professional, genuinely interested, and confident. Do not be overly casual (avoid "I built XYZ, let's connect").
- Length: Provide a well-crafted message suitable for a LinkedIn Direct Message or InMail (around 400-600 characters). It should be substantive but respectful of their time.
- Strategy: Express genuine interest in the specific role and company. Explicitly point out 1-2 direct connections between the candidate's exact experience/skills and the core requirements in the job description. Explain why it's a great fit.
- STRICT FACT-CHECKING: You MUST rely EXCLUSIVELY on the provided Resume and Job Description. DO NOT make things up, invent metrics, or assume skills not explicitly stated in the text.
- No Placeholders: Do not output placeholder brackets (like [Company] or [Role]). Extract the actual role and company from the job description. If the recruiter's name is unknown, use a professional greeting like "Hi Hiring Team,".
- Sign off professionally with the candidate's name.

Example of good output:
"Hi Hiring Team, I'm reaching out because I am genuinely interested in the Data Engineer position at Acme Corp. After reviewing the job description, I see a strong alignment with my background. Specifically, your focus on scaling ETL pipelines caught my eye; in my current role, I rebuilt our core data pipeline using Spark and Airflow, reducing processing time by 30%. I believe this experience directly translates to the goals of your data team. I would appreciate the opportunity to connect and discuss how I can contribute. Best regards, Alex"`;

  const prompt = `${systemInstruction}\n\nCandidate Resume:\n${resumeText}\n\nJob Description:\n${clip.text}`;
  const responseText = await Gemini.call(apiKey, prompt);
  return { success: true, message: responseText.trim() };
}

async function handleContextCoverLetter(tab) {
  chrome.storage.local.get({ geminiApiKey: "", clydeProToken: "", clips: [], activeClipIdx: null, activeResumeText: null, masterResumeText: null, profile: {} }, async (data) => {
    const apiKey = data.geminiApiKey?.trim();
    const proToken = data.clydeProToken?.trim();
    if (!apiKey && !proToken) {
      showToast(tab.id, "❌ No API key or Pro License Token set - open extension options.", "#b45309", 5000);
      return;
    }

    const resumeText = data.activeResumeText || data.masterResumeText || "";
    if (!resumeText) {
      showToast(tab.id, "❌ No resume uploaded. Please upload a resume in Settings.", "#b45309", 5000);
      return;
    }

    const { clips, activeClipIdx } = data;
    const activeClip = (activeClipIdx != null && clips[activeClipIdx]) ? clips[activeClipIdx] : null;
    
    if (!activeClip) {
      showToast(tab.id, "❌ Please save a job description clip first before drafting a cover letter.", "#b45309", 5000);
      return;
    }

    showToast(tab.id, "Drafting cover letter... ✍️", "#1e293b", 3000);

    try {
      const profile = data.profile || {};
      const coverLetter = await Gemini.generateCoverLetter(
        apiKey,
        resumeText,
        activeClip.text,
        activeClip.companyName || "Unknown Company",
        activeClip.jobTitle || "Unknown Role",
        profile.portfolioUrl
      );

      if (coverLetter) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_COVER_LETTER_PREVIEW',
          coverLetter
        }).catch(() => {});
      } else {
        showToast(tab.id, "❌ Failed to generate cover letter.", "#ea4335", 5000);
      }
    } catch (err) {
      console.error(err);
      showToast(tab.id, "❌ Cover letter generation failed.", "#ea4335", 5000);
    }
  });
}

// ── AI answer flow ─────────────────────────────────────────────────────────────

async function handleAiAnswer(question, tab, type = "custom") {
  chrome.storage.local.get({ geminiApiKey: "", clydeProToken: "", clips: [], activeClipIdx: null, activeResumeText: null, masterResumeText: null }, async (data) => {
    const apiKey = data.geminiApiKey?.trim();
    const proToken = data.clydeProToken?.trim();

    if (!apiKey && !proToken) {
      showToast(tab.id, "❌ No API key or Pro License Token set - open extension options.", "#b45309", 5000);
      return;
    }

    const resumeText = data.activeResumeText || data.masterResumeText || "";
    if (!resumeText) {
      showToast(tab.id, "❌ No resume uploaded. Please upload a resume in Settings.", "#b45309", 5000);
      return;
    }

    // Resolve active job description clip
    const { clips, activeClipIdx } = data;
    const activeClip = (activeClipIdx != null && clips[activeClipIdx])
      ? clips[activeClipIdx]
      : null;

    let customDirections = null;
    let tonePreference = 'normal';
    let charLimitPref = 0;
    let wordLimitPref = 0;

    if (type === "custom") {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          args: [question],
          func: (highlightedQuestion) => {
            function _escape(str) { if (str == null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
            return new Promise((resolve) => {
              const overlay = document.createElement('div');
              Object.assign(overlay.style, {
                position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
                backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '2147483647', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              });

              const shadow = overlay.attachShadow({ mode: 'open' });

              const modal = document.createElement('div');
              Object.assign(modal.style, {
                background: '#1e293b', padding: '24px', borderRadius: '12px', width: '400px',
                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)', color: '#f1f5f9',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxSizing: 'border-box'
              });

              const isHighlighted = !!highlightedQuestion;
              const labelText = isHighlighted ? "Custom Instructions (optional)" : "Custom Prompt";
              const placeholderText = isHighlighted ? "what to mention, what not to mention, what to focus more on, etc." : "e.g. 'explain how I can help optimize their support operations...'";

              let subtitleBlockHtml = "";
              if (isHighlighted) {
                subtitleBlockHtml = `
                  <div style="font-size: 13px !important; font-weight: 500 !important; color: #94a3b8 !important; margin-bottom: 16px !important; display: block !important; position: relative !important; line-height: 1.4 !important;">Custom AI Instructions</div>
                `;
              }

              let questionBlockHtml = "";
              if (isHighlighted) {
                questionBlockHtml = `
                  <div style="margin-bottom: 20px !important; display: block !important; position: relative !important;">
                    <div style="font-size: 11px !important; font-weight: 600 !important; color: #94a3b8 !important; text-transform: uppercase !important; letter-spacing: 0.05em !important; margin-bottom: 6px !important; line-height: 1.2 !important; display: block !important; position: relative !important;">Selected Question</div>
                    <div style="background: rgba(15, 23, 42, 0.4) !important; border: 1px solid rgba(255, 255, 255, 0.05) !important; border-radius: 6px !important; padding: 12px !important; color: #cbd5e1 !important; font-size: 13px !important; line-height: 1.5 !important; max-height: 90px !important; overflow-y: auto !important; font-style: italic !important; display: block !important; position: relative !important; text-align: left !important; box-sizing: border-box !important;">
                      "${_escape(highlightedQuestion)}"
                    </div>
                  </div>
                `;
              }

              modal.innerHTML = `
                <style>
                  div, label, span, textarea, button, input {
                    box-sizing: border-box !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                  }
                  label {
                    display: block !important;
                    margin-bottom: 12px !important;
                    font-size: 14px !important;
                    font-weight: 500 !important;
                    color: #cbd5e1 !important;
                    position: relative !important;
                    height: auto !important;
                    line-height: 1.4 !important;
                    float: none !important;
                    clear: both !important;
                  }
                  span {
                    font-weight: inherit !important;
                    color: inherit !important;
                  }
                  .range-container {
                    position: relative !important;
                    width: 100% !important;
                    height: 6px !important;
                    margin-top: 14px !important;
                    margin-bottom: 14px !important;
                    background: rgba(255, 255, 255, 0.1) !important;
                    border-radius: 3px !important;
                    display: block !important;
                  }
                  .range-track {
                    position: absolute !important;
                    height: 100% !important;
                    background: #38bdf8 !important;
                    border-radius: 3px !important;
                    display: block !important;
                  }
                  .range-slider {
                    position: absolute !important;
                    width: 100% !important;
                    height: 6px !important;
                    background: none !important;
                    pointer-events: none !important;
                    -webkit-appearance: none !important;
                    appearance: none !important;
                    margin: 0 !important;
                    top: 0 !important;
                    left: 0 !important;
                    display: block !important;
                  }
                  .range-slider::-webkit-slider-thumb {
                    height: 16px !important;
                    width: 16px !important;
                    border-radius: 50% !important;
                    background: #38bdf8 !important;
                    cursor: pointer !important;
                    pointer-events: auto !important;
                    -webkit-appearance: none !important;
                    appearance: none !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
                    transition: transform 0.1s !important;
                  }
                  .range-slider::-webkit-slider-thumb:hover {
                    transform: scale(1.2) !important;
                  }
                </style>
                <h3 style="margin: 0 0 ${isHighlighted ? '4px' : '16px'} 0 !important; font-size: 18px !important; color: #38bdf8 !important; font-weight: 600 !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important; display: block !important; position: relative !important; line-height: 1.4 !important; float: none !important; height: auto !important;">Answer with Clyde</h3>
                ${subtitleBlockHtml}
                ${questionBlockHtml}
                <div style="margin-bottom: 28px !important; display: block !important; position: relative !important; float: none !important; height: auto !important;">
                  <label style="display: block !important; margin-bottom: 12px !important; font-size: 14px !important; font-weight: 500 !important; color: #cbd5e1 !important; position: relative !important; line-height: 1.4 !important; float: none !important; height: auto !important;">${labelText}</label>
                  <textarea id="ai-custom-prompt" rows="3" style="width: 100% !important; box-sizing: border-box !important; padding: 10px !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 6px !important; resize: none !important; font-family: inherit !important; font-size: 14px !important; display: block !important; position: relative !important; margin-top: 4px !important; height: 80px !important; background: rgba(15, 23, 42, 0.6) !important; color: #f1f5f9 !important; outline: none !important;" placeholder="${placeholderText}"></textarea>
                </div>
                <div style="margin-bottom: 32px !important; display: block !important; position: relative !important; float: none !important; height: auto !important;">
                  <label style="display: block !important; margin-bottom: 12px !important; font-size: 14px !important; font-weight: 500 !important; color: #cbd5e1 !important; position: relative !important; line-height: 1.4 !important; float: none !important; height: auto !important;">Tone</label>
                  <div style="display: flex !important; align-items: center !important; justify-content: space-between !important; font-size: 12px !important; color: #94a3b8 !important; margin-bottom: 12px !important; font-weight: 500 !important; position: relative !important; float: none !important; height: auto !important; width: 100% !important; line-height: 1.4 !important;">
                    <span style="font-weight: 500 !important; color: #94a3b8 !important; display: inline !important; position: relative !important;">Casual</span>
                    <span style="font-weight: 500 !important; color: #94a3b8 !important; display: inline !important; position: relative !important;">Normal</span>
                    <span style="font-weight: 500 !important; color: #94a3b8 !important; display: inline !important; position: relative !important;">Formal</span>
                  </div>
                  <input type="range" id="ai-tone-slider" min="1" max="3" value="2" style="width: 100% !important; accent-color: #38bdf8 !important; cursor: pointer !important; display: block !important; position: relative !important; margin-top: 4px !important; height: auto !important;">
                </div>
                <div style="margin-bottom: 24px !important; display: block !important; position: relative !important; float: none !important; height: auto !important;">
                  <label style="display: flex !important; justify-content: space-between !important; margin-bottom: 8px !important; font-size: 14px !important; font-weight: 500 !important; color: #cbd5e1 !important; position: relative !important; line-height: 1.4 !important; float: none !important; height: auto !important;">
                    <span style="font-weight: 500 !important; color: #cbd5e1 !important; display: inline !important; position: relative !important;">Character Count Range</span>
                    <span id="char-limit-val" style="color: #94a3b8 !important; font-weight: 400 !important; display: inline !important; position: relative !important;">No limit</span>
                  </label>
                  <div class="range-container">
                    <div id="char-track" class="range-track" style="left: 0%; right: 0%;"></div>
                    <input type="range" id="ai-char-min" class="range-slider" min="0" max="2000" step="50" value="0">
                    <input type="range" id="ai-char-max" class="range-slider" min="0" max="2000" step="50" value="2000">
                  </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px; display: flex !important; position: relative !important;">
                  <button id="ai-modal-cancel" style="padding: 8px 16px; border: 1px solid rgba(255, 255, 255, 0.1) !important; background: rgba(255, 255, 255, 0.08) !important; color: #cbd5e1 !important; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.15s; outline: none !important;">Cancel</button>
                  <button id="ai-modal-submit" style="padding: 8px 16px; border: none !important; background: #f97316 !important; color: #ffffff !important; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: opacity 0.15s; outline: none !important;">Generate</button>
                </div>
              `;

              shadow.appendChild(modal);
              document.body.appendChild(overlay);

              const btnCancel = shadow.getElementById('ai-modal-cancel');
              const btnSubmit = shadow.getElementById('ai-modal-submit');
              const inputCustom = shadow.getElementById('ai-custom-prompt');

              btnCancel.onmouseover = () => btnCancel.style.background = 'rgba(255, 255, 255, 0.15)';
              btnCancel.onmouseout = () => btnCancel.style.background = 'rgba(255, 255, 255, 0.08)';
              
              btnSubmit.onmouseover = () => btnSubmit.style.opacity = '0.9';
              btnSubmit.onmouseout = () => btnSubmit.style.opacity = '1';

              setTimeout(() => inputCustom.focus(), 50);

              // Setup Character Range Dual Sliders
              const charMin = shadow.getElementById('ai-char-min');
              const charMax = shadow.getElementById('ai-char-max');
              const charTrack = shadow.getElementById('char-track');
              const charVal = shadow.getElementById('char-limit-val');

              const updateCharRange = () => {
                let minVal = parseInt(charMin.value, 10);
                let maxVal = parseInt(charMax.value, 10);

                if (minVal > maxVal) {
                  charMin.value = maxVal;
                  minVal = maxVal;
                }

                const minPercent = (minVal / charMin.max) * 100;
                const maxPercent = (maxVal / charMax.max) * 100;

                charTrack.style.left = minPercent + '%';
                charTrack.style.right = (100 - maxPercent) + '%';

                if (minVal === 0 && maxVal === 2000) {
                  charVal.textContent = 'No limit';
                } else {
                  charVal.textContent = `${minVal} - ${maxVal} chars`;
                }
              };

              charMin.addEventListener('input', updateCharRange);
              charMax.addEventListener('input', updateCharRange);
              updateCharRange();

              // Submit state validation
              const updateSubmitState = () => {
                if (!isHighlighted) {
                  const hasText = inputCustom.value.trim().length > 0;
                  btnSubmit.disabled = !hasText;
                  btnSubmit.style.opacity = hasText ? '1' : '0.5';
                  btnSubmit.style.cursor = hasText ? 'pointer' : 'not-allowed';
                }
              };

              inputCustom.addEventListener('input', updateSubmitState);
              updateSubmitState();

              btnCancel.onclick = () => {
                document.body.removeChild(overlay);
                resolve(null);
              };

              btnSubmit.onclick = () => {
                const text = inputCustom.value;
                const toneVal = shadow.getElementById('ai-tone-slider').value;
                let tone = 'normal';
                if (toneVal === '1') tone = 'casual';
                if (toneVal === '3') tone = 'formal';
                const cMin = parseInt(charMin.value, 10);
                const cMax = parseInt(charMax.value, 10);
                document.body.removeChild(overlay);
                resolve({ text, tone, charMin: cMin, charMax: cMax });
              };
            });
          }
        });

        const res = results[0]?.result;
        if (!res) return; // User cancelled
        
        if (question) {
          // Mode 1: Text highlighted (Answer with custom instructions)
          customDirections = res.text?.trim() || null;
        } else {
          // Mode 2: No text highlighted (Answer with custom prompt)
          question = res.text?.trim() || null;
          customDirections = null;
        }
        
        tonePreference = res.tone;
        charLimitPref = (res.charMin > 0 || res.charMax < 2000) ? { min: res.charMin, max: res.charMax } : 0;
        wordLimitPref = 0;
      } catch(err) {
        // Ignore if prompt fails
        console.error("Could not inject custom prompt modal:", err);
      }
    } else if (type === "fit") {
      charLimitPref = 400;
    }

    let activeMaxLength = null;
    try {
      const lengthResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const el = document.activeElement;
          return el && typeof el.maxLength === 'number' && el.maxLength > 0 && el.maxLength < 524288 ? el.maxLength : null;
        }
      });
      activeMaxLength = lengthResults[0]?.result;
    } catch (err) {
      // Ignore if we can't get the max length
    }

    const toastId = `ai-toast-${Date.now()}`;
    const contextNote = activeClip ? " (with JD)" : " (no JD selected)";
    showPersistentToast(tab.id, toastId, `Thinking${contextNote}...`, "#4f46e5");

    try {
      const answer = await callGemini(apiKey, question, activeClip?.text ?? null, resumeText, null, customDirections, tonePreference, activeMaxLength, charLimitPref, wordLimitPref);
      await copyToClipboard(tab.id, answer);
      replacePersistentToast(tab.id, toastId, "✅ Answer copied to clipboard", "#16a34a");
    } catch (err) {
      replacePersistentToast(tab.id, toastId, `❌ Gemini error: ${err.message}`, "#dc2626", 6000);
    }
  });
}

async function callGemini(apiKey, question, jobDescription, resumeText, customSystemInstruction = null, customDirections = null, tonePreference = 'normal', maxLength = null, charLimit = 0, wordLimit = 0) {
  let styleGuide = "";
  try {
    const response = await fetch(chrome.runtime.getURL('anti-ai-writing-style.md'));
    if (response.ok) {
      styleGuide = await response.text();
    }
  } catch (e) {
    console.error("Could not load style guide:", e);
  }

  const profile = await Storage.getProfile();
  const fullName = profile.fullName || "the applicant";
  const firstName = profile.firstName || "the applicant";

  const defaultSystemInstruction = `You are ${fullName} filling out a job application. Answer in first person using only facts from the supplied resume and job description. Output only the answer text, ready to paste. No preamble, no labels, no quotation marks, no markdown headings.

GROUNDING RULES
- Every concrete claim must come from the supplied resume. Prefer one quantified proof over vague strengths.
- Tie the answer to something specific from the job description when one is provided (tooling, domain, team shape, metric they care about).
- The applicant has options; they are choosing this role for concrete reasons, not asking to be considered.
- Confident, not arrogant. Selective, not superior: intentional about fit and impact from day one.
- Proof over claims: do not say "I'm great at X"; say what was built or done and what it changed, using only supplied facts.

STYLE RULES (strict)
- Never use an em dash (-). Use commas, colons, semicolons, or split into separate sentences.
- No corporate filler: do not use "I'm passionate about", "I would love the opportunity to", "synergy", or "leverage" as empty glue words.
- Short sentences, active voice. Default 2 to 4 sentences unless the question clearly calls for a longer paragraph; then stay tight and structured.
- Mirror the language of the question and job description.
- CRITICAL: You must strictly follow the additional writing style rules provided below.

CUSTOM PREFERENCES
- Emphasize business impact alongside technical implementation (e.g. "built X which drove Y metric" instead of just "built X").
- If asked about conflict or disagreement, show a pragmatic, resolution-focused approach that centers on shared goals.
- If a required skill is completely missing from the resume, state clearly what closely related skills are available instead of hallucinating experience.
- Leadership and builder questions: when the question allows, show both people and systems leadership alongside building (tools, workflows, automation) from real experience only.

ANTI-AI WRITING STYLE RULES:
${styleGuide}`;

  const systemInstruction = customSystemInstruction || defaultSystemInstruction;

  const jdSection = jobDescription
    ? `\n\nHere is the job description for the role being applied to:\n\n${jobDescription}\n`
    : "";
    
  let toneInstruction = "";
  if (tonePreference === 'casual') {
    toneInstruction = `\n\nTone constraint: Write in a more casual, warm, conversational tone (e.g. using slightly more relaxed phrasing while remaining professional).`;
  } else if (tonePreference === 'formal') {
    toneInstruction = `\n\nTone constraint: Write in a highly formal, traditional corporate tone.`;
  }

  let lengthInstruction = "";
  let appliedCharLimit = null;
  
  if (maxLength && maxLength > 0 && charLimit > 0) {
     appliedCharLimit = Math.min(maxLength, charLimit);
  } else if (maxLength && maxLength > 0) {
     appliedCharLimit = maxLength;
  } else if (charLimit > 0) {
     appliedCharLimit = charLimit;
  }

  if (appliedCharLimit) {
    lengthInstruction += `\n\nCRITICAL LENGTH CONSTRAINT: The answer MUST be strictly shorter than ${appliedCharLimit} characters in total length. Do not exceed this limit under any circumstances. Ensure you are well within this limit.`;
  }
  if (wordLimit > 0) {
    lengthInstruction += `\n\nCRITICAL LENGTH CONSTRAINT: The answer MUST NOT exceed ${wordLimit} words. Please keep it concise and under this limit.`;
  }

  const directionsSection = customDirections || toneInstruction || lengthInstruction
    ? `\n\nAdditional instructions for this specific question:\n${customDirections || ""}${toneInstruction}${lengthInstruction}`
    : "";

  const userPrompt = `Here is ${firstName}'s resume:\n\n${resumeText}${jdSection}\n---\n\nJob application question:\n${question}${directionsSection}`;

  const storage = await chrome.storage.local.get('clydeProToken');
  const proToken = storage.clydeProToken?.trim();

  let fetchUrl, fetchHeaders, fetchBody;

  if (proToken && !apiKey) {
    fetchUrl = 'https://clydeai.live/api/proxy';
    fetchHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${proToken}`
    };
    fetchBody = JSON.stringify({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      model: 'gemini-2.5-flash'
    });
  } else {
    fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    fetchHeaders = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
    fetchBody = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }]
    });
  }

  const response = await fetch(fetchUrl, {
    method: "POST",
    headers: fetchHeaders,
    body: fetchBody
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text.trim();
}

// ── Clipboard (must run in tab context) ───────────────────────────────────────

async function copyToClipboard(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (txt) => navigator.clipboard.writeText(txt),
    args: [text]
  });
}

// ── Toast helpers ──────────────────────────────────────────────────────────────

function showToast(tabId, message, bg, duration = 2500) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, background, ms) => {
      const el = document.createElement("div");
      el.textContent = msg;
      Object.assign(el.style, {
        position: "fixed", bottom: "24px", right: "24px",
        background, color: "#fff", padding: "10px 16px",
        borderRadius: "8px", fontSize: "14px", zIndex: "2147483647",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        transition: "opacity 0.4s ease", fontFamily: "sans-serif"
      });
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; }, ms - 400);
      setTimeout(() => { el.remove(); }, ms);
    },
    args: [message, bg, duration]
  }).catch(() => {});
}

function showPersistentToast(tabId, id, message, bg) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, background, toastId) => {
      const el = document.createElement("div");
      el.id = toastId;
      el.textContent = msg;
      Object.assign(el.style, {
        position: "fixed", bottom: "24px", right: "24px",
        background, color: "#fff", padding: "10px 16px",
        borderRadius: "8px", fontSize: "14px", zIndex: "2147483647",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontFamily: "sans-serif"
      });
      document.body.appendChild(el);
    },
    args: [message, bg, id]
  }).catch(() => {});
}

function replacePersistentToast(tabId, id, message, bg, duration = 3500) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (toastId, msg, background, ms) => {
      const el = document.getElementById(toastId);
      if (el) {
        el.textContent = msg;
        el.style.background = background;
        el.style.transition = "opacity 0.4s ease";
        setTimeout(() => { el.style.opacity = "0"; }, ms - 400);
        setTimeout(() => { el.remove(); }, ms);
      }
    },
    args: [id, message, bg, duration]
  }).catch(() => {});
}

// ── Gemini JSON calls ────────────────────────────────────────────────────────

async function callGeminiJson(apiKey, systemInstruction, userPrompt, retries = 1) {
  const storage = await chrome.storage.local.get('clydeProToken');
  const proToken = storage.clydeProToken?.trim();

  let fetchUrl, fetchHeaders, fetchBody;

  if (proToken && !apiKey) {
    fetchUrl = 'https://clydeai.live/api/proxy';
    fetchHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${proToken}`
    };
    fetchBody = JSON.stringify({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      model: 'gemini-2.5-flash'
    });
  } else {
    fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    fetchHeaders = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
    fetchBody = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });
  }

  const response = await fetch(fetchUrl, {
    method: "POST",
    headers: fetchHeaders,
    body: fetchBody
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  let text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  
  // Clean up any potential markdown code blocks just in case
  text = text.trim();
  if (text.startsWith('```json')) text = text.substring(7);
  else if (text.startsWith('```')) text = text.substring(3);
  if (text.endsWith('```')) text = text.substring(0, text.length - 3);
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    if (retries > 0) {
      console.warn("JSON parse failed, retrying...", err, text);
      return callGeminiJson(apiKey, systemInstruction, userPrompt, retries - 1);
    }
    console.error("Failed to parse Gemini JSON:", text);
    throw new Error("Failed to generate valid formatting. Please try again.");
  }
}

async function extractJobInfoJson(apiKey, jobDescription, resumeText) {
  const systemInstruction = `Extract the job title, company name, and location (including remote/hybrid status if applicable) from the following job description text. If you cannot find a specific piece of information, return "Unknown".

Also, evaluate the job description against the provided resume using the following 10-dimension scoring matrix (0-5 scale for each). Calculate the final weighted score (out of 5.0).
If specific dimensions (like Time to Offer, Comp, Reputation) are completely absent from the JD and cannot be inferred, default their score to 3.

Scoring Matrix:
1. North Star Alignment (25%): 5=exact target role, 1=unrelated
2. CV Match (15%): 5=90%+ match, 1=<40% match
3. Level (senior+) (15%): 5=staff+, 4=senior, 3=mid-senior, 2=mid, 1=junior
4. Estimated Comp (10%): 5=top quartile, 1=below market
5. Growth Trajectory (10%): 5=clear path to next level, 1=dead end
6. Remote Quality (5%): 5=full remote async, 1=onsite only
7. Company Reputation (5%): 5=top employer, 1=red flags
8. Tech Stack Modernity (5%): 5=cutting edge AI/ML, 1=legacy
9. Time to Offer (5%): 5=fast process, 1=6+ months
10. Cultural Signals (5%): 5=builder culture, 1=bureaucratic

Return ONLY valid JSON matching this structure:
{
  "title": "string",
  "company": "string",
  "location": "string",
  "archetype": "string (categorize as: Technical Support Manager, Support Engineering Manager, Support Operations Manager, Technical Support Director, or Unknown)",
  "salary": "string (extract explicitly listed salary range, or return Unknown)",
  "score": number (the final weighted score out of 5.0, rounded to 1 decimal place),
  "top_strength": "string (1 brief sentence identifying the strongest match)",
  "main_gap": "string (1 brief sentence identifying the biggest missing requirement)",
  "mitigation": "string (1 brief sentence on how to overcome the main_gap in an interview)"
}`;
  return callGeminiJson(apiKey, systemInstruction, `Resume:\n${resumeText || 'No resume provided. Score based on JD only.'}\n\nJob Description:\n${jobDescription}`);
}

async function generateCvJson(apiKey, jobDescription, resumeText) {
  const profile = await Storage.getProfile();
  const firstName = profile.firstName || "Stephen";
  const systemInstruction = `You generate tailored professional summaries and titles for an applicant's CV based on a job description.
  
  TAILORING RULES:
  - IMPORTANT: ALWAYS write the CV summary IN THE FIRST PERSON IMPLIED ("Spearheaded the launch of..." not "${firstName} spearheaded...").
  - NEVER refer to the applicant in the third person (${profile.firstName ? `"${profile.firstName}", ` : ''}"he", "she", "his", "her").
  - Rewrite the Professional Summary (2-4 sentences) to align with the JD's key requirements and vocabulary.
  - Never use bold or strong formatting in the summary.
  - Never use em dashes. Use commas, colons, semicolons, or separate sentences.
  
  Return ONLY valid JSON matching this structure:
  {
    "job_title": "string (the tailored job title from JD)",
    "company_name": "string (the company name from JD)",
    "summary": "string (the tailored summary)",
    "competencies": ["string (5 brief key competencies matching the JD)"]
  }`;

  const result = await callGeminiJson(apiKey, systemInstruction,
    `Resume Summary & Background:\n\n${resumeText}\n\nJob Description:\n\n${jobDescription}`);

  // Programmatically merge tailored details with the structured master resume if available!
  let d = null;
  try {
    const structured = await Storage.getStructuredResume();
    if (structured) {
      const parseBullets = (desc) => {
        if (!desc) return [];
        let cleanedDesc = desc.trim();

        // Smart fallback: If it has no newlines and no inline bullet characters, but is a long
        // block of text (e.g. 120+ chars), split it into separate bullets on sentences (period + space + capital letter)
        const hasMultipleLines = cleanedDesc.includes('\n');
        const hasInlineBullets = /[•\-*+]\s+/.test(cleanedDesc.substring(2));

        if (!hasMultipleLines && !hasInlineBullets && cleanedDesc.length > 120) {
          const sentences = cleanedDesc.split(/\.\s+(?=[A-Z])/);
          const bullets = [];
          sentences.forEach(s => {
            let clean = s.trim().replace(/^[\s\u200B\u00A0]*[-•●▪■◆○*+–—·∙]\s*/, '');
            if (clean) {
              if (!clean.endsWith('.')) {
                clean += '.';
              }
              bullets.push(clean);
            }
          });
          if (bullets.length > 0) {
            return bullets;
          }
        }

        const rawBullets = cleanedDesc.split('\n');
        const bullets = [];
        rawBullets.forEach(line => {
          const inlineBullets = line.split(/(?=\s*[•\-*+]\s+)/);
          inlineBullets.forEach(ib => {
            const clean = ib.trim().replace(/^[\s\u200B\u00A0]*[-•●▪■◆○*+–—·∙]\s*/, '');
            if (clean) bullets.push(clean);
          });
        });
        return bullets;
      };

      const experience = (structured.experience || []).map(job => {
        return {
          company: job.company || "",
          period: `${job.startDate || ""} - ${job.endDate || "Present"}`,
          role: job.title || "",
          location: job.location || "",
          bullets: parseBullets(job.description)
        };
      });

      const education = (structured.education || []).map(edu => ({
        org: edu.school || "",
        year: edu.graduationDate || "",
        major: edu.field || "",
        degree: edu.degree || ""
      }));

      const skills = [
        {
          category: "Skills",
          items: Array.isArray(structured.skills) ? structured.skills.join(", ") : (structured.skills || "")
        }
      ];

      const projects = (structured.projects || []).map(p => {
        return {
          title: p.title || "",
          role: p.role || "",
          bullets: parseBullets(p.description)
        };
      });

      const certifications = (structured.certifications || []).map(c => {
        return {
          title: c.title || "",
          org: c.org || "",
          year: c.year || "",
          bullets: parseBullets(c.description)
        };
      });

      d = {
        name: structured.fullName || "",
        email: structured.email || "",
        linkedin_url: structured.linkedinUrl || "",
        linkedin_display: structured.linkedinUrl ? structured.linkedinUrl.split('/').pop() : "",
        location: structured.address ? (structured.address.city && structured.address.state ? `${structured.address.city}, ${structured.address.state}` : (structured.address.city || structured.address.state || "")) : "",
        job_title: result.job_title || "Technical Support & Support Operations Leader",
        company_name: result.company_name || "Company",
        summary: result.summary,
        competencies: result.competencies || [],
        experience,
        projects,
        education,
        certifications,
        skills
      };
    }
  } catch (e) {
    console.error("Failed to merge with structured resume, using fallback", e);
  }

  if (!d) {
    // Generic empty fallback template if structured parse is missing
    d = {
      name: profile.fullName || "Applicant Name",
      email: profile.email || "email@example.com",
      linkedin_url: profile.linkedinUrl || "",
      linkedin_display: profile.linkedinUrl ? profile.linkedinUrl.split('/').pop() : "linkedin",
      location: profile.address ? (profile.address.city && profile.address.state ? `${profile.address.city}, ${profile.address.state}` : (profile.address.city || profile.address.state || "")) : "Location",
      job_title: result.job_title || "Role",
      company_name: result.company_name || "Company",
      summary: result.summary,
      competencies: result.competencies || [],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      skills: []
    };
  }

  return d;
}

async function generateCoverJson(apiKey, jobDescription, resumeText) {
  const profile = await Storage.getProfile();
  const firstName = profile.firstName || "Stephen";

  const systemInstruction = `You generate tailored cover letters. Given a resume and job description, return a JSON object with cover letter content.

WRITING RULES:
- IMPORTANT: ALWAYS write the cover letter IN THE FIRST PERSON ("I", "my", "me"). 
- NEVER refer to the applicant in the third person (${profile.firstName ? `"${profile.firstName}", ` : ''}"he", "she", "his", "her").
- 3-4 paragraphs, each 1-3 sentences. Short paragraphs by default.
- Open with something specific and compelling about the company or role from the JD, not generic praise.
- Every claim must be grounded in the resume. Use metrics from the resume when available. Be specific.
- Confident and selective tone: the candidate is choosing this role for concrete reasons, not asking to be considered.
- Never use em dashes. Use commas, colons, semicolons, or separate sentences.
- Vary sentence rhythm. Use active voice.
- BANNED VOCABULARY: delve, realm, harness, unlock, tapestry, paradigm, cutting-edge, revolutionize, intricate, crucial, pivotal, leverage, synergy, innovative, game-changer, seamless, robust, empower, elevate.
- BANNED PHRASES: "I am eager", "serves as", "boasts a", "features a", "In today's...", "Furthermore", "Additionally", "Moreover". Use plain verbs (is, has, uses).
- NO NEGATIVE PARALLELISM: Do not use "Not X, but Y", "It isn't X. It's Y". Just state the positive claim directly.
- NO ANALOGIES OR METAPHORS: Write literally. Do not use words like "bridge", "lens", "engine", "journey".
- Final paragraph: brief, forward-looking, express interest in a conversation. (Do NOT include thank-you or portfolio sign-off statements here, as they will be automatically appended by the system).

Return ONLY valid JSON matching this structure:
{
  "name": "string (applicant name)",
  "email": "string (applicant email)",
  "linkedin_url": "string",
  "location": "string",
  "company": "string (company name)",
  "role": "string (job title)",
  "paragraphs": ["string", "string", "string"]
}`;

  return callGeminiJson(apiKey, systemInstruction,
    `Resume:\n\n${resumeText}\n\nJob Description:\n\n${jobDescription}`);
}

async function generatePrepJson(apiKey, jobDescription, resumeText) {
  const systemInstruction = `You act as an expert interview coach. Generate 5 highly-tailored STAR+R (Situation, Task, Action, Result, Reflection) stories to help the candidate prepare for an interview for this specific role.

RULES:
- Extract the 5 most critical requirements/themes from the Job Description.
- Map each requirement to a specific, quantified experience from the Resume.
- The Reflection section is critical: it must demonstrate seniority by explaining what the candidate learned or what they would do differently next time.

Return ONLY valid JSON matching this structure:
{
  "stories": [
    {
      "jd_theme": "string (the requirement from the JD)",
      "situation": "string",
      "task": "string",
      "action": "string",
      "result": "string",
      "reflection": "string"
    }
  ]
}`;

  return callGeminiJson(apiKey, systemInstruction,
    `Resume:\n\n${resumeText}\n\nJob Description:\n\n${jobDescription}`);
}

function generateFlatCvText(d, portfolioUrl) {
  const lines = [];
  lines.push(d.name);
  const contactParts = [d.email, d.linkedin_url];
  if (portfolioUrl) {
    contactParts.push(portfolioUrl.replace(/^https?:\/\/(www\.)?/, ''));
  }
  contactParts.push(d.location);
  lines.push(contactParts.filter(Boolean).join(' | '));
  lines.push("");
  lines.push("PROFESSIONAL SUMMARY");
  lines.push(d.summary);
  lines.push("");
  lines.push("PROFESSIONAL EXPERIENCE");
  d.experience.forEach(job => {
    lines.push("");
    lines.push(`${job.company} | ${job.period} | ${job.role} | ${job.location}`);
    job.bullets.forEach(b => lines.push(`- ${b}`));
  });
  if (d.projects && d.projects.length) {
    lines.push("");
    lines.push("PROJECTS");
    d.projects.forEach(p => {
      lines.push(`${p.title} - ${p.description}`);
    });
  }
  if (d.skills && d.skills.length) {
    lines.push("");
    lines.push("SKILLS");
    d.skills.forEach(s => {
      lines.push(`${s.category}: ${s.items}`);
    });
  }
  if (d.certifications && d.certifications.length) {
    lines.push("");
    lines.push("CERTIFICATIONS");
    d.certifications.forEach(c => {
      lines.push(`${c.title} | ${c.org} | ${c.year}`);
    });
  }
  if (d.education && d.education.length) {
    lines.push("");
    lines.push("EDUCATION");
    d.education.forEach(e => {
      lines.push(`${e.org} | ${e.desc} | ${e.year}`);
    });
  }
  return lines.join("\n");
}

// ── HTML template builders ───────────────────────────────────────────────────

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCvHtml(d, portfolioUrl) {
  const competencies = (d.competencies || []).map(c =>
    `        <li>${esc(c)}</li>`
  ).join("\n");

  const experience = (d.experience || []).map(job => `
    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">${esc(job.company)}</span>
        <span class="job-period">${esc(job.period)}</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">${esc(job.role)}</span>
        <span class="job-location">${esc(job.location || "")}</span>
      </div>
      <ul>
        ${(job.bullets || []).map(b => `<li>${esc(b.trim().replace(/^[\s\u200B\u00A0]*[-•●▪■◆○*+–—·∙]\s*/, ''))}</li>`).join("\n")}
      </ul>
    </div>
  `).join("\n");

  const projects = (d.projects || []).map(p => `
    <div class="project avoid-break">
      <div class="project-title">${esc(p.title)}</div>
      <div class="project-role">${esc(p.role || "")}</div>
      <ul>
        ${(p.bullets || []).map(b => `<li>${esc(b.trim().replace(/^[\s\u200B\u00A0]*[-•●▪■◆○*+–—·∙]\s*/, ''))}</li>`).join("\n")}
      </ul>
    </div>
  `).join("\n");

  const education = (d.education || []).map(edu => `
    <div class="edu-item avoid-break">
      <div class="edu-header">
        <span class="edu-org">${esc(edu.org)}</span>
        <span class="edu-year">${esc(edu.year || "")}</span>
      </div>
      <div class="edu-desc"><em>${esc(edu.degree || "")}</em>, ${esc(edu.major || "")}</div>
    </div>
  `).join("\n");

  const certifications = (d.certifications || []).map(c => `
    <div style="font-weight: bold; font-size: 11px; margin-top: 2px;">${esc(c.title)} <span style="font-weight: normal;">| ${esc(c.org)} | ${esc(c.year)}</span></div>
    ${c.bullets && c.bullets.length ? `
    <ul>
      ${c.bullets.map(b => `<li>${esc(b.trim().replace(/^[\s\u200B\u00A0]*[-•●▪■◆○*+–—·∙]\s*/, ''))}</li>`).join("\n")}
    </ul>` : ''}
  `).join("\n");

  const skills = (d.skills || []).map(s => `
    <li><strong>${esc(s.category)}:</strong> ${esc(s.items)}</li>
  `).join("\n");

  const awards = (d.awards || []).map(a => `<li>${esc(a)}</li>`).join("\n");

  const docTitle = d.job_title && d.company_name 
    ? `${d.job_title} - ${d.company_name} - CV`
    : `${d.name} \u2014 CV`;

  const portfolioText = portfolioUrl 
    ? `      <span class="separator">|</span>\n      <a href="${esc(portfolioUrl)}" style="color: hsl(187, 74%, 32%);">${esc(portfolioUrl.replace(/^https?:\/\/(www\.)?/, ''))}</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(docTitle)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #000; background: #fff; }
  .page { width: 100%; max-width: 8.5in; margin: 0 auto; }
  
  /* Header */
  .header { margin-bottom: 16px; text-align: center; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; letter-spacing: -0.01em; }
  .contact-row { font-size: 10px; color: #000; }
  .contact-row a { color: #000; text-decoration: none; }
  .contact-row .separator { margin: 0 4px; }
  
  /* Sections */
  .section { margin-bottom: 12px; }
  .section-title { 
    font-size: 12px; 
    font-weight: 700; 
    text-transform: uppercase; 
    border-bottom: 1px solid #000; 
    padding-bottom: 2px; 
    margin-bottom: 6px; 
  }
  
  /* Text & Lists */
  .summary-text { font-size: 11px; line-height: 1.5; }
  ul { padding-left: 16px; margin-top: 2px; }
  li { font-size: 10.5px; line-height: 1.5; margin-bottom: 2px; }
  
  /* Jobs & Projects */
  .job { margin-bottom: 12px; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; }
  .job-company { font-size: 11px; font-weight: 700; }
  .job-period { font-size: 10.5px; font-weight: 700; }
  .job-subheader { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
  .job-role { font-size: 11px; font-style: italic; }
  .job-location { font-size: 10.5px; font-style: italic; }
  
  .project { margin-bottom: 10px; }
  .project-title { font-size: 11px; font-weight: 700; }
  .project-role { font-size: 11px; font-style: italic; margin-bottom: 2px; }
  
  /* Education */
  .edu-item { margin-bottom: 6px; }
  .edu-header { display: flex; justify-content: space-between; align-items: baseline; }
  .edu-org { font-weight: 700; font-size: 11px; }
  .edu-year { font-size: 10.5px; font-weight: 700; }
  .edu-desc { font-size: 10.5px; }
  
  @page { size: letter portrait; margin: 0.5in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .avoid-break { break-inside: avoid; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>${esc(d.name)}</h1>
    <div class="contact-row">
      <span>${esc(d.email)}</span>
      <span class="separator">|</span>
      <a href="https://${esc(d.linkedin_url)}">${esc(d.linkedin_display)}</a>
      ${portfolioText}
      <span class="separator">|</span>
      <span>${esc(d.location)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${esc(d.summary)}</div>
  </div>

  ${skills ? `
  <div class="section">
    <div class="section-title">Skills</div>
    <ul>
${skills}
    </ul>
  </div>` : ''}

  ${experience ? `
  <div class="section">
    <div class="section-title">Professional Experience</div>
${experience}
  </div>` : ''}

  ${projects ? `
  <div class="section avoid-break">
    <div class="section-title">Projects</div>
${projects}
  </div>` : ''}

  ${certifications ? `
  <div class="section avoid-break">
    <div class="section-title">Certifications</div>
${certifications}
  </div>` : ''}

  ${education ? `
  <div class="section avoid-break">
    <div class="section-title">Education</div>
${education}
  </div>` : ''}

  ${awards ? `
  <div class="section avoid-break">
    <div class="section-title">Awards</div>
    <ul>
${awards}
    </ul>
  </div>` : ''}

</div>
</body>
</html>`;
}

function buildCoverHtml(d, resumeText, portfolioUrl) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const paragraphs = d.paragraphs.map(p => {
    let escaped = esc(p);
    escaped = escaped.replace(/&lt;a href=&quot;(.*?)&quot;&gt;(.*?)&lt;\/a&gt;/gi, '<a href="$1">$2</a>');
    return `      <p>${escaped}</p>`;
  }).join("\n\n");

  // Extract name and contact from resumeText (first two lines)
  const resumeLines = (resumeText || "").split("\n").filter(line => line.trim() !== "");
  
  // Create a structured data fallback in case raw parsing fails
  const name = d.name || resumeLines[0]?.trim() || "Applicant";
  
  // Look for a line containing contact info separators
  const contactLine = resumeLines.find(line => line.includes("|")) || resumeLines[1] || "";
  const contactParts = contactLine.trim().split("|").map(s => s.trim());
  const email = d.email || contactParts.find(s => s.includes("@")) || "";
  const linkedin = d.linkedin_url || contactParts.find(s => s.includes("linkedin")) || "";
  const location = d.location || contactParts.find(s => !s.includes("@") && !s.includes("linkedin") && (s.includes(",") || s.includes("USA") || s.length > 3)) || "";

  const docTitle = d.role && d.company 
    ? `${d.role} - ${d.company} - Cover Letter`
    : `${name} \u2014 Cover Letter \u2014 ${d.company || 'Company'}`;

  const portfolioText = portfolioUrl 
    ? `      <span class="separator">|</span>\n      <a href="${esc(portfolioUrl)}" style="color: hsl(187, 74%, 32%);">${esc(portfolioUrl.replace(/^https?:\/\/(www\.)?/, ''))}</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@100..1000&family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', sans-serif; font-size: 11.5px; line-height: 1.65; color: #1a1a2e; background: #fff; }
  .page { width: 100%; max-width: 8.5in; margin: 0 auto; }
  .header { margin-bottom: 20px; }
  .header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.02em; margin-bottom: 4px; }
  .header-gradient { height: 2px; background: linear-gradient(to right, hsl(187, 74%, 32%), hsl(270, 70%, 45%)); border-radius: 1px; margin-bottom: 8px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 10px; color: #555; }
  .contact-row a { color: #555; text-decoration: none; white-space: nowrap; }
  .contact-row .separator { color: #ccc; }
  .letter { margin-top: 28px; }
  .date-line { font-size: 10.5px; color: #777; margin-bottom: 20px; }
  .salutation { font-size: 11.5px; font-weight: 500; color: #1a1a2e; margin-bottom: 16px; }
  .body p { font-size: 11.5px; line-height: 1.7; color: #333; margin-bottom: 14px; }
  .closing { margin-top: 24px; font-size: 11.5px; color: #333; line-height: 1.7; }
  .signature { margin-top: 16px; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; color: #1a1a2e; }
  a { white-space: nowrap; color: hsl(187, 74%, 32%); }
  @page { size: letter portrait; margin: 0.5in 0.6in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>${esc(name)}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">
      <span>${esc(email)}</span>
      <span class="separator">|</span>
      <a href="https://${esc(linkedin)}">${esc(linkedin)}</a>
      ${portfolioText}
      <span class="separator">|</span>
      <span>${esc(location)}</span>
    </div>
  </div>

  <div class="letter">
    <div class="date-line">${dateStr}</div>
    <div class="salutation">${esc(d.company || 'Hiring Team')} \u2014 ${esc(d.role || 'Position')}</div>

    <div class="body">

${paragraphs}

    </div>

    <div class="closing">
      Sincerely,
      <div class="signature">${esc(name)}</div>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── File download via tab context ────────────────────────────────────────────

async function downloadInTab(tabId, filename, content) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (fname, html) => {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    args: [filename, content]
  });
}



function buildPrepHtml(d, title, company) {
  const stories = d.stories.map((s, i) => `
    <div class="story-card avoid-break">
      <div class="story-theme">Theme ${i + 1}: ${esc(s.jd_theme)}</div>
      <div class="star-row"><strong>S</strong> <span class="star-content">${esc(s.situation)}</span></div>
      <div class="star-row"><strong>T</strong> <span class="star-content">${esc(s.task)}</span></div>
      <div class="star-row"><strong>A</strong> <span class="star-content">${esc(s.action)}</span></div>
      <div class="star-row"><strong>R</strong> <span class="star-content">${esc(s.result)}</span></div>
      <div class="star-row reflection"><strong>Reflection:</strong> <span class="star-content">${esc(s.reflection)}</span></div>
    </div>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Interview Prep \u2014 ${esc(company || 'Company')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', sans-serif; font-size: 11.5px; line-height: 1.5; color: #1f2937; background: #fff; padding: 0.5in 0.6in; }
  .header { margin-bottom: 24px; border-bottom: 2px solid hsl(187, 74%, 32%); padding-bottom: 12px; }
  .header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700; color: #111827; }
  .header p { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .story-card { background: hsl(187, 40%, 98%); border: 1px solid hsl(187, 40%, 88%); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .story-theme { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700; color: hsl(270, 70%, 45%); margin-bottom: 12px; border-bottom: 1px solid hsl(187, 40%, 88%); padding-bottom: 6px; }
  .star-row { margin-bottom: 8px; display: flex; gap: 12px; }
  .star-row strong { font-size: 14px; color: hsl(187, 74%, 32%); width: 16px; text-align: center; }
  .star-content { flex: 1; }
  .reflection { margin-top: 12px; padding-top: 12px; border-top: 1px dashed hsl(187, 40%, 88%); }
  .reflection strong { width: auto; font-size: 11.5px; }
  .avoid-break { break-inside: avoid; }
  @page { size: letter portrait; margin: 0.5in 0.6in; }
</style>
</head>
<body>
  <div class="header">
    <h1>Interview Prep Guide</h1>
    <p>${esc(title || 'Role')} at ${esc(company || 'Company')}</p>
  </div>
  ${stories}
</body>
</html>`;
}

// ---- AUTOFILL LOGIC ----

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'ANALYZE_RESUME':
      return await handleAnalyzeResume(message.payload);

    case 'FILL_FIELDS':
      return await handleFillFields(message.payload);

    case 'GENERATE_COVER_LETTER':
      return await handleGenerateCoverLetter(message.payload);

    case 'GET_PROFILE':
      flushUnsyncedClips(); // Trigger offline queue flush in background on popup load
      return await handleGetProfile();

    case 'GET_RESUME_FILE':
      return await handleGetResumeFile();

    case 'PARSE_PDF':
      return await handleParsePdf(message.payload);

    case 'TEST_API_KEY':
      return await handleTestApiKey(message.payload);

    case 'TEST_PRO_TOKEN':
      return await handleTestProToken(message.payload);

    case 'CLEAR_RESUME':
      return await handleClearResume();

    case 'DOWNLOAD_COVER_LETTER':
      return await handleDownloadCoverLetter(message.payload);

    case 'AUDIT_RESUME':
      return await handleAuditResume(message.payload);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function handleAuditResume({ resumeText }) {
  const apiKey = await Storage.getApiKey();
  if (!apiKey) throw new Error('Gemini API key not set');

  const systemInstruction = `You are a strict ATS resume auditor. Audit the provided resume text and return a plain text evaluation.

Do not use markdown formatting like bolding or headers. Use plain text formatting.

1. Give it a score out of 100 based on ATS parsability, metric usage, and active voice.
2. List the Top 2 Strengths.
3. List the Top 3 Weaknesses (focusing on missing metrics, passive verbs, or formatting issues).
4. Provide 2 highly actionable steps to improve it.`;

  const audit = await callGemini(apiKey, "Please audit my resume.", "", resumeText, systemInstruction);
  return { audit };
}

async function handleDownloadCoverLetter({ plainText, pdfBase64, baseName }) {
  const safe = String(baseName || 'Applicant').replace(/[/\\?*|<>:"]/g, '_').replace(/\s+/g, '_') || 'Applicant';
  const txtUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(plainText || '')}`;
  await chrome.downloads.download({
    url: txtUrl,
    filename: `Cover_Letter_${safe}.txt`,
    saveAs: false
  });
  if (pdfBase64) {
    const pdfUrl = `data:application/pdf;base64,${pdfBase64}`;
    await chrome.downloads.download({
      url: pdfUrl,
      filename: `Cover_Letter_${safe}.pdf`,
      saveAs: false
    });
  }
  return { ok: true };
}

async function handleGetResumeFile() {
  const activeText = await Storage.get('activeResumeText');
  const activeName = await Storage.get('activeResumeName');
  if (activeText && activeName) {
     return { generateFromText: true, text: activeText, fileName: activeName + '.pdf' };
  }
  return await Storage.getResumeFile();
}

async function handleAnalyzeResume({ resumeText }) {
  console.log('[Clyde Robust Log] handleAnalyzeResume initiated. Resume text length:', resumeText?.length || 0);
  const apiKey = await Storage.getApiKey();
  console.log('[Clyde Robust Log] Resolved API key/Pro status:', apiKey ? 'API Key / Pro exists' : 'None');
  if (!apiKey) throw new Error('Gemini API key not set');

  // Save raw text
  await Storage.saveResumeText(resumeText);
  console.log('[Clyde Robust Log] Saved raw resume text.');

  // Analyze with Gemini
  try {
    console.log('[Clyde Robust Log] Invoking Gemini.analyzeResume...');
    const structured = await Gemini.analyzeResume(apiKey, resumeText);
    console.log('[Clyde Robust Log] Gemini.analyzeResume returned successfully. Keys extracted:', Object.keys(structured || {}));
    
    await Storage.saveStructuredResume(structured);
    console.log('[Clyde Robust Log] Structured resume saved to local storage.');

    // Auto-populate profile from structured data
    const profile = await Storage.getProfile();
    const merged = {
      ...profile,
      fullName: structured.fullName || profile.fullName || '',
      firstName: structured.firstName || profile.firstName || '',
      lastName: structured.lastName || profile.lastName || '',
      email: structured.email || profile.email || '',
      phone: structured.phone || profile.phone || '',
      address: { ...(profile.address || {}), ...(structured.address || {}) },
      linkedinUrl: cleanUrl(structured.linkedinUrl || profile.linkedinUrl || ''),
      githubUrl: cleanUrl(structured.githubUrl || profile.githubUrl || ''),
      portfolioUrl: cleanUrl(structured.portfolioUrl || profile.portfolioUrl || ''),
      yearsOfExperience: structured.yearsOfExperience || profile.yearsOfExperience || 0
    };
    await Storage.saveProfile(merged);
    console.log('[Clyde Robust Log] Profile auto-populated and merged with structured resume.');

    return { structured, profile: merged };
  } catch (error) {
    console.error('[Clyde Robust Log] Error inside handleAnalyzeResume:', error);
    throw error;
  }
}

async function handleFillFields({ fields, jobDescription: originalJobDescription }) {
  const customInstructionsData = await chrome.storage.local.get('customDirections');
  const customInstructions = customInstructionsData.customDirections || null;
  const apiKey = await Storage.getApiKey();
  if (!apiKey) throw new Error('Gemini API key not set');

  const resumeText = await Storage.getResumeText();
  const profile = await Storage.getProfile();
  const customQA = await Storage.getCustomQA();
  
  // Use pinned JD from active clip if it exists to override extracted jobDescription
  let jobDescription = originalJobDescription;
  let activeClip = null;
  try {
    const data = await chrome.storage.local.get({ clips: [], activeClipIdx: null });
    if (data.activeClipIdx !== null && data.clips[data.activeClipIdx]) {
      activeClip = data.clips[data.activeClipIdx];
      jobDescription = activeClip.text;
    }
  } catch (e) {
    console.error("Failed to load active clip for autofill", e);
  }

  // Load useStarStoriesForQA setting and append stories to resume text context if enabled
  let sourceText = resumeText;
  try {
    const settings = await chrome.storage.local.get('useStarStoriesForQA');
    if (settings.useStarStoriesForQA && activeClip && activeClip.interviewPrepText) {
      sourceText = `${resumeText}\n\n=========================================\nADDITIONAL SOURCE DATA: STAR BEHAVIORAL INTERVIEW PREP STORIES:\n=========================================\n${activeClip.interviewPrepText}`;
      console.log('[background] Appended STAR interview prep stories to prompt source text.');
    }
  } catch (e) {
    console.error("Failed to load useStarStoriesForQA setting", e);
  }

  // Check custom Q&A first for matching questions
  const aiFields = [];
  const answers = {};

  for (const field of fields) {
    const match = customQA.find(qa =>
      field.label.toLowerCase().includes(qa.question.toLowerCase()) ||
      qa.question.toLowerCase().includes(field.label.toLowerCase())
    );
    if (match) {
      answers[field.id] = match.answer;
    } else {
      aiFields.push(field);
    }
  }

  // Send remaining to Gemini (omit work-auth dropdown value — it leaks into plain Yes/No eligibility answers)
  const profileForAi = { ...profile };
  delete profileForAi.workAuthorizationStatus;

  if (aiFields.length > 0) {
    let aiAnswers = await Gemini.answerFields(apiKey, aiFields, sourceText, profileForAi, jobDescription, customInstructions);
    // Gemini may return an array of objects instead of a flat object — flatten it
    if (Array.isArray(aiAnswers)) {
      const flat = {};
      for (const obj of aiAnswers) {
        if (obj && typeof obj === 'object') Object.assign(flat, obj);
      }
      aiAnswers = flat;
    }
    Object.assign(answers, aiAnswers);
  }

  return { answers, profile };
}

async function handleGenerateCoverLetter({ jobDescription: originalJobDescription, companyName, roleTitle }) {
  const apiKey = await Storage.getApiKey();
  if (!apiKey) throw new Error('Gemini API key not set');

  const resumeText = await Storage.getResumeText();
  
  // Use pinned JD from active clip if it exists
  let jobDescription = originalJobDescription;
  try {
    const data = await chrome.storage.local.get({ clips: [], activeClipIdx: null });
    if (data.activeClipIdx !== null && data.clips[data.activeClipIdx]) {
      jobDescription = data.clips[data.activeClipIdx].text;
    }
  } catch (e) {
    console.error("Failed to load active clip for autofill cover letter", e);
  }
  
  const profile = await Storage.getProfile();
  const coverLetter = await Gemini.generateCoverLetter(apiKey, resumeText, jobDescription, companyName, roleTitle, profile.portfolioUrl);
  return { coverLetter };
}

async function handleGetProfile() {
  const profile = await Storage.getProfile();
  const resumeText = await Storage.getResumeText();
  const structured = await Storage.getStructuredResume();
  const hasApiKey = !!(await Storage.getApiKey());
  const hasResume = !!resumeText;
  const settings = await Storage.getSettings();
  return { profile, resumeText, structured, hasApiKey, hasResume, settings };
}

async function handleParsePdf({ base64Data, fileName }) {
  // Save the raw file for later attachment
  await Storage.saveResumeFile(base64Data, fileName);

  // Create offscreen document for PDF parsing if it doesn't exist
  const offscreenUrl = 'offscreen/offscreen.html';
  const hasDocument = await chrome.offscreen.hasDocument();

  if (!hasDocument) {
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['DOM_PARSER'],
        justification: 'Parse PDF resume to extract text'
      });
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('Only a single offscreen document may be created')) {
        throw e;
      }
    }
  }

  // Send PDF data to offscreen document for parsing
  const result = await chrome.runtime.sendMessage({
    type: 'OFFSCREEN_PARSE_PDF',
    payload: { base64Data }
  });

  return result;
}

async function handleTestApiKey({ apiKey }) {
  try {
    await Gemini.call(apiKey, 'Say "OK" and nothing else.');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleTestProToken({ token }) {
  try {
    const response = await fetch('https://clydeai.live/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say "OK" and nothing else.' }] }],
        model: 'gemini-2.5-flash'
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: err?.error || `HTTP ${response.status}: ${response.statusText}` };
    }
    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (candidateText.trim()) {
      return { success: true };
    }
    return { success: false, error: 'Empty response received from Pro server.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleClearResume() {
  await Storage.remove('resumeText');
  await Storage.remove('resumeFile');
  await Storage.remove('structuredResume');
  return { success: true };
}

async function queueUnsyncedClip(clip) {
  if (!clip || !clip.text || !clip.text.trim()) {
    console.warn('[background] Skipping queueing of invalid clip (missing text description)');
    return;
  }
  try {
    const data = await chrome.storage.local.get({ unsyncedClips: [] });
    const exists = data.unsyncedClips.some(c => (c.id && clip.id && c.id === clip.id) || c.savedAt === clip.savedAt);
    if (!exists) {
      data.unsyncedClips.push(clip);
      await chrome.storage.local.set({ unsyncedClips: data.unsyncedClips });
      console.log('[background] Clip added to sync queue:', clip.companyName);
    }
  } catch (err) {
    console.error('[background] Failed to queue clip:', err.message);
  }
}

async function flushUnsyncedClips() {
  try {
    const data = await chrome.storage.local.get(['clydeAutoSync', 'clydeHost', 'clydePort', 'unsyncedClips']);
    if (data.clydeAutoSync && data.unsyncedClips && data.unsyncedClips.length > 0) {
      const host = data.clydeHost || '127.0.0.1';
      const port = parseInt(data.clydePort) || 4593;
      const opts = { host, port };

      const availability = await ClydeClient.isAvailable(opts);
      if (availability.available) {
        console.log(`[background] Clyde Desktop is online. Flushing ${data.unsyncedClips.length} queued clips...`);
        const queue = [...data.unsyncedClips];
        const remaining = [];

        for (const clip of queue) {
          if (!clip || !clip.text || !clip.text.trim()) {
            console.warn('[background] Cleaning up invalid queued clip (missing text description):', clip?.companyName);
            continue;
          }
          try {
            await ClydeClient.syncJobToClyde(
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
            console.log('[background] Successfully synced queued clip:', clip.companyName);
          } catch (err) {
            console.error('[background] Failed to sync queued clip:', clip.companyName, err.message);
            remaining.push(clip);
          }
        }

        await chrome.storage.local.set({ unsyncedClips: remaining });
      } else {
        console.warn('[background] Sync check: Clyde Desktop is not reachable. Queue remains intact.');
      }
    }
  } catch (err) {
    console.error('[background] Flush unsynced clips failed:', err.message);
  }
}

async function autoSyncClipToClyde(clip) {
  // Always queue the clip first to guarantee persistence
  await queueUnsyncedClip(clip);
  // Attempt to flush the queue immediately
  await flushUnsyncedClips();
}

// Trigger queue flush on browser / extension startup
chrome.runtime.onStartup.addListener(() => {
  flushUnsyncedClips();
});

// Setup background 5-minute sync alarm for high resilience in MV3 (Task 3.1)
chrome.alarms.create('clyde-flush-alarm', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'clyde-flush-alarm') {
    flushUnsyncedClips();
  }
});

// Auto-migrate existing clips with UUIDs on service worker startup (Task 3.2)
async function migrateExistingClips() {
  try {
    const data = await chrome.storage.local.get({ clips: [], unsyncedClips: [] });
    let hasUpdates = false;
    
    const updatedClips = data.clips.map(c => {
      if (c && !c.id) {
        c.id = crypto.randomUUID();
        hasUpdates = true;
      }
      return c;
    });
    
    const updatedUnsynced = data.unsyncedClips.map(c => {
      if (c && !c.id) {
        c.id = crypto.randomUUID();
        hasUpdates = true;
      }
      return c;
    });
    
    if (hasUpdates) {
      await chrome.storage.local.set({ clips: updatedClips, unsyncedClips: updatedUnsynced });
      console.log('[background] Migrated existing clips with secure UUIDs.');
    }
  } catch (err) {
    console.error('[background] Clip migration failed:', err.message);
  }
}
migrateExistingClips();

async function consumeProCredit(proToken) {
  try {
    const response = await fetch('https://clydeai.live/api/billing?action=consume-credit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proToken}`
      }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn('[background] Credit consumption failed:', err?.error || response.statusText);
      return { success: false, error: err?.error || response.statusText };
    }
    const data = await response.json();
    console.log('[background] Credit consumed successfully. Remaining credits:', data.credits);
    return { success: true, credits: data.credits };
  } catch (e) {
    console.error('[background] Credit consumption error:', e.message);
    return { success: false, error: e.message };
  }
}


