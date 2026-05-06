importScripts('lib/storage.js', 'lib/gemini.js');

// ── Context menus ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-selection",
    title: "Save to jayobee",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "ai-answer",
    title: "Answer with AI (Gemini)",
    contexts: ["selection", "page", "editable"]
  });

  chrome.contextMenus.create({
    id: "ai-answer-default",
    parentId: "ai-answer",
    title: "Answer Question (Default)",
    contexts: ["selection", "page", "editable"]
  });

  chrome.contextMenus.create({
    id: "ai-answer-custom",
    parentId: "ai-answer",
    title: "Custom Prompt",
    contexts: ["selection", "page", "editable"]
  });

  chrome.contextMenus.create({
    id: "ai-answer-fit",
    parentId: "ai-answer",
    title: "What makes you a good fit?",
    contexts: ["selection", "page", "editable"]
  });
});

// ── Context menu click handler ─────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText?.trim();
  const url = info.pageUrl || tab?.url;

  if (info.menuItemId === "save-selection") {
    if (!selectedText) return;
    chrome.storage.local.get({ clips: [], geminiApiKey: "" }, async (data) => {
      const clips = data.clips;
      const newClip = { 
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
      showToast(tab.id, "Saved to jayobee ✓", "#1a1a2e");

      // Extract details in background
      const apiKey = data.geminiApiKey?.trim();
      const resumeText = data.activeResumeText || data.masterResumeText || "";
      
      if (apiKey) {
         try {
           const extracted = await extractJobInfoJson(apiKey, selectedText, resumeText);
           const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
           const targetIdx = freshData.clips.findIndex(c => c.savedAt === newClip.savedAt);
           
           if (targetIdx !== -1) {
              freshData.clips[targetIdx].jobTitle = extracted.title || "Unknown Title";
              freshData.clips[targetIdx].companyName = extracted.company || "Unknown Company";
              freshData.clips[targetIdx].location = extracted.location || "Unknown Location";
              freshData.clips[targetIdx].score = extracted.score || null;
              freshData.clips[targetIdx].archetype = extracted.archetype || "Unknown";
              freshData.clips[targetIdx].salary = extracted.salary || "Unknown";
              freshData.clips[targetIdx].topStrength = extracted.top_strength || "";
              freshData.clips[targetIdx].mainGap = extracted.main_gap || "";
              freshData.clips[targetIdx].mitigation = extracted.mitigation || "";
              await chrome.storage.local.set({ clips: freshData.clips });
           }
         } catch(e) {
           console.error("Extraction failed", e);
           const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
           const targetIdx = freshData.clips.findIndex(c => c.savedAt === newClip.savedAt);
           if (targetIdx !== -1) {
              freshData.clips[targetIdx].jobTitle = "Unknown Title";
              freshData.clips[targetIdx].companyName = "Unknown Company";
              freshData.clips[targetIdx].location = "Unknown Location";
              await chrome.storage.local.set({ clips: freshData.clips });
           }
         }
      } else {
         const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
         const targetIdx = freshData.clips.findIndex(c => c.savedAt === newClip.savedAt);
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

  if (info.menuItemId === "ai-answer-default" || info.menuItemId === "ai-answer") {
    const q = selectedText || "Please provide an answer based on my resume and the job description.";
    handleAiAnswer(q, tab, "default");
  }

  if (info.menuItemId === "ai-answer-custom") {
    const q = selectedText || "Please provide an answer based on my resume and the job description.";
    handleAiAnswer(q, tab, "custom");
  }

  if (info.menuItemId === "ai-answer-fit") {
    handleAiAnswer("What makes you a good fit?", tab, "fit");
  }
});

// ── Message handler (popup-initiated generation) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AUTOFILL_PROGRESS' || msg.type === 'AUTOFILL_DONE' || msg.type === 'AUTOFILL_ERROR') {
    if (sender.tab) {
      chrome.tabs.sendMessage(sender.tab.id, msg).catch(() => {});
    }
    return true;
  }

  if (msg.action === "generate") {
    handlePopupGenerate(msg.type, msg.clipIdx)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
  
  if (msg.action === "extract-page") {
    handleExtractPage(msg.tabId, msg.text, msg.url)
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
  
  if (msg.type) {
    handleMessage(msg, sender).then(sendResponse).catch(err => {
      console.error('Service worker error:', err);
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async response
  }
});

async function handleExtractPage(tabId, selectedText, url) {
  if (!selectedText) throw new Error("No text found on page.");
  const data = await new Promise(r => chrome.storage.local.get({ clips: [], geminiApiKey: "", activeResumeText: null, masterResumeText: null }, r));
  const clips = data.clips;
  const newClip = { 
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
  if (tabId) showToast(tabId, "Saved to jayobee ✓", "#1a1a2e");

  // Extract details in background
  const apiKey = data.geminiApiKey?.trim();
  const resumeText = data.activeResumeText || data.masterResumeText || "";
  
  if (apiKey) {
     try {
       const extracted = await extractJobInfoJson(apiKey, selectedText, resumeText);
       const freshData = await new Promise(r => chrome.storage.local.get({clips: []}, r));
       const targetIdx = freshData.clips.findIndex(c => c.savedAt === newClip.savedAt);
       
       if (targetIdx !== -1) {
          freshData.clips[targetIdx].jobTitle = extracted.title || "Unknown Title";
          freshData.clips[targetIdx].companyName = extracted.company || "Unknown Company";
          freshData.clips[targetIdx].location = extracted.location || "Unknown Location";
          freshData.clips[targetIdx].score = extracted.score || null;
          freshData.clips[targetIdx].archetype = extracted.archetype || "Unknown";
          freshData.clips[targetIdx].salary = extracted.salary || "Unknown";
          freshData.clips[targetIdx].topStrength = extracted.top_strength || "";
          freshData.clips[targetIdx].mainGap = extracted.main_gap || "";
          freshData.clips[targetIdx].mitigation = extracted.mitigation || "";
          
          await new Promise(r => chrome.storage.local.set({clips: freshData.clips}, r));
       }
     } catch (err) {
       console.error("Extraction error:", err);
     }
  }
  return { success: true };
}

  async function handlePopupGenerate(type, clipIdx) {
    const data = await new Promise(r =>
      chrome.storage.local.get({ geminiApiKey: "", clips: [], masterResumeText: null }, r)
    );
    const apiKey = data.geminiApiKey?.trim();
    if (!apiKey) throw new Error("No Gemini API key. Open Settings.");
  
    const clip = data.clips[clipIdx];
    if (!clip) throw new Error("Clip not found");
  
    // CRITICAL: Always use the master resume for generation, never the active (previously tailored) resume
    const resumeText = data.masterResumeText || "";
    if (!resumeText) throw new Error("No master resume uploaded. Please upload a resume in Settings.");

  const docs = [];
  const promises = [];

  const cvKey = `_tc_${Date.now()}_cv`;
  const coverKey = `_tc_${Date.now() + 1}_cover`;

  if (type === "cv" || type === "both") {
    promises.push(generateCvJson(apiKey, clip.text, resumeText).then(async d => {
      docs.push({ html: buildCvHtml(d), order: 0, key: cvKey });
      // Generate flat text CV and save as active resume
      const flatText = generateFlatCvText(d);
      const activeName = `${d.job_title || 'Role'} - ${d.company_name || 'Company'} - CV`;
      await chrome.storage.local.set({ 
        activeResumeText: flatText,
        activeResumeName: activeName 
      });
    }));
  }

  if (type === "cover" || type === "both") {
    promises.push(generateCoverJson(apiKey, clip.text, resumeText).then(d => {
      docs.push({ html: buildCoverHtml(d, resumeText), order: 1, key: coverKey });
    }));
  }

  if (type === "prep") {
    promises.push(generatePrepJson(apiKey, clip.text, resumeText).then(d => {
      docs.push({ html: buildPrepHtml(d, clip.jobTitle, clip.companyName), order: 2, key: `_tc_${Date.now()}_prep` });
    }));
  }

  await Promise.all(promises);
  docs.sort((a, b) => a.order - b.order);

  for (let i = 0; i < docs.length; i++) {
    await new Promise(r => chrome.storage.local.set({ [docs[i].key]: docs[i].html }, r));
    await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?key=${encodeURIComponent(docs[i].key)}`) });
    if (i < docs.length - 1) await new Promise(r => setTimeout(r, 400));
  }

  return { success: true, count: docs.length };
}

  async function handleNetworkDraft(clipIdx) {
    const data = await new Promise(r =>
      chrome.storage.local.get({ geminiApiKey: "", clips: [], masterResumeText: null }, r)
    );
    const apiKey = data.geminiApiKey?.trim();
    if (!apiKey) throw new Error("No Gemini API key.");
  
    const clip = data.clips[clipIdx];
    if (!clip) throw new Error("Clip not found");
  
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: `Resume:\n${resumeText}\n\nJob Description:\n${clip.text}` }] }]
      })
    }
  );

  if (!response.ok) throw new Error("Network request failed");
  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  return { success: true, message: text.trim() };
}

// ── AI answer flow ─────────────────────────────────────────────────────────────

async function handleAiAnswer(question, tab, type = "custom") {
  chrome.storage.local.get({ geminiApiKey: "", clips: [], activeClipIdx: null, activeResumeText: null, masterResumeText: null }, async (data) => {
    const apiKey = data.geminiApiKey.trim();

    if (!apiKey) {
      showToast(tab.id, "❌ No Gemini API key set - open extension options to add it.", "#b45309", 5000);
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
          func: () => {
            return new Promise((resolve) => {
              const overlay = document.createElement('div');
              Object.assign(overlay.style, {
                position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
                backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '2147483647', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              });

              const modal = document.createElement('div');
              Object.assign(modal.style, {
                background: '#fff', padding: '24px', borderRadius: '12px', width: '400px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.2)', color: '#111827',
                boxSizing: 'border-box'
              });

              modal.innerHTML = `
                <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #111827; font-weight: 600;">Custom AI Instructions</h3>
                <div style="margin-bottom: 20px;">
                  <label style="display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #374151;">Custom Instructions (optional)</label>
                  <textarea id="ai-custom-prompt" rows="3" style="width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; resize: none; font-family: inherit; font-size: 14px;" placeholder="e.g. 'focus on my experience at company x...'"></textarea>
                </div>
                <div style="margin-bottom: 24px;">
                  <label style="display: block; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #374151;">Tone</label>
                  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 8px; font-weight: 500;">
                    <span>Casual</span>
                    <span>Normal</span>
                    <span>Formal</span>
                  </div>
                  <input type="range" id="ai-tone-slider" min="1" max="3" value="2" style="width: 100%; accent-color: #fec111; cursor: pointer;">
                </div>
                <div style="margin-bottom: 20px;">
                  <label style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #374151;">
                    <span>Character Limit</span>
                    <span id="char-limit-val" style="color: #6b7280; font-weight: 400;">No limit</span>
                  </label>
                  <input type="range" id="ai-char-limit" min="0" max="2000" step="50" value="0" style="width: 100%; accent-color: #fec111; cursor: pointer;">
                </div>
                <div style="margin-bottom: 24px;">
                  <label style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; font-weight: 500; color: #374151;">
                    <span>Word Count Limit</span>
                    <span id="word-limit-val" style="color: #6b7280; font-weight: 400;">No limit</span>
                  </label>
                  <input type="range" id="ai-word-limit" min="0" max="500" step="10" value="0" style="width: 100%; accent-color: #fec111; cursor: pointer;">
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 12px;">
                  <button id="ai-modal-cancel" style="padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; color: #374151; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.15s;">Cancel</button>
                  <button id="ai-modal-submit" style="padding: 8px 16px; border: none; background: #fec111; color: #111827; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: opacity 0.15s;">Generate</button>
                </div>
              `;

              overlay.appendChild(modal);
              document.body.appendChild(overlay);

              const btnCancel = document.getElementById('ai-modal-cancel');
              const btnSubmit = document.getElementById('ai-modal-submit');
              const inputCustom = document.getElementById('ai-custom-prompt');

              btnCancel.onmouseover = () => btnCancel.style.background = '#f9fafb';
              btnCancel.onmouseout = () => btnCancel.style.background = '#fff';
              
              btnSubmit.onmouseover = () => btnSubmit.style.opacity = '0.9';
              btnSubmit.onmouseout = () => btnSubmit.style.opacity = '1';

              setTimeout(() => inputCustom.focus(), 50);

              const charSlider = document.getElementById('ai-char-limit');
              const charVal = document.getElementById('char-limit-val');
              charSlider.addEventListener('input', (e) => {
                charVal.textContent = e.target.value === '0' ? 'No limit' : e.target.value;
              });

              const wordSlider = document.getElementById('ai-word-limit');
              const wordVal = document.getElementById('word-limit-val');
              wordSlider.addEventListener('input', (e) => {
                wordVal.textContent = e.target.value === '0' ? 'No limit' : e.target.value;
              });

              btnCancel.onclick = () => {
                document.body.removeChild(overlay);
                resolve(null);
              };

              btnSubmit.onclick = () => {
                const text = inputCustom.value;
                const toneVal = document.getElementById('ai-tone-slider').value;
                let tone = 'normal';
                if (toneVal === '1') tone = 'casual';
                if (toneVal === '3') tone = 'formal';
                const charLimit = parseInt(document.getElementById('ai-char-limit').value, 10);
                const wordLimit = parseInt(document.getElementById('ai-word-limit').value, 10);
                document.body.removeChild(overlay);
                resolve({ text, tone, charLimit, wordLimit });
              };
            });
          }
        });

        const res = results[0]?.result;
        if (!res) return; // User cancelled
        
        customDirections = res.text?.trim() || null;
        tonePreference = res.tone;
        charLimitPref = res.charLimit || 0;
        wordLimitPref = res.wordLimit || 0;
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

  const defaultSystemInstruction = `You are Stephen Skalamera filling out a job application. Answer in first person using only facts from the supplied resume and job description. Output only the answer text, ready to paste. No preamble, no labels, no quotation marks, no markdown headings.

GROUNDING RULES
- Every concrete claim must come from the supplied resume. Prefer one quantified proof over vague strengths.
- Tie the answer to something specific from the job description when one is provided (tooling, domain, team shape, metric they care about).
- Stephen has options; he is choosing this role for concrete reasons, not asking to be considered.
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
    toneInstruction = "\nWrite the response in a conversational, casual, and friendly tone while remaining professional.";
  } else if (tonePreference === 'formal') {
    toneInstruction = "\nWrite the response in a highly formal, polished, and structured professional tone.";
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
    ? `\n\nAdditional instructions from Stephen for this specific question:\n${customDirections || ""}${toneInstruction}${lengthInstruction}`
    : "";

  const userPrompt = `Here is Stephen's resume:\n\n${resumeText}${jdSection}\n---\n\nJob application question:\n${question}${directionsSection}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }]
      })
    }
  );

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
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );

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
  const systemInstruction = `You generate ATS-optimized, tailored CVs. Given a resume and job description, return a JSON object with the CV content customized for the specific role.

  TAILORING RULES:
  - IMPORTANT: ALWAYS write the CV summary IN THE FIRST PERSON IMPLIED ("Spearheaded the launch of..." not "Stephen spearheaded...").
  - NEVER refer to the applicant in the third person ("Stephen", "he", "his").
  - Rewrite the Professional Summary (2-4 sentences) to align with the JD's key requirements and vocabulary.
  - Never use bold or strong formatting in the summary.
  - Never use em dashes. Use commas, colons, semicolons, or separate sentences.
  - CRITICAL: ONLY tailor the Professional Summary text. ALL OTHER SECTIONS (Competencies, Experience, Projects, Education, Certifications, Skills) MUST REMAIN UNTOUCHED and identical to the original resume. Do not reword bullet points, do not change skills, do not change competencies. Just return the existing resume content for those sections verbatim.
  - STRICT PARSING: Ensure dates are correctly assigned to their respective items. Do not let degree dates accidentally bleed into the Skills section.
  
  Return ONLY valid JSON matching this structure:
  {
    "name": "string",
    "email": "string",
    "linkedin_url": "string",
    "linkedin_display": "string",
    "location": "string",
    "job_title": "string (the job title from JD)",
    "company_name": "string (the company name from JD)",
    "summary": "string",
    "competencies": ["string"],
    "experience": [{"company":"string","period":"string","role":"string","location":"string","bullets":["string"]}],
    "projects": [{"title":"string","role":"string","bullets":["string"]}],
    "education": [{"org":"string","year":"string","major":"string","degree":"string"}],
    "certifications": [{"title":"string","org":"string","year":"string"}],
    "skills": [{"category":"string","items":"string"}]
  }`;

  return callGeminiJson(apiKey, systemInstruction,
    `Resume:\n\n${resumeText}\n\nJob Description:\n\n${jobDescription}`);
}

async function generateCoverJson(apiKey, jobDescription, resumeText) {
  const systemInstruction = `You generate tailored cover letters. Given a resume and job description, return a JSON object with cover letter content.

WRITING RULES:
- IMPORTANT: ALWAYS write the cover letter IN THE FIRST PERSON ("I", "my", "me"). 
- NEVER refer to the applicant in the third person ("Stephen", "he", "his").
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
- Final paragraph: brief, forward-looking, express interest in a conversation.
- After the final paragraph, add ONE MORE separate paragraph containing exactly and only: "Thank you for considering my application. My portfolio can be found at <a href=\"https://bit.ly/skalamera-portfolio\">skalamera.me</a>."

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

function generateFlatCvText(d) {
  const lines = [];
  lines.push(d.name);
  lines.push(`${d.email} | ${d.linkedin_url} | skalamera.me | ${d.location}`);
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

function buildCvHtml(d) {
  const competencies = d.competencies.map(c =>
    `        <li>${esc(c)}</li>`
  ).join("\n");

  const experience = `    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">Sigma</span>
        <span class="job-period">September 2025 - Present</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">Technical Support Engineering Manager</span>
        <span class="job-location">New York, NY, USA</span>
      </div>
      <ul>
        <li>Lead the New York-based Technical Support Engineering team, managing hiring, onboarding, and performance, sustaining a 4.84/5 CSAT across enterprise customers.</li>
        <li>Serve as a player-coach by providing hands-on support for complex technical issues and integrations via live chat, email, and Slack, while maintaining a 23-second average first response time and coaching the team on best practices.</li>
        <li>Developed workforce models and a Python-based ML forecasting app that reduced planned headcount additions by 2 FTE through accurate ticket volume prediction.</li>
        <li>Direct real-time queue health and staffing strategy, building operational dashboards and playbooks that stabilized backlog and maintained a 1.1-hour average resolution time.</li>
        <li>Act as escalation lead for SEV-0/SEV-1 incidents, coordinating with Engineering, Product, and Customer Success to triage issues quickly and deliver clear, timely updates and post-incident summaries to stakeholders</li>
        <li>Design and iterate support processes, runbooks, and AI-/data-powered tooling to reduce manual work, increase TSE productivity, and scale consistent best practices across regions.</li>
      </ul>
    </div>

    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">Benchmark Education Company</span>
        <span class="job-period">March 2022 - August 2025</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">Lead, Customer Technical Support & Support Operations</span>
        <span class="job-location">New Rochelle, NY, USA</span>
      </div>
      <ul>
        <li>Led a hybrid team of 15 support agents plus a 5-person offshore vendor team, consistently exceeding KPIs and SLAs while reporting to the Director of Technology.</li>
        <li>Automated workflows and API integrations (Freshdesk, Zendesk, RingCentral, etc.), reducing resolution time by 38% and improving first response time by 45% and average handling time by 32%, while maintaining CSAT above 98% annually.</li>
        <li>Drove the design and launch of an in-house ticketing application and AI-powered performance review platform, achieving department-wide adoption and meaningful cost savings.</li>
        <li>Built a Power BI Support Operations Hub with Python integrations and real-time call queue monitoring (RingCentral API + Freshdesk) to centralize metrics and support data-driven decisions.</li>
        <li>Led cross-functional customer journey mapping and backlog prioritization, translating support insights into product improvements and better alignment across Product, Engineering, and Customer Success.</li>
      </ul>
    </div>

    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">BuildingLink</span>
        <span class="job-period">October 2019 - March 2022</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">Technical Support & Training</span>
        <span class="job-location">New York, NY, USA</span>
      </div>
      <ul>
        <li>Hosted on-site and remote training sessions on our platform to property management companies across the country.</li>
        <li>Translated user feedback and insights into actionable bug reports and feature requests for development teams.</li>
        <li>Managed a team in adopting a new support ticketing system (Freshdesk).</li>
        <li>Assisted with the redesign of the company's help site for enhanced user-friendliness, modernity, and robustness.</li>
      </ul>
    </div>

    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">1010data</span>
        <span class="job-period">April 2016 - August 2019</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">Customer Experience/Technical Support Lead</span>
        <span class="job-location">New York, NY, USA</span>
      </div>
      <ul>
        <li>Monitored, reviewed, and delivered Customer Experience staff’s KPIs weekly to upper management, including spot checking support tickets.</li>
        <li>Managed the interviewing, hiring, training, and expansion of the Customer Experience Team as one of the initial team members and a team leader.</li>
        <li>Managed all customer inquiries, and interactions on platform, excelling in conflict resolution to ensure positive customer outcomes.</li>
        <li>Constructed the Knowledge Base from the ground up within Confluence, creating a comprehensive resource for customer support.</li>
      </ul>
    </div>

    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">Lytx</span>
        <span class="job-period">July 2014 - April 2016</span>
      </div>
      <div class="job-subheader">
        <span class="job-role">Senior Technical Support Engineer - Tier 3</span>
        <span class="job-location">San Diego, CA, USA</span>
      </div>
      <ul>
        <li>Elevated and managed Tech Support incidents as the main point of escalation for the Tier 3 Tech Support team, ensuring prompt resolution for customers.</li>
        <li>Confirmed and documented technical issues, delivering rapid and effective technical solutions.</li>
        <li>Utilized basic SQL query language to troubleshoot and query large databases.</li>
        <li>Interfaced with infrastructure, databases, QA, and development teams as required to address customer issues.</li>
      </ul>
    </div>`;

  const projects = `    <div class="project avoid-break">
      <div class="project-title">Jedana AI - Intelligent Support Analytics - Link to Project</div>
      <div class="project-role">Founder & Developer | Present</div>
      <ul>
        <li>Jedana is my spare-time project: a suite of AI-powered tools for support operations. It focuses on support analytics, agent/team performance, and customer health, enabling Support leaders to:</li>
        <li>Automate ticket quality assurance for better agent coaching. AI analyzes interactions, provides detailed insights, and offers skill assessments with customizable AI-suggested ratings.</li>
        <li>View real-time sentiment analysis and KPIs to track customer satisfaction, with AI-generated recommendations for CX improvement.</li>
        <li>Create custom weighted metrics to analyze, normalize, and rank agent performance across channels, providing detailed AI-generated performance reviews.</li>
      </ul>
    </div>`;

  const education = `    <div class="edu-item avoid-break">
      <div class="edu-header">
        <span class="edu-org">University of Maryland - Baltimore County</span>
        <span class="edu-year"></span>
      </div>
      <div class="edu-desc"><em>Bachelor's</em>, Economics</div>
    </div>`;

  const awards = `      <li>Gold Stevie® Award Winner in 2025 American Business Awards®</li>`;

  const certifications = `    <div style="font-weight: bold; font-size: 11px;">Anthropic AI Education & Certifications <span style="font-weight: normal;">| Anthropic | 2026</span></div>
    <ul>
      <li><strong>AI Fluency & Frameworks:</strong> Teaching AI Fluency, AI Fluency (Students, Educators, Framework & Foundations)</li>
      <li><strong>Technical & Developer Skills:</strong> Building with Claude API, Model Context Protocol (Intro & Adv), Claude Code (101 & In Action), Agent Skills, Subagents, Claude Cowork</li>
      <li><strong>Model Strategy & Safety:</strong> Claude 101, Claude with Google Cloud Vertex AI & Amazon Bedrock, AI Capabilities and Limitations</li>
    </ul>
    <div style="font-weight: bold; font-size: 11px; margin-top: 2px;">Microsoft Career Essentials <span style="font-weight: normal;">| Microsoft | 2023 \u2013 2025</span></div>
    <ul>
      <li>Generative AI, Data Analysis, and Project Management</li>
    </ul>
    <div style="font-weight: bold; font-size: 11px; margin-top: 2px;">Support Platform Expertise <span style="font-weight: normal;">| Various Issuers | 2024 \u2013 2025</span></div>
    <ul>
      <li><strong>Zendesk:</strong> Customer Service Professional Certificate</li>
      <li><strong>Freshworks:</strong> Freshdesk Product Expert</li>
    </ul>
    <div style="font-weight: bold; font-size: 11px; margin-top: 2px;">Academic & Executive AI <span style="font-weight: normal;">| Various Issuers | 2025 \u2013 2026</span></div>
    <ul>
      <li><strong>Harvard University:</strong> CS50x - Computer Science for AI</li>
      <li><strong>Babson College:</strong> MIS01x: AI for Leaders</li>
    </ul>`;

  const skills = `      <li><strong>Leadership:</strong> Team Leadership, Hybrid/Remote Team Management, Global Support Operations, Cross-Functional Collaboration, Coaching & Mentoring, Conflict Resolution, Stakeholder Management</li>
      <li><strong>AI:</strong> Cursor, Gemini, ChatGPT, Prompt Engineering, Prompt Evaluation, Pinecone, Langfuse, LLM, Fin (Intercom), Glean, Model Context Protocol (MCP), Opencode, Claude API, Claude, Claude Cowork, Claude Code, Codex, Agentic AI Workflow</li>
      <li><strong>Technical & Tools:</strong> REST API's, Freshdesk, Zendesk, RingCentral, Jira, Sigma, Salesforce, NetSuite, Confluence, Power BI, Tableau, BigQuery, Redshift, Azure, Snowflake, Excel, Python, HTML/CSS, JavaScript, SQL, Process Automation Design, Google Cloud Platform, Zapier, Vercel, Supabase, React, Docker, Databricks</li>
      <li><strong>Support & Operations:</strong> Technical Support Engineering, Customer Experience Analytics, Customer Journey Mapping, Escalation Management, Incident Management, Performance Management, Process Improvement, Knowledge Management</li>`;

  const docTitle = d.job_title && d.company_name 
    ? `${d.job_title} - ${d.company_name} - CV`
    : `${d.name} \u2014 CV`;

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
      <span class="separator">|</span>
      <a href="https://bit.ly/skalamera-portfolio" style="color: hsl(187, 74%, 32%);">skalamera.me</a>
      <span class="separator">|</span>
      <span>${esc(d.location)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${esc(d.summary)}</div>
  </div>

  <div class="section">
    <div class="section-title">Skills</div>
    <ul>
${skills}
    </ul>
  </div>

  <div class="section">
    <div class="section-title">Professional Experience</div>
${experience}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Projects</div>
${projects}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Certifications</div>
${certifications}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Education</div>
${education}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Awards</div>
    <ul>
${awards}
    </ul>
  </div>

</div>
</body>
</html>`;
}

function buildCoverHtml(d, resumeText) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const paragraphs = d.paragraphs.map(p => {
    let escaped = esc(p);
    escaped = escaped.replace(/&lt;a href=&quot;https:\/\/bit\.ly\/skalamera-portfolio&quot;&gt;skalamera\.me&lt;\/a&gt;/g, '<a href="https://bit.ly/skalamera-portfolio">skalamera.me</a>');
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
      <span class="separator">|</span>
      <a href="https://bit.ly/skalamera-portfolio" style="color: hsl(187, 74%, 32%);">skalamera.me</a>
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
      return await handleGetProfile();

    case 'GET_RESUME_FILE':
      return await handleGetResumeFile();

    case 'PARSE_PDF':
      return await handleParsePdf(message.payload);

    case 'TEST_API_KEY':
      return await handleTestApiKey(message.payload);

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
  const apiKey = await Storage.getApiKey();
  if (!apiKey) throw new Error('Gemini API key not set');

  // Save raw text
  await Storage.saveResumeText(resumeText);

  // Analyze with Gemini
  const structured = await Gemini.analyzeResume(apiKey, resumeText);
  await Storage.saveStructuredResume(structured);

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
    linkedinUrl: structured.linkedinUrl || profile.linkedinUrl || '',
    githubUrl: structured.githubUrl || profile.githubUrl || '',
    portfolioUrl: structured.portfolioUrl || profile.portfolioUrl || '',
    yearsOfExperience: structured.yearsOfExperience || profile.yearsOfExperience || 0
  };
  await Storage.saveProfile(merged);

  return { structured, profile: merged };
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
  try {
    const data = await chrome.storage.local.get({ clips: [], activeClipIdx: null });
    if (data.activeClipIdx !== null && data.clips[data.activeClipIdx]) {
      jobDescription = data.clips[data.activeClipIdx].text;
    }
  } catch (e) {
    console.error("Failed to load active clip for autofill", e);
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
    let aiAnswers = await Gemini.answerFields(apiKey, aiFields, resumeText, profileForAi, jobDescription, customInstructions);
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
  
  const coverLetter = await Gemini.generateCoverLetter(apiKey, resumeText, jobDescription, companyName, roleTitle);
  return { coverLetter };
}

async function handleGetProfile() {
  const profile = await Storage.getProfile();
  const resumeText = await Storage.getResumeText();
  const structured = await Storage.getStructuredResume();
  const hasApiKey = !!(await Storage.getApiKey());
  const hasResume = !!resumeText;
  return { profile, resumeText, structured, hasApiKey, hasResume };
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

async function handleClearResume() {
  await Storage.remove('resumeText');
  await Storage.remove('resumeFile');
  await Storage.remove('structuredResume');
  return { success: true };
}

