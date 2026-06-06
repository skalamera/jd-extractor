// Main content script - UI overlay and orchestration

(function () {
  'use strict';

  let isRunning = false;
  let fab = null;
  let overlay = null;

  // Create floating action button
  function createFAB() {
    if (window !== window.top) return; // Only show FAB in top frame

    if (fab) return;

    fab = document.createElement('div');
    fab.id = 'job-autofill-fab';
    fab.innerHTML = `
      <div style="
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #1a73e8;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        z-index: 999999;
        font-size: 24px;
        font-weight: bold;
        transition: transform 0.2s, background 0.2s;
        user-select: none;
      " id="job-autofill-fab-btn" title="Auto-fill this application">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </div>
    `;
    document.body.appendChild(fab);

    const btn = document.getElementById('job-autofill-fab-btn');
    btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.1)');
    btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
    btn.addEventListener('click', () => startAutoFill());
  }

  let skipRequested = false;

  // Create status overlay
  function createOverlay() {
    if (window !== window.top) return; // Only show UI in the top frame

    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'job-autofill-overlay';
    overlay.innerHTML = `
      <div style="
        position: fixed;
        top: 16px;
        right: 16px;
        background: white;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 1000000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 14px !important;
        line-height: 1.5 !important;
        text-align: left !important;
        box-sizing: border-box !important;
        min-width: 280px !important;
        max-width: 360px !important;
        height: auto !important;
        transition: opacity 0.3s;
      " id="job-autofill-overlay-inner">
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #1a73e8;">
          Job AutoFill
        </div>
        <div id="job-autofill-status" style="color: #333;">
          Initializing...
        </div>
        <div id="job-autofill-progress" style="
          margin-top: 8px;
          height: 4px;
          background: #e0e0e0;
          border-radius: 2px;
          overflow: hidden;
        ">
          <div id="job-autofill-progress-bar" style="
            height: 100%;
            background: #1a73e8;
            width: 0%;
            transition: width 0.3s;
            border-radius: 2px;
          "></div>
        </div>
        <button id="job-autofill-skip-btn" style="margin-top: 12px; width: 100%; padding: 8px; background: #f97316; border: 1px solid #ea580c; border-radius: 4px; cursor: pointer; color: white; font-weight: 600; font-size: 13px; transition: background 0.2s; line-height: normal !important; display: none !important; box-sizing: border-box !important;">Skip Current Field</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const skipBtn = document.getElementById('job-autofill-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('mouseenter', () => skipBtn.style.background = '#ea580c');
      skipBtn.addEventListener('mouseleave', () => skipBtn.style.background = '#f97316');
      skipBtn.addEventListener('click', () => {
        skipRequested = true;
        skipBtn.textContent = 'Skipping...';
        setTimeout(() => { skipBtn.textContent = 'Skip Current Field'; }, 1000);
      });
    }
  }

  function updateStatus(text, progress) {
    if (window === window.top) {
      if (!overlay) createOverlay();
      const statusEl = document.getElementById('job-autofill-status');
      const progressBar = document.getElementById('job-autofill-progress-bar');
      if (statusEl) statusEl.textContent = text;
      if (progressBar && progress !== undefined) progressBar.style.width = `${progress}%`;
    }
    if (window !== window.top) {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_PROGRESS', text, progress });
      } catch (e) { }
    }
  }

  function showResult(filled, failedLabels, total) {
    if (window === window.top) {
      const skipBtn = document.getElementById('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'none';

      const statusEl = document.getElementById('job-autofill-status');
      const failedCount = failedLabels.length;

      let failedListHtml = '';
      if (failedCount > 0) {
        const uniqueFailed = [...new Set(failedLabels)];
        failedListHtml = `
          <div style="margin-top: 8px; max-height: 120px; overflow-y: auto; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 8px; font-size: 12px; line-height: 1.4 !important; color: #92400e; box-sizing: border-box !important;">
            <strong>Please double-check for accuracy and completeness (${failedCount}):</strong><br>
            ${uniqueFailed.map(label => `<div style="margin-top:2px;">• ${label}</div>`).join('')}
          </div>
        `;
      }

      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color: #34a853; font-weight: 600; line-height: 1.4 !important; display: block !important;">Autofill Complete</div>
          <div style="margin-top: 4px; color: #666; font-size: 13px; line-height: 1.4 !important; display: block !important;">
            Processed ${total} fields${failedCount > 0 ? ` (${failedCount} require verification)` : ''}
          </div>
          ${failedListHtml}
          <div style="margin-top: 6px; color: #888; font-size: 11px; font-style: italic; line-height: 1.4 !important; display: block !important;">
            We recommend a quick manual review of your application before submitting.
          </div>
          <button id="job-autofill-dismiss-btn" style="margin-top: 12px; width: 100%; padding: 8px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; color: #374151; font-weight: 600; font-size: 13px; transition: background 0.2s; line-height: normal !important; display: block !important;">Dismiss</button>
        `;

        const dismissBtn = document.getElementById('job-autofill-dismiss-btn');
        if (dismissBtn) {
          dismissBtn.addEventListener('mouseenter', () => dismissBtn.style.background = '#e5e7eb');
          dismissBtn.addEventListener('mouseleave', () => dismissBtn.style.background = '#f3f4f6');
          dismissBtn.addEventListener('click', () => {
            if (overlay) {
              overlay.style.opacity = '0';
              setTimeout(() => overlay?.remove(), 300);
              overlay = null;
            }
          });
        }
      }
      const progressBar = document.getElementById('job-autofill-progress-bar');
      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.style.background = failedCount > 0 ? '#fbbc04' : '#34a853';
      }

      // Auto-dismiss ONLY if there were no failures
      if (failedCount === 0) {
        setTimeout(() => {
          if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay?.remove(), 300);
            overlay = null;
          }
        }, 5000);
      }
    } else {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_DONE', filled, failedLabels, total });
      } catch (e) { }
    }
  }

  function showError(message) {
    if (window === window.top) {
      const skipBtn = document.getElementById('job-autofill-skip-btn');
      if (skipBtn) skipBtn.style.display = 'none';

      const statusEl = document.getElementById('job-autofill-status');
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color: #ea4335; margin-bottom: 12px;">${message}</div>
          <button id="job-autofill-error-dismiss-btn" style="width: 100%; padding: 6px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; color: #374151; font-weight: 600; font-size: 12px; transition: background 0.2s;">Dismiss</button>
        `;
        const dismissBtn = document.getElementById('job-autofill-error-dismiss-btn');
        if (dismissBtn) {
          dismissBtn.addEventListener('mouseenter', () => dismissBtn.style.background = '#e5e7eb');
          dismissBtn.addEventListener('mouseleave', () => dismissBtn.style.background = '#f3f4f6');
          dismissBtn.addEventListener('click', () => {
            if (overlay) {
              overlay.style.opacity = '0';
              setTimeout(() => overlay?.remove(), 300);
              overlay = null;
            }
          });
        }
      }
    } else {
      try {
        chrome.runtime.sendMessage({ type: 'AUTOFILL_ERROR', message });
      } catch (e) { }
    }
  }

  function getFieldPurpose(field) {
    return classifyFieldPurpose(field.label, field.options || [], field.fieldType);
  }

  function resolveFieldElement(field) {
    const el = field.element;
    if (el && document.contains(el)) return field;
    if (el?.id) {
      const fresh = document.getElementById(el.id);
      if (fresh) return { ...field, element: fresh };
    }
    if (el?.name) {
      const fresh = document.querySelector(`[name="${CSS.escape(el.name)}"]`);
      if (fresh) return { ...field, element: fresh };
    }
    return field;
  }

  function isComboboxInput(el) {
    if (!el) return false;
    return el.getAttribute('role') === 'combobox' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      el.getAttribute('aria-autocomplete') != null ||
      el.closest('[role="combobox"]') != null ||
      FormFiller.isGreenhouseRemixComboboxInput(el);
  }

  function keyForNearDuplicateLabel(label) {
    let k = normalizeFieldText(String(label || '')).replace(/\t+/g, ' ');
    k = k.replace(/\s*select\.{3}\s*$/i, '').replace(/\*+\s*$/g, '').trim();
    return k || `__raw__${label}`;
  }

  function fieldLooksVisible(field) {
    const el = field.element;
    if (!el || !document.contains(el)) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function dedupeFieldsByNearDuplicateLabel(fieldList) {
    const groups = new Map();
    for (const f of fieldList) {
      const key = keyForNearDuplicateLabel(f.label);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    const out = [];
    for (const list of groups.values()) {
      if (list.length === 1) {
        out.push(list[0]);
        continue;
      }
      // Prefer a field whose element is actually visible; the "*Select..." label often points
      // at an aria-hidden mirror input while the plain-labeled sibling is the real UI target.
      const vis = list.filter(fieldLooksVisible);
      const withSelect = list.find(x => /select\.{0,3}/i.test(x.label));
      if (withSelect && fieldLooksVisible(withSelect)) {
        out.push(withSelect);
        continue;
      }
      if (vis.length === 1) {
        out.push(vis[0]);
        continue;
      }
      if (vis.length > 1) {
        const prefer = vis.find(x => /select\.{0,3}/i.test(x.label)) || vis[0];
        out.push(prefer);
        continue;
      }
      const pool = list;
      const combobox = pool.find(x =>
        x.element?.getAttribute?.('role') === 'combobox' ||
        x.element?.getAttribute?.('aria-haspopup') === 'listbox' ||
        x.element?.getAttribute?.('aria-autocomplete') != null
      );
      out.push(withSelect || combobox || pool[pool.length - 1]);
    }
    return out;
  }

  function dedupeAiFieldsByNearDuplicateLabel(aiFields) {
    return dedupeFieldsByNearDuplicateLabel(aiFields);
  }

  function dedupeDirectByLabelAndPurpose(directList) {
    const seen = new Set();
    const out = [];
    for (const f of directList) {
      const k = `${normalizeFieldText(String(f.label || ''))}::${f.purpose}`;
      if (seen.has(k)) {
        console.log(`[JobAutoFill] Dedup: skipping duplicate direct "${f.label}" (${f.purpose})`);
        continue;
      }
      seen.add(k);
      out.push(f);
    }
    return out;
  }

  function isGroupedChoiceField(field) {
    return (field.fieldType === 'radio' || field.fieldType === 'checkbox-group' || field.fieldType === 'aria-choice-group') &&
      Array.isArray(field.allElements) && field.allElements.length > 1;
  }

  async function fillDetectedField(field, value) {
    if (field.fieldType === 'radio' && field.allElements) {
      return FormFiller.fillRadio(field.element, String(value), field.allElements);
    }
    if (field.fieldType === 'checkbox-group' && field.allElements) {
      return FormFiller.fillCheckboxGroup(field.element, value, field.allElements);
    }
    if (field.fieldType === 'aria-choice-group' && field.allElements) {
      return FormFiller.fillAriaChoiceGroup(field.element, String(value), field.allElements);
    }
    return await FormFiller.fillField(field.element, String(value), field.fieldType, field.purpose, field.label);
  }

  function verifyFilledField(field, expectedValue) {
    if (field.fieldType === 'radio' && field.allElements) {
      const actual = FormFiller.getSelectedRadioLabel(field.allElements);
      return {
        ok: !!actual && FormFiller.matchesChoice(actual, '', expectedValue),
        actual
      };
    }

    if (field.fieldType === 'checkbox-group' && field.allElements) {
      const actual = FormFiller.getCheckedCheckboxLabels(field.allElements);
      const desired = FormFiller.parseMultiValue(expectedValue);
      const matchedCount = desired.filter(answer =>
        actual.some(label => FormFiller.matchesChoice(label, '', answer))
      ).length;
      return {
        ok: desired.length > 0 && matchedCount === desired.length && actual.length === desired.length,
        actual: actual.join(', ')
      };
    }

    if (field.fieldType === 'aria-choice-group' && field.allElements) {
      const actual = FormFiller.getSelectedAriaChoiceLabel(field.allElements);
      return {
        ok: !!actual && FormFiller.matchesChoice(actual, '', expectedValue),
        actual
      };
    }

    if (field.fieldType === 'checkbox') {
      const shouldBeChecked = /^(yes|true|1|checked|agree)$/i.test(String(expectedValue));
      return {
        ok: field.element.checked === shouldBeChecked,
        actual: field.element.checked ? 'checked' : 'unchecked'
      };
    }

    const actual = FormFiller.getEffectiveInputValue(field.element) ||
      field.element.value ||
      field.element.textContent ||
      '';
    const rawTrim = String(actual).trim();
    const placeholder = (field.element.getAttribute('placeholder') || '').trim();

    if (isComboboxInput(field.element)) {
      if (!rawTrim || /^select\.{0,3}$/i.test(rawTrim)) {
        return { ok: false, actual: rawTrim || '(empty)' };
      }
      if (placeholder && rawTrim.toLowerCase() === placeholder.toLowerCase()) {
        return { ok: false, actual: rawTrim };
      }
      if (/no location found|try entering a different location/i.test(rawTrim)) {
        return { ok: false, actual: rawTrim };
      }
    }

    const isPhone = field.element.type === 'tel' ||
      /\b(phone|mobile|cell|telephone)\b/i.test(field.label || '');
    if (isPhone) {
      const actualDigits = String(actual).replace(/\D/g, '');
      const expectedDigits = String(expectedValue).replace(/\D/g, '');
      if (actualDigits && expectedDigits) {
        const ok = actualDigits.includes(expectedDigits) || expectedDigits.includes(actualDigits);
        return { ok, actual: rawTrim };
      }
    }

    const normalizedActual = FormFiller.normalizeChoiceText(actual);
    const normalizedExpected = FormFiller.normalizeChoiceText(String(expectedValue));
    const expectedShort = /^(yes|no)$/i.test(String(expectedValue).trim());
    if (expectedShort && !/^(yes|no)$/i.test(rawTrim)) {
      const ok = FormFiller.matchesChoice(rawTrim, '', expectedValue);
      return { ok, actual: rawTrim };
    }

    const expectedTokens = FormFiller.tokenizeChoice(normalizedExpected).filter(token => token.length > 2);
    const actualTokens = new Set(FormFiller.tokenizeChoice(normalizedActual));
    const tokenHits = expectedTokens.filter(token => actualTokens.has(token)).length;
    const fuzzyMatch = expectedTokens.length > 0 && tokenHits >= Math.max(2, Math.ceil(expectedTokens.length / 2));
    return {
      ok: normalizedActual === normalizedExpected ||
        normalizedActual.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedActual) ||
        fuzzyMatch,
      actual: rawTrim
    };
  }

  // Main auto-fill flow
  async function startAutoFill() {
    if (isRunning) return;
    isRunning = true;
    skipRequested = false;

    createOverlay();
    const skipBtn = document.getElementById('job-autofill-skip-btn');
    if (skipBtn) skipBtn.style.display = 'block';

    updateStatus('Detecting application form...', 5);

    try {
      // 1. Get profile and resume data
      const profileData = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
      console.log('[JobAutoFill Debug] Profile loaded:', profileData.profile);
      console.log('[JobAutoFill Debug] RAW PROFILE DATA:', JSON.stringify(profileData, null, 2));
      if (!profileData.hasApiKey) throw new Error('Please set your Gemini API key in the extension popup.');
      if (!profileData.hasResume) throw new Error('Please upload your resume in the extension popup.');

      const querySelectorAllDeep = (selector, root = document) => {
        const elements = Array.from(root.querySelectorAll(selector));
        const children = root.querySelectorAll('*');
        for (const child of children) {
          if (child.shadowRoot) {
            elements.push(...querySelectorAllDeep(selector, child.shadowRoot));
          }
        }
        return elements;
      };

      // Detect portal handler
      const handler = PortalHandlers.detect() || GenericHandler;
      const isSmartRecruiters = handler?.name === 'SmartRecruiters';

      // Click all "+ Add" buttons (Experience, Education rows) to expand dynamic form fields (crossing shadow boundaries)
      // Skip if the handler has a customFill method that manages its own card expansion
      if (!handler.customFill) {
        const allButtons = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button, [class*="button"], [class*="btn"], .add-button, span, div, a');
        console.log(`[JobAutoFill Debug] querySelectorAllDeep found ${allButtons.length} candidate elements.`);
        const addButtons = allButtons.filter(el => {
          const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          if (text.length > 50) return false;
          const isMatch = text === '+ add' || text === 'add' || text === '+add' || text === 'add more' || text === 'add another' ||
            (text.includes('add') && (text.includes('experience') || text.includes('education') || text.includes('job') || text.includes('work') || text.includes('school') || text.includes('history') || text.includes('degree') || text.includes('employer')));
          if (isMatch) {
            console.log(`[JobAutoFill Debug] Matched button: tag=${el.tagName}, class=${el.className}, text="${text}"`);
          }
          return isMatch;
        });

        if (addButtons.length > 0) {
          console.log(`[JobAutoFill] Found ${addButtons.length} "+ Add" button(s). Clicking to expand form sections...`);
          for (const btn of addButtons) {
            try {
              btn.click();
            } catch (e) {
              console.warn('[JobAutoFill] Click failed on "+ Add" button:', e);
            }
          }
          await FormFiller.delay(350); // wait for animations to complete
        }
      }

      // If handler has a custom multi-card/complex fill flow, invoke it first
      // (e.g. SmartRecruiters experience/education sections with Shadow DOM cards)
      if (handler.customFill) {
        updateStatus('Filling experience and education details...', 10);
        await handler.customFill(profileData);
      }

      updateStatus('Scanning form fields...', 15);

      // Loop up to 2 times for dynamic fields (like race appearing after hispanic)
      const MAX_PASSES = 2;
      const allDetectedFieldIds = new Set();
      const allFailedFieldLabels = [];
      let totalFieldsAttempted = 0;
      let totalFilled = 0;

      for (let pass = 1; pass <= MAX_PASSES; pass++) {
        const currentPassFields = handler.getFields();

        // Filter out fields we already processed in a previous pass
        const fields = currentPassFields.filter(f => !allDetectedFieldIds.has(f.id));
        fields.forEach(f => allDetectedFieldIds.add(f.id));

        if (fields.length === 0) {
          if (pass === 1) {
            // Prevent false "No form fields" errors when the form is in another frame
            if (window !== window.top || document.querySelectorAll('iframe').length > 0) {
              isRunning = false;
              if (overlay) { overlay.remove(); overlay = null; }
              return;
            }
            throw new Error('No form fields detected on this page.');
          } else {
            // Pass 2: No new fields appeared, we can stop early
            break;
          }
        }

        updateStatus(`Pass ${pass}: Found ${fields.length} new fields. Analyzing...`, pass === 1 ? 25 : 80);

        // Get job description and info
        const jobDescription = handler.getJobDescription?.() || '';
        const jobInfo = handler.getJobInfo?.() || {};

        // Separate fields by type
        const directFields = [];
        const aiFields = [];
        const fileFields = [];
        const coverLetterFields = [];

        console.log(`[JobAutoFill] Pass ${pass}: Detected fields:`, fields.map(f => ({
          label: f.label, id: f.id, type: f.fieldType, options: f.options
        })));

        fields.forEach(field => {
          const purpose = getFieldPurpose(field);
          console.log(`[JobAutoFill] Pass ${pass}: Field "${field.label}" (${field.fieldType}) → purpose: ${purpose}`, field.options ? `options: [${field.options.join(', ')}]` : '');

          if (purpose === 'resumeFile') {
            fileFields.push(field);
          } else if (purpose === 'coverLetter') {
            coverLetterFields.push(field);
          } else if (purpose === 'ai') {
            aiFields.push(field);
          } else {
            directFields.push({ ...field, purpose });
          }
        });

        // Dedup direct fields
        const groupedChoiceFields = [...directFields, ...aiFields].filter(isGroupedChoiceField);
        const groupedPurposes = new Set(groupedChoiceFields.map(f => f.purpose));
        const dedupedDirect = directFields.filter(f => {
          const coveredByGroupedField = groupedChoiceFields.find(group =>
            group !== f &&
            group.purpose === f.purpose &&
            group.allElements.some(el => el === f.element || (el.name && el.name === f.element?.name))
          );
          if (coveredByGroupedField || ((f.fieldType === 'radio' || f.fieldType === 'checkbox') && !f.allElements && groupedPurposes.has(f.purpose))) {
            return false;
          }
          return true;
        });
        const dedupedDirectUnique = dedupeDirectByLabelAndPurpose(dedupedDirect);
        directFields.length = 0;
        directFields.push(...dedupedDirectUnique);

        const dedupedAi = aiFields.filter(f => {
          if ((f.fieldType === 'radio' || f.fieldType === 'checkbox') && !f.allElements) {
            const parentGroup = groupedChoiceFields.find(g =>
              g.allElements.some(r => r === f.element || (r.name && r.name === f.element?.name))
            );
            if (parentGroup) return false;
          }
          return true;
        });

        // 5. Attach resume first (only on pass 1) - Skip on SmartRecruiters to avoid auto-parser race conditions
        if (pass === 1 && fileFields.length > 0 && !isSmartRecruiters) {
          updateStatus('Attaching resume...', 32);
          const resumeFile = await chrome.runtime.sendMessage({ type: 'GET_RESUME_FILE' });
          if (resumeFile) {
            const orderedResumeSlots = [...fileFields].sort((a, b) => {
              const lab = normalizeFieldText(String(a.label || ''));
              return /\bresume\b|\bcv\b|\bcurriculum\b/.test(lab) ? -1 : 1;
            });
            let attachedResumeOnce = false;
            for (const field of orderedResumeSlots) {
              if (attachedResumeOnce) break;
              const f = resolveFieldElement(field);
              let success;
              if (resumeFile.generateFromText) {
                success = FormFiller.attachGeneratedTextAsPdf(f.element, resumeFile.text, resumeFile.fileName);
              } else {
                success = await FormFiller.attachFile(f.element, resumeFile.data, resumeFile.fileName);
              }
              if (success) {
                attachedResumeOnce = true;
                totalFilled++;
                f.element.style.outline = '2px solid #34a853';
                f.element.style.outlineOffset = '2px';
              } else {
                allFailedFieldLabels.push(f.label || 'Resume/CV');
              }
            }
            await FormFiller.delay(500);
          }
        }

        if (directFields.length > 0) {
          updateStatus(`Pass ${pass}: Filling ${directFields.length} profile fields...`, pass === 1 ? 40 : 85);
        }

        // 6. Fill direct fields
        const fallbackPurposes = new Set([
          'pronouns', 'workAuthorizationStatus', 'relocation', 'officeAttendance', 'sponsorship', 'gender', 'ethnicity', 'disabilityStatus', 'veteranStatus'
        ]);
        const optionalPurposes = new Set([
          'facebookUrl', 'twitterUrl', 'githubUrl', 'portfolioUrl'
        ]);
        const fallbackAiFields = [];

        for (const field of directFields) {
          const resolved = resolveFieldElement(field);

          if (skipRequested) {
            skipRequested = false;
            console.log(`[JobAutoFill] Skipped direct field: ${resolved.label}`);
            allFailedFieldLabels.push(resolved.label + " (skipped)");
            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
            highlightTarget.style.outline = '2px solid #f97316';
            highlightTarget.style.outlineOffset = '2px';
            continue;
          }

          const value = getProfileValue(profileData.profile, resolved.purpose);
          if (value) {
            const success = await fillDetectedField(resolved, value);
            if (resolved.fieldType === 'aria-choice-group') await FormFiller.delay(120);
            const verification = verifyFilledField(resolved, value);
            const applied = success && verification.ok;

            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;

            if (applied) {
              totalFilled++;
              highlightTarget.style.outline = '2px solid #34a853';
              highlightTarget.style.outlineOffset = '2px';
            } else {
              console.log(`[JobAutoFill] Pass ${pass}: Direct fill failed for "${resolved.label}" (value: ${value}). Falling back to AI...`);
              // Clear the incorrect value if possible
              if (resolved.element.tagName === 'SELECT') {
                resolved.element.selectedIndex = -1;
                resolved.element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
              }
              fallbackAiFields.push(resolved);
            }
            await FormFiller.delay(FormFiller.FILL_DELAY);
          } else {
            if (fallbackPurposes.has(resolved.purpose)) {
              fallbackAiFields.push(resolved);
            } else if (optionalPurposes.has(resolved.purpose)) {
              // Optional profile field: skip outlining in red if empty
            } else {
              const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
              highlightTarget.style.outline = '2px solid #ea4335';
              highlightTarget.style.outlineOffset = '2px';
              allFailedFieldLabels.push(resolved.label); // Profile didn't have value
            }
          }
        }

        const aiQueue = [...dedupedAi, ...fallbackAiFields].filter((field, index, list) =>
          list.findIndex(candidate => candidate.id === field.id) === index
        );

        if (aiQueue.length > 0) {
          updateStatus(`Pass ${pass}: AI answering ${aiQueue.length} questions...`, pass === 1 ? 55 : 90);

          const aiFieldData = aiQueue.map(f => ({
            id: f.id,
            label: f.label,
            fieldType: f.fieldType,
            options: f.options || null
          }));

          const result = await chrome.runtime.sendMessage({
            type: 'FILL_FIELDS',
            payload: { fields: aiFieldData, jobDescription }
          });

          if (result.error) throw new Error(result.error);
          const aiAnswers = result.answers || {};

          updateStatus(`Pass ${pass}: Filling AI answers...`, pass === 1 ? 70 : 95);

          for (const field of aiQueue) {
            const resolved = resolveFieldElement(field);

            if (skipRequested) {
              skipRequested = false;
              console.log(`[JobAutoFill] Skipped AI field: ${resolved.label}`);
              allFailedFieldLabels.push(resolved.label + " (skipped)");
              const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
              highlightTarget.style.outline = '2px solid #f97316';
              highlightTarget.style.outlineOffset = '2px';
              continue;
            }

            const value = aiAnswers[resolved.id];
            const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;

            if (value) {
              const success = await fillDetectedField(resolved, value);
              if (resolved.fieldType === 'aria-choice-group') await FormFiller.delay(120);
              const verification = verifyFilledField(resolved, value);
              const applied = success && verification.ok;

              if (applied) {
                totalFilled++;
                highlightTarget.style.outline = '2px solid #34a853';
                highlightTarget.style.outlineOffset = '2px';
              } else {
                highlightTarget.style.outline = '2px solid #ea4335';
                highlightTarget.style.outlineOffset = '2px';
                allFailedFieldLabels.push(resolved.label);
              }
              await FormFiller.delay(FormFiller.FILL_DELAY);
            } else {
              highlightTarget.style.outline = '2px solid #ea4335';
              highlightTarget.style.outlineOffset = '2px';
              allFailedFieldLabels.push(resolved.label);
            }
          }
        }

        // 9. Generate and attach cover letter (only pass 1 usually, unless appeared later)
        if (coverLetterFields.length > 0) {
          updateStatus('Generating cover letter...', 90);
          const clResult = await chrome.runtime.sendMessage({
            type: 'GENERATE_COVER_LETTER',
            payload: {
              jobDescription,
              companyName: jobInfo.company,
              roleTitle: jobInfo.title
            }
          });

          if (clResult?.coverLetter) {
            const applicant = profileData.profile.fullName || 'Applicant';
            for (const field of coverLetterFields) {
              const resolved = resolveFieldElement(field);
              let success;
              if (resolved.fieldType === 'file') {
                success = FormFiller.attachCoverLetterAsFile(
                  resolved.element, clResult.coverLetter, applicant
                );
              } else {
                success = await FormFiller.fillField(resolved.element, clResult.coverLetter, resolved.fieldType);
              }

              const highlightTarget = FormFiller.getComboboxInteractTarget(resolved.element) || resolved.element;
              if (success) {
                totalFilled++;
                highlightTarget.style.outline = '2px solid #34a853';
              } else {
                allFailedFieldLabels.push(resolved.label);
              }
            }
          }
        }

        totalFieldsAttempted += fileFields.length + directFields.length + aiQueue.length + coverLetterFields.length;

        // If this was pass 1, wait half a second to let any cascading fields (like Race) appear
        if (pass === 1) {
          const saveButtons = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button')
            .filter(el => {
              const text = el.textContent.trim().toLowerCase();
              return text === 'save' || text === 'add and save';
            });

          if (saveButtons.length > 0) {
            console.log(`[JobAutoFill] Found ${saveButtons.length} "Save" button(s) at end of Pass 1. Clicking to save sections...`);
            for (const btn of saveButtons) {
              try {
                btn.click();
              } catch (e) { }
            }
            await FormFiller.delay(1000); // wait for save API requests and animations to settle!

            // Now click "+ Add" again to expand the next card for Pass 2!
            // Skip if handler manages its own card expansion via customFill
            if (!handler.customFill) {
              const addButtonsPass2 = querySelectorAllDeep('button, [role="button"], a.btn, .btn, sf-button, [class*="button"], [class*="btn"], .add-button')
                .filter(el => {
                  const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
                  if (text === '+ add' || text === 'add' || text === '+add' || text === 'add more' || text === 'add another') return true;
                  if (text.includes('add') && (text.includes('experience') || text.includes('education') || text.includes('job') || text.includes('work') || text.includes('school') || text.includes('history') || text.includes('degree') || text.includes('employer'))) return true;
                  return false;
                });

              if (addButtonsPass2.length > 0) {
                console.log(`[JobAutoFill] Clicking "+ Add" button(s) again to expand subsequent cards for Pass 2...`);
                for (const btn of addButtonsPass2) {
                  try {
                    btn.click();
                  } catch (e) { }
                }
                await FormFiller.delay(500); // wait for card to open
              }
            }
          }
          await FormFiller.delay(600);
        }
      }

      // Attach resume at the very end on SmartRecruiters to avoid auto-parser race conditions
      if (isSmartRecruiters) {
        const fileFields = handler.getFields().filter(f => getFieldPurpose(f) === 'resumeFile');
        if (fileFields.length > 0) {
          updateStatus('Attaching resume...', 98);
          const resumeFile = await chrome.runtime.sendMessage({ type: 'GET_RESUME_FILE' });
          if (resumeFile) {
            const f = resolveFieldElement(fileFields[0]);
            if (resumeFile.generateFromText) {
               await FormFiller.attachGeneratedTextAsPdf(f.element, resumeFile.text, resumeFile.fileName);
            } else {
               await FormFiller.attachFile(f.element, resumeFile.data, resumeFile.fileName);
            }
            await FormFiller.delay(1000); // let upload commit
          }
        }
      }

      showResult(totalFilled, allFailedFieldLabels, totalFieldsAttempted);

    } catch (e) {
      console.error('[JobAutoFill] Error:', e);
      showError(e.message);
    } finally {
      isRunning = false;
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_AUTOFILL') {
      startAutoFill();
      sendResponse({ ok: true });
    } else if (message.type === 'AUTOFILL_PROGRESS') {
      if (window === window.top) {
        updateStatus(message.text, message.progress);
      }
    } else if (message.type === 'AUTOFILL_DONE') {
      if (window === window.top) {
        showResult(message.filled, message.failedLabels || [], message.total);
      }
    } else if (message.type === 'AUTOFILL_ERROR') {
      if (window === window.top) {
        showError(message.message);
      }
    }
    return true;
  });

  // Watch for multi-step form navigation (LinkedIn Easy Apply, Workday)
  const mutationObserver = new MutationObserver((mutations) => {
    if (isRunning) return;

    // Check if new form fields appeared
    let hasNewFields = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.querySelector?.('input, textarea, select, [contenteditable]') ||
            node.matches?.('input, textarea, select')) {
            hasNewFields = true;
            break;
          }
        }
      }
      if (hasNewFields) break;
    }

    // If new fields appeared on a job application page, show the FAB
    if (hasNewFields && fab) {
      const fabBtn = document.getElementById('job-autofill-fab-btn');
      if (fabBtn) {
        fabBtn.style.background = '#fbbc04';
        setTimeout(() => { fabBtn.style.background = '#1a73e8'; }, 2000);
      }
    }
  });

  // Initialize: show FAB if this looks like a job application page
  function init() {
    const url = window.location.href;
    const isJobSite = /ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|workday\.com|linkedin\.com\/jobs|icims\.com|taleo\.net|careers|jobs|apply|application/i.test(url);

    if (isJobSite) {
      createFAB();
      mutationObserver.observe(document.body, { childList: true, subtree: true });

      // Periodically check for LinkedIn job action containers to inject inline button
      if (url.includes('linkedin.com')) {
        setInterval(injectLinkedInExtractButton, 1000);
      }
    }
  }

  function injectLinkedInExtractButton() {
    // Look for the "Save" button in the job details header
    const saveBtn = document.querySelector('.jobs-save-button');
    if (!saveBtn) return;

    // The parent container of the Apply/Save buttons
    const container = saveBtn.parentElement;
    if (!container) return;

    let btn = document.getElementById('jayobee-inline-extract-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'jayobee-inline-extract-btn';
      btn.style.cssText = `
        background: #ffb800;
        color: #111827;
        border: none;
        border-radius: 24px;
        padding: 0 20px;
        font-weight: 700;
        font-size: 20px;
        cursor: pointer;
        margin-left: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        line-height: 1.2;
        font-family: "Zilla Slab", "Courier New", Courier, monospace;
        box-shadow: 0 0 0 1px transparent;
        transition: opacity 0.2s;
        box-sizing: border-box;
      `;

      btn.innerHTML = `Clyde`;

      btn.addEventListener('mouseenter', () => btn.style.opacity = '0.88');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '1');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || btn.innerText.includes('Extracted')) return;

        btn.innerText = 'Extracting...';
        btn.disabled = true;

        let textToExtract = document.body.innerText;
        const selectors = [
          '.jobs-description__content',
          '.jobs-search__job-details--container',
          '.job-description',
          '#job-description'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim().length > 200) {
            textToExtract = el.innerText;
            break;
          }
        }

        try {
          chrome.runtime.sendMessage({
            action: "extract-page-from-content",
            text: textToExtract,
            url: window.location.href
          }, (res) => {
            if (chrome.runtime.lastError || res?.error) {
              btn.innerText = 'Error!';
              setTimeout(() => { updateButtonState(btn); btn.disabled = false; }, 2000);
            } else {
              btn.innerText = 'Extracted \u2713';
              btn.style.opacity = '0.5';
              btn.style.cursor = 'default';
            }
          });
        } catch (e) {
          btn.innerText = 'Error!';
          setTimeout(() => { updateButtonState(btn); btn.disabled = false; }, 2000);
        }
      });

      container.appendChild(btn);
    }

    // Always update state if it's not currently extracting
    if (!btn.innerText.includes('Extracting')) {
      updateButtonState(btn);
    }
  }

  function getJobIdFromUrl(url) {
    const match = url.match(/currentJobId=([0-9]+)/) || url.match(/\/jobs\/view\/([0-9]+)/);
    return match ? match[1] : null;
  }

  function updateButtonState(btn) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.storage || !chrome.storage.local) return;

    try {
      chrome.storage.local.get({ clips: [] }, (data) => {
        if (chrome.runtime.lastError) return; // fail silently if context invalidated during async call

        const currentUrl = window.location.href;
        const currentJobId = getJobIdFromUrl(currentUrl);

        const isExtracted = data.clips.some(clip => {
          if (!clip.url) return false;
          const clipJobId = getJobIdFromUrl(clip.url);
          return (clipJobId && clipJobId === currentJobId) || (clip.url === currentUrl);
        });

        if (isExtracted) {
          btn.innerHTML = `Clyde \u2713`;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'default';
          btn.disabled = true; // prevent re-clicking while extracted
          btn.onmouseenter = null;
          btn.onmouseleave = null;
        } else {
          btn.innerHTML = `Clyde`;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.disabled = false;
          btn.onmouseenter = () => btn.style.opacity = '0.88';
          btn.onmouseleave = () => btn.style.opacity = '1';
        }
      });
    } catch (e) {
      // Ignore extension context invalidated errors to prevent console spam
      if (e.message && e.message.includes('Extension context invalidated')) return;
      console.warn('Clyde: Error accessing storage:', e);
    }
  }

  // Listen for storage changes so the button updates if a clip is deleted in the popup
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    try {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

        if (namespace === 'local' && changes.clips) {
          const btn = document.getElementById('jayobee-inline-extract-btn');
          if (btn) updateButtonState(btn);
        }
      });
    } catch (e) {
      // Ignore errors related to context invalidation
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
