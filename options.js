document.addEventListener('DOMContentLoaded', async () => {
  const saveKeyBtn = document.getElementById('save-key-btn');
  const testKeyBtn = document.getElementById('test-key-btn');
  const apiKeyInput = document.getElementById('api-key');
  const keyStatus = document.getElementById('key-status');
  const uploadArea = document.getElementById('upload-area');
  const resumeInput = document.getElementById('resume-input');
  const uploadText = document.getElementById('upload-text');
  const resumeStatus = document.getElementById('resume-status');
  const clearResumeBtn = document.getElementById('clear-resume-btn');
  const clearActiveResumeBtn = document.getElementById('clear-active-resume-btn');
  const auditResumeBtn = document.getElementById('audit-resume-btn');
  const auditStatus = document.getElementById('audit-status');
  const auditResults = document.getElementById('audit-results');
  const resumeTextArea = document.getElementById('resume-text');
  const activeResumeTextArea = document.getElementById('active-resume-text');
  const qaList = document.getElementById('qa-list');
  const addQaBtn = document.getElementById('add-qa-btn');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const btnExportClips = document.getElementById('btn-export-clips');
  const btnClearClips = document.getElementById('btn-clear-clips');
  const enablePdfCanary = document.getElementById('enable-pdf-canary');

  // Load existing data
  const data = await chrome.storage.local.get(['geminiApiKey', 'masterResumeText', 'activeResumeText', 'profile', 'customQA', 'enableAdversarialPdfCanary']);

  if (data.geminiApiKey) {
    apiKeyInput.placeholder = '••••••••••••••••';
    setStatus(keyStatus, 'API key saved', 'success');
  }

  if (data.masterResumeText) {
    uploadArea.classList.add('has-file');
    uploadText.textContent = 'Master Resume uploaded';
    resumeTextArea.value = data.masterResumeText || '';
    clearResumeBtn.classList.remove('hidden');
  }

  if (data.activeResumeText) {
    activeResumeTextArea.value = data.activeResumeText || '';
    clearActiveResumeBtn.classList.remove('hidden');
  }

  // Populate profile fields
  if (data.profile) {
    populateProfile(data.profile);
  }

  // Load custom Q&A
  const customQA = data.customQA || [];
  customQA.forEach(qa => addQaPair(qa.question, qa.answer));

  if (enablePdfCanary) {
    enablePdfCanary.checked = data.enableAdversarialPdfCanary === true;
  }

  // API Key handlers
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    await chrome.storage.local.set({ geminiApiKey: key });
    apiKeyInput.value = '';
    apiKeyInput.placeholder = '••••••••••••••••';
    setStatus(keyStatus, 'API key saved', 'success');
  });

  testKeyBtn.addEventListener('click', async () => {
    setStatus(keyStatus, 'Testing...', 'loading');
    const result = await chrome.runtime.sendMessage({
      type: 'TEST_API_KEY',
      payload: { apiKey: apiKeyInput.value.trim() || (await chrome.storage.local.get('geminiApiKey')).geminiApiKey }
    });
    if (result.success) {
      setStatus(keyStatus, 'Connection successful', 'success');
    } else {
      setStatus(keyStatus, `Failed: ${result.error}`, 'error');
    }
  });

  // Resume upload
  uploadArea.addEventListener('click', () => resumeInput.click());

  resumeInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      setStatus(resumeStatus, 'Please upload a PDF file', 'error');
      return;
    }

    uploadText.textContent = 'Parsing...';
    setStatus(resumeStatus, 'Extracting text...', 'loading');

    try {
      const base64Data = await fileToBase64(file);
      const parseResult = await chrome.runtime.sendMessage({
        type: 'PARSE_PDF',
        payload: { base64Data, fileName: file.name }
      });
      if (parseResult.error) throw new Error(parseResult.error);

      resumeTextArea.value = parseResult.text;
      setStatus(resumeStatus, 'Analyzing with AI...', 'loading');

      const analysis = await chrome.runtime.sendMessage({
        type: 'ANALYZE_RESUME',
        payload: { resumeText: parseResult.text }
      });
      if (analysis.error) throw new Error(analysis.error);

      uploadArea.classList.add('has-file');
      uploadText.textContent = file.name;
      setStatus(resumeStatus, 'Master Resume analyzed', 'success');
      clearResumeBtn.classList.remove('hidden');

      if (analysis.profile) {
        populateProfile(analysis.profile);
      }
    } catch (e) {
      uploadText.textContent = 'Click to upload master resume (PDF)';
      setStatus(resumeStatus, `Error: ${e.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  });

  // Clear Resume button
  clearResumeBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_RESUME' });
    uploadArea.classList.remove('has-file');
    uploadText.textContent = 'Click to upload master resume (PDF)';
    setStatus(resumeStatus, '', '');
    resumeTextArea.value = '';
    clearResumeBtn.classList.add('hidden');
  });

  clearActiveResumeBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('activeResumeText');
    activeResumeTextArea.value = '';
    clearActiveResumeBtn.classList.add('hidden');
  });

  // Audit Resume
  auditResumeBtn.addEventListener('click', async () => {
    const text = resumeTextArea.value.trim();
    if (!text) {
      setStatus(auditStatus, 'No resume text to audit', 'error');
      return;
    }
    
    setStatus(auditStatus, 'Auditing resume...', 'loading');
    auditBtnDisabled(true);
    auditResults.classList.add('hidden');
    
    try {
      const apiKey = await chrome.storage.local.get('geminiApiKey');
      if (!apiKey.geminiApiKey) throw new Error('API key not set');
      
      const result = await chrome.runtime.sendMessage({
        type: 'AUDIT_RESUME',
        payload: { resumeText: text }
      });
      
      if (result.error) throw new Error(result.error);
      
      setStatus(auditStatus, '', '');
      auditResults.textContent = result.audit;
      auditResults.classList.remove('hidden');
    } catch (e) {
      setStatus(auditStatus, `Error: ${e.message}`, 'error');
    } finally {
      auditBtnDisabled(false);
    }
  });
  
  function auditBtnDisabled(disabled) {
    auditResumeBtn.disabled = disabled;
    if (disabled) auditResumeBtn.style.opacity = '0.5';
    else auditResumeBtn.style.opacity = '1';
  }

  // Q&A management
  addQaBtn.addEventListener('click', () => addQaPair('', ''));

  // Save all
  saveBtn.addEventListener('click', async () => {
    setStatus(saveStatus, 'Saving...', 'loading');

    try {
      // Collect profile from form
      const profile = collectProfile();
      await chrome.storage.local.set({ profile });

      // Save resume text if edited
      const editedText = resumeTextArea.value.trim();
      if (editedText) {
        await chrome.storage.local.set({ masterResumeText: editedText });
      }

      // Save custom Q&A
      const qaData = collectQA();
      await chrome.storage.local.set({ customQA: qaData });

      if (enablePdfCanary) {
        await chrome.storage.local.set({ enableAdversarialPdfCanary: enablePdfCanary.checked === true });
      }

      setStatus(saveStatus, 'All settings saved!', 'success');
      setTimeout(() => setStatus(saveStatus, '', ''), 3000);
    } catch (e) {
      setStatus(saveStatus, `Error: ${e.message}`, 'error');
    }
  });

  // Data Management (Clips)
  btnExportClips.addEventListener('click', async () => {
    const data = await chrome.storage.local.get({ clips: [] });
    const allClips = data.clips;
    if (!allClips.length) {
      alert("No clips to export.");
      return;
    }
    const lines = allClips.map((clip, i) => {
      const divider = "\u2500".repeat(60);
      const dateStr = new Date(clip.savedAt).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
      });
      return [
        `[${i + 1}] ${dateStr}`,
        `Title: ${clip.jobTitle || "Unknown"}`,
        `Company: ${clip.companyName || "Unknown"}`,
        `URL: ${clip.url || "Unknown"}`,
        "",
        clip.text,
        divider
      ].join("\n");
    });
    const content = "JAYOBEE EXPORT\n" + "\u2550".repeat(60) + "\n\n" + lines.join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jayobee-export-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnClearClips.addEventListener('click', async () => {
    if (!confirm("Are you sure you want to permanently clear all saved JD clips and tracking data?")) return;
    await chrome.storage.local.set({ clips: [], activeClipIdx: null });
    alert("All JD clips have been cleared.");
  });

  // Helper functions
  function populateProfile(profile) {
    document.querySelectorAll('[data-profile]').forEach(el => {
      const key = el.getAttribute('data-profile');
      const value = getNestedValue(profile, key);
      if (value !== undefined && value !== null && value !== '') {
        el.value = String(value);
      }
    });
  }

  function collectProfile() {
    const profile = {};
    document.querySelectorAll('[data-profile]').forEach(el => {
      const key = el.getAttribute('data-profile');
      setNestedValue(profile, key, el.value);
    });
    profile.fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    return profile;
  }

  function getNestedValue(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }

  function addQaPair(question, answer) {
    const div = document.createElement('div');
    div.className = 'qa-pair';
    div.innerHTML = `
      <input type="text" class="qa-question" placeholder="Question keyword" value="${escapeHtml(question)}">
      <textarea class="qa-answer" rows="2" placeholder="Your answer">${escapeHtml(answer)}</textarea>
      <button class="danger qa-remove" style="padding: 10px 14px;">X</button>
    `;
    div.querySelector('.qa-remove').addEventListener('click', () => div.remove());
    qaList.appendChild(div);
  }

  function collectQA() {
    return Array.from(qaList.querySelectorAll('.qa-pair'))
      .map(div => ({
        question: div.querySelector('.qa-question').value.trim(),
        answer: div.querySelector('.qa-answer').value.trim()
      }))
      .filter(qa => qa.question && qa.answer);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setStatus(el, text, className) {
    el.textContent = text;
    el.className = `status ${className || ''}`;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
});
