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
  const data = await chrome.storage.local.get(['geminiApiKey', 'clydeProToken', 'masterResumeText', 'activeResumeText', 'profile', 'customQA', 'enableAdversarialPdfCanary']);

  if (data.geminiApiKey) {
    apiKeyInput.placeholder = '••••••••••••••••';
    setStatus(keyStatus, 'API key saved', 'success');
  }

  // Clyde Pro Token elements
  const proTokenInput = document.getElementById('pro-token');
  const saveProBtn = document.getElementById('save-pro-btn');
  const testProBtn = document.getElementById('test-pro-btn');
  const proStatus = document.getElementById('pro-status');

  if (data.clydeProToken) {
    proTokenInput.placeholder = '••••••••••••••••';
    setStatus(proStatus, 'Pro Token saved', 'success');
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

  // Clyde Pro Token handlers
  if (saveProBtn) {
    saveProBtn.addEventListener('click', async () => {
      const token = proTokenInput.value.trim();
      if (!token) return;
      await chrome.storage.local.set({ clydeProToken: token });
      proTokenInput.value = '';
      proTokenInput.placeholder = '••••••••••••••••';
      setStatus(proStatus, 'Pro Token saved', 'success');
    });
  }

  if (testProBtn) {
    testProBtn.addEventListener('click', async () => {
      setStatus(proStatus, 'Testing token...', 'loading');
      const tokenToTest = proTokenInput.value.trim() || (await chrome.storage.local.get('clydeProToken')).clydeProToken;
      if (!tokenToTest) {
        setStatus(proStatus, 'Please enter a token first', 'error');
        return;
      }
      const result = await chrome.runtime.sendMessage({
        type: 'TEST_PRO_TOKEN',
        payload: { token: tokenToTest }
      });
      if (result.success) {
        setStatus(proStatus, 'Token is active! Unlocked Clyde Pro.', 'success');
      } else {
        setStatus(proStatus, `Failed: ${result.error}`, 'error');
      }
    });
  }

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

      console.log('[Options UI Log] Sending ANALYZE_RESUME to background service worker...');
      const analysis = await chrome.runtime.sendMessage({
        type: 'ANALYZE_RESUME',
        payload: { resumeText: parseResult.text }
      });
      console.log('[Options UI Log] ANALYZE_RESUME response received:', analysis);
      if (analysis.error) {
        console.error('[Options UI Log] Background reported error during analysis:', analysis.error);
        throw new Error(analysis.error);
      }

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
    const content = "CLYDE EXPORT\n" + "\u2550".repeat(60) + "\n\n" + lines.join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clyde-export-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnClearClips.addEventListener('click', async () => {
    if (!confirm("Are you sure you want to permanently clear all saved JD clips and tracking data?")) return;
    await chrome.storage.local.set({ clips: [], activeClipIdx: null });
    alert("All JD clips have been cleared.");
  });

  // -----------------------------------------------------------------------
  // Clyde Desktop Integration
  // -----------------------------------------------------------------------

  const clydeHostInput = document.getElementById('clyde-host');
  const clydePortInput = document.getElementById('clyde-port');
  const clydeAutoSync = document.getElementById('clyde-auto-sync');
  const clydePullResume = document.getElementById('clyde-pull-resume');
  const clydeTestBtn = document.getElementById('clyde-test-btn');
  const clydeSyncAllBtn = document.getElementById('clyde-sync-all-btn');
  const clydeStatusBadge = document.getElementById('clyde-status-badge');
  const clydeStatus = document.getElementById('clyde-status');

  function setClydeStatus(text, className) {
    clydeStatus.textContent = text;
    clydeStatus.className = 'status ' + (className || '');
  }

  function setClydeBadge(text, connected) {
    clydeStatusBadge.textContent = text;
    clydeStatusBadge.style.background = connected ? '#dcfce7' : '#fee2e2';
    clydeStatusBadge.style.color = connected ? '#16a34a' : '#dc2626';
  }

  // Load Clyde settings
  const clydeData = await chrome.storage.local.get([
    'clydeHost', 'clydePort', 'clydeAutoSync', 'clydePullResume'
  ]);

  if (clydeData.clydeHost) clydeHostInput.value = clydeData.clydeHost;
  if (clydeData.clydePort) clydePortInput.value = clydeData.clydePort;
  if (clydeData.clydeAutoSync) clydeAutoSync.checked = true;
  if (clydeData.clydePullResume) clydePullResume.checked = true;

  // Poll connection status
  async function checkClydeConnection() {
    try {
      const clydeClient = await loadClydeClient();
      const result = await clydeClient.isAvailable({
        host: clydeHostInput.value,
        port: parseInt(clydePortInput.value) || 4593
      });
      if (result.available) {
        setClydeBadge(`Connected ${'\u{1F7E2}'}`, true);
        return true;
      } else {
        setClydeBadge(`Disconnected ${'\u{1F534}'}`, false);
        return false;
      }
    } catch (_) {
      setClydeBadge('Disconnected \u{1F534}', false);
      return false;
    }
  }

  // Initial connection check
  checkClydeConnection();

  // Test connection button
  clydeTestBtn.addEventListener('click', async () => {
    setClydeStatus('Testing connection...', 'loading');
    try {
      const clydeClient = await loadClydeClient();
      const result = await clydeClient.isAvailable({
        host: clydeHostInput.value,
        port: parseInt(clydePortInput.value) || 4593
      });
      if (result.available) {
        setClydeStatus(`Connected! Clyde v${result.version || 'unknown'}`, 'success');
        setClydeBadge(`Connected ${'\u{1F7E2}'}`, true);
      } else {
        setClydeStatus('Could not connect to Clyde', 'error');
        setClydeBadge('Disconnected \u{1F534}', false);
      }
    } catch (e) {
      setClydeStatus(`Connection failed: ${e.message}`, 'error');
      setClydeBadge('Disconnected \u{1F534}', false);
    }
  });

  // Sync all clips button
  clydeSyncAllBtn.addEventListener('click', async () => {
    const { clips = [] } = await chrome.storage.local.get({ clips: [] });
    if (!clips.length) {
      setClydeStatus('No clips to sync', 'error');
      return;
    }

    setClydeStatus(`Syncing ${clips.length} clip(s)...`, 'loading');
    clydeSyncAllBtn.disabled = true;
    clydeSyncAllBtn.textContent = 'Syncing...';

    let synced = 0;
    let failed = 0;

    try {
      const clydeClient = await loadClydeClient();
      const opts = {
        host: clydeHostInput.value,
        port: parseInt(clydePortInput.value) || 4593
      };

      for (const clip of clips) {
        try {
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
          synced++;
        } catch (e) {
          console.error('[Clyde] Sync failed for clip:', clip.id, e.message);
          failed++;
        }
      }

      setClydeStatus(
        `Done: ${synced} synced, ${failed} failed`,
        failed === 0 ? 'success' : 'error'
      );
    } catch (e) {
      setClydeStatus(`Sync failed: ${e.message}`, 'error');
    } finally {
      clydeSyncAllBtn.disabled = false;
      clydeSyncAllBtn.textContent = 'Sync All Clips';
    }
  });

  // Helper: load the clyde-client module dynamically
  async function loadClydeClient() {
    return window.ClydeClient || window.__clydeClient;
  }

  // Extend save handler to persist Clyde settings
  const originalSaveHandler = saveBtn._listeners ? saveBtn._listeners[0] : null;
  const existingClick = saveBtn.click;
  // Don't override existing — append to save function
  const origSave = saveBtn._listenerOriginal || (() => {
    // Trigger the original save logic. We need to grab the original listener.
    // Since we can't easily inspect, we'll add our save alongside it.
  });

  // Instead: patch the save to also persist Clyde settings
  // We can't easily intercept the existing handler, so we monkey-patch
  // chrome.storage.local.set within the context of save.
  // Better approach: add a separate click handler that wraps storage.set

  // Since saveBtn's existing handler already does chrome.storage.local.set,
  // we add our persistence as a post-save step via a MutationObserver hack.
  // Simplest: just add Clyde-specific save that runs alongside.
  // We'll listen to the saveBtn click and add our data after a small delay.

  saveBtn.addEventListener('click', async () => {
    // Wait a tick for the original handler
    await new Promise(r => setTimeout(r, 50));

    await chrome.storage.local.set({
      clydeHost: clydeHostInput.value.trim(),
      clydePort: parseInt(clydePortInput.value) || 4593,
      clydeAutoSync: clydeAutoSync.checked,
      clydePullResume: clydePullResume.checked
    });
  });

  // -----------------------------------------------------------------------
  // Clyde Widget Visibility & Blocking Settings
  // -----------------------------------------------------------------------
  const badgeDisabledGloballyInput = document.getElementById('badge-disabled-globally');
  const blockedDomainsList = document.getElementById('blocked-domains-list');

  // Load initial visibility settings
  const visibilityData = await chrome.storage.local.get(['badgeDisabledGlobally', 'disabledDomains']);
  
  if (badgeDisabledGloballyInput) {
    badgeDisabledGloballyInput.checked = visibilityData.badgeDisabledGlobally || false;
  }

  function renderBlockedDomains(domains) {
    if (!blockedDomainsList) return;
    blockedDomainsList.innerHTML = '';
    
    if (!domains || domains.length === 0) {
      blockedDomainsList.innerHTML = '<span style="color: #64748b; font-style: italic; font-size: 13px;">No domains currently disabled.</span>';
      return;
    }

    domains.forEach(domain => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);';
      
      const text = document.createElement('span');
      text.textContent = domain;
      text.style.cssText = 'color: #e2e8f0; font-size: 13px; font-weight: 500;';
      
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Enable';
      removeBtn.className = 'secondary';
      removeBtn.style.cssText = 'padding: 4px 10px !important; font-size: 11px !important; border-radius: 4px !important;';
      
      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const settings = await chrome.storage.local.get('disabledDomains');
        const list = settings.disabledDomains || [];
        const index = list.indexOf(domain);
        if (index > -1) {
          list.splice(index, 1);
          await chrome.storage.local.set({ disabledDomains: list });
          renderBlockedDomains(list);
        }
      });

      row.appendChild(text);
      row.appendChild(removeBtn);
      blockedDomainsList.appendChild(row);
    });
  }

  renderBlockedDomains(visibilityData.disabledDomains || []);

  // Save visibility settings when clicking "Save All Settings"
  saveBtn.addEventListener('click', async () => {
    // Wait a tick for the original handler
    await new Promise(r => setTimeout(r, 60));
    if (badgeDisabledGloballyInput) {
      await chrome.storage.local.set({
        badgeDisabledGlobally: badgeDisabledGloballyInput.checked
      });
    }
  });

  // Pull Master Resume from Clyde on startup if enabled
  if (clydeData.clydePullResume) {
    try {
      const clydeClient = await loadClydeClient();
      const opts = {
        host: clydeHostInput.value,
        port: parseInt(clydePortInput.value) || 4593
      };
      const settings = await clydeClient.getSettings(opts);
      if (settings && settings.resumeText) {
        await chrome.storage.local.set({ masterResumeText: settings.resumeText });
        resumeTextArea.value = settings.resumeText;
        uploadArea.classList.add('has-file');
        uploadText.textContent = 'Synced from Clyde';
        clearResumeBtn.classList.remove('hidden');
        console.log('[Clyde] Master resume pulled from Clyde');
      }
    } catch (e) {
      console.warn('[Clyde] Failed to pull master resume:', e.message);
    }
  }

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

  // -----------------------------------------------------------------------
  // Tab Switching Logic
  // -----------------------------------------------------------------------
  const tabs = document.querySelectorAll('.settings-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all tabs
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));

      // Activate selected tab
      tab.classList.add('active');
      const targetContent = document.getElementById(`tab-${tab.dataset.tab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
});
