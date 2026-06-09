PortalHandlers.register({
  name: 'Workday',

  mappings: {
    experience: {
      title: /^(?!.*desc)(?!.*summary)(?:job\s*title|title|position|role)/i,
      company: /company|employer|organization|employer\s*name/i,
      location: /location|city|town/i,
      isCurrent: /currently|current|present|still\s*work/i,
      start: /from|start\s*date/i,
      end: /to|end\s*date/i,
      description: /description|responsibilities|summary/i
    },
    education: {
      school: /school|university|college|institution/i,
      degree: /degree|qualification/i,
      major: /field\s*of\s*study|major|discipline|subject/i,
      start: /from|start\s*date/i,
      end: /to|end\s*date|graduation|graduated/i
    },
    certifications: {
      name: /certification\s*name|certification|license/i,
      number: /certification\s*number|license\s*number/i,
      issued: /issued|start\s*date|date\s*issued/i,
      expires: /expiration|expires|end\s*date/i
    }
  },

  detect(url) {
    return /myworkdayjobs\.com|workday\.com\/.*\/job/i.test(url) ||
      !!document.querySelector('[data-automation-id]');
  },

  getFields() {
    const fields = [];
    const { expHeader, eduHeader, certHeader, skillsHeader } = this._findHeaders();

    const isCustomFilledField = (el) => {
      if (!expHeader) return false;
      
      const posExp = expHeader.compareDocumentPosition(el);
      if (!(posExp & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      
      if (skillsHeader) {
        const posSkills = el.compareDocumentPosition(skillsHeader);
        if (posSkills & Node.DOCUMENT_POSITION_FOLLOWING) return true;
      }
      
      // Also skip skills input itself
      const label = (getFieldLabel(el) || '').toLowerCase();
      const id = (el.getAttribute('id') || '').toLowerCase();
      const autoId = (el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '').toLowerCase();
      if (label.includes('skills') || id.includes('skills') || autoId.includes('skills') || autoId.includes('multiselect')) {
        return true;
      }
      
      const closestCard = el.closest?.('[data-automation-id*="workExperience"], [data-automation-id*="education"], [data-automation-id*="certification"], [data-automation-id*="school"], [data-automation-id*="job"], [data-automation-id*="achievement"], [data-automation-id*="formSpace"]');
      if (closestCard) return true;
      
      return false;
    };

    // Workday uses data-automation-id attributes extensively
    const automationFields = document.querySelectorAll('[data-automation-id]');
    const processed = new Set();

    automationFields.forEach(container => {
      // Find inputs within or as the element
      const inputs = container.matches('input, textarea, select')
        ? [container]
        : container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');

      inputs.forEach(el => {
        if (processed.has(el) || el.offsetParent === null) return;
        processed.add(el);

        // Skip fields inside custom-filled sections (experience, education, certifications)
        if (isCustomFilledField(el)) return;

        const automationId = el.closest('[data-automation-id]')?.getAttribute('data-automation-id') || '';
        const field = extractFieldInfo(el);
        if (field) {
          field.automationId = automationId;
          fields.push(field);
        }
      });
    });

    // Also scan for any remaining visible inputs not caught above
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea, select').forEach(el => {
      if (processed.has(el) || el.offsetParent === null) return;
      processed.add(el);

      // Skip fields inside custom-filled sections
      if (isCustomFilledField(el)) return;

      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Custom dropdowns (Workday uses div-based dropdowns)
    document.querySelectorAll('[data-automation-id*="dropdown"], [data-automation-id*="select"]').forEach(el => {
      if (processed.has(el)) return;

      // Skip fields inside custom-filled sections
      if (isCustomFilledField(el)) return;

      const label = el.closest('[data-automation-id]')?.querySelector('label')?.textContent?.trim() ||
        el.getAttribute('aria-label') || '';
      if (label) {
        fields.push({
          id: el.getAttribute('data-automation-id') || `wd_${fields.length}`,
          label,
          element: el,
          fieldType: 'custom-dropdown',
          automationId: el.getAttribute('data-automation-id')
        });
      }
    });

    // File inputs
    document.querySelectorAll('input[type="file"]').forEach(el => {
      if (processed.has(el)) return;

      // Skip fields inside custom-filled sections
      if (isCustomFilledField(el)) return;

      const field = extractFieldInfo(el);
      if (field) {
        field.fieldType = 'file';
        fields.push(field);
      }
    });

    return fields;
  },

  getJobDescription() {
    const desc = document.querySelector('[data-automation-id="jobPostingDescription"], .job-description, [data-automation-id="job-posting-description"]');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('[data-automation-id="jobPostingHeader"], h1, [data-automation-id="job-title"]')?.textContent?.trim() || '';
    const company = document.querySelector('[data-automation-id="companyName"], .css-1h46us2')?.textContent?.trim() || '';
    return { title, company };
  },

  async _waitForSettle() {
    console.log('[Workday Debug] Waiting for page loading and framework elements to settle...');
    // 1. Wait for any loading spinner or overlay to disappear
    for (let i = 0; i < 20; i++) {
      const loader = document.querySelector('[data-automation-id="loadingOverlay"], .workday-loading, [class*="loadingOverlay"], [class*="loading-overlay"], .loading-spinner, .spinner');
      if (!loader || window.getComputedStyle(loader).display === 'none') {
        break;
      }
      console.log('[Workday Debug] Loader/spinner visible, waiting 500ms...');
      await FormFiller.delay(500);
    }
    // 2. Extra safety buffer to let React state load and buttons render
    await FormFiller.delay(2000);
    console.log('[Workday Debug] Page settled. Ready to autofill.');
  },

  async customFill(profileData) {
    console.log('[Workday Debug] customFill started with Linear Sectioning!');
    await this._waitForSettle();
    this._profileData = profileData;
    const structured = profileData?.structured || {};
    const profile = profileData?.profile || {};
    const experience = structured.experience || profile.experience || [];
    const education = structured.education || profile.education || [];
    const certifications = structured.certifications || profile.certifications || [];
    const skills = structured.skills || profile.skills || [];

    console.log('[Workday Debug] Raw profileData.profile:', JSON.stringify(profile, null, 2));
    console.log('[Workday Debug] Raw profileData.structured:', JSON.stringify(structured, null, 2));
    console.log(`[Workday] customFill running: ${experience.length} experiences, ${education.length} education entries, ${certifications.length} certifications, ${skills.length} skills`);

    if (experience.length > 0) {
      await this._fillSection('experience', experience);
    } else {
      console.log('[Workday Debug] No experience records found to fill.');
    }

    if (education.length > 0) {
      await this._fillSection('education', education);
    } else {
      console.log('[Workday Debug] No education records found to fill.');
    }

    if (certifications.length > 0) {
      await this._fillSection('certifications', certifications);
    } else {
      console.log('[Workday Debug] No certification records found to fill.');
    }

    // Process Skills in customFill to handle typeahead tag additions correctly (Skipped as requested)
    console.log('[Workday Debug] Skipping skills section autofill as requested.');

    console.log('[Workday Debug] customFill completed!');
  },

  async _safeClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'nearest' });
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
      el.click();
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
      console.log(`[Workday Debug] Framework-safe click successfully dispatched on:`, el);
    } catch (e) {
      el.click();
      console.warn(`[Workday Debug] Fallback standard click dispatched on:`, el, e);
    }
  },

  async _fillSection(sectionType, records) {
    console.log(`[Workday Debug] _fillSection started for: ${sectionType}`);

    // Early Exit safety guard: if the section header is not on the page, skip immediately
    const { expHeader, eduHeader, certHeader } = this._findHeaders();
    let startHeader = null;
    if (sectionType === 'experience') startHeader = expHeader;
    else if (sectionType === 'education') startHeader = eduHeader;
    else if (sectionType === 'certifications') startHeader = certHeader;

    if (!startHeader) {
      console.log(`[Workday Debug] Section "${sectionType}" header not found on this page. Skipping section entirely.`);
      return;
    }

    let cardContainers = this._getCardContainers(sectionType);
    let usingFallback = false;

    // Check if the card containers found are valid (each should have at least 2 input/textarea/select fields)
    const hasInvalidCard = cardContainers.length > 0 && cardContainers.some(el => {
      const inputs = FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select', el);
      return inputs.length <= 1;
    });

    // Check if there are inputs in the section that are not inside any of the found card containers
    const sectionInputs = this._getSectionInputs(sectionType);
    const hasUncoveredInputs = sectionInputs.some(input => {
      return !cardContainers.some(container => container.contains(input));
    });

    if (cardContainers.length === 0 || hasInvalidCard || hasUncoveredInputs) {
      console.log(`[Workday Debug] _getCardContainers returned 0, single-input, or incomplete containers. Using virtual card grouping fallback...`);
      cardContainers = this._getVirtualCards(sectionType);
      usingFallback = true;
    }

    console.log(`[Workday] Currently found ${cardContainers.length} cards for "${sectionType}". Target is ${records.length}.`);

    // Add card rows if we need more
    const targetCount = records.length;
    if (cardContainers.length < targetCount) {
      const addBtn = this._getAddButtonBySection(sectionType);

      if (addBtn) {
        const needed = targetCount - cardContainers.length;
        console.log(`[Workday] Clicking "Add Another" button ${needed} times to match records...`);
        for (let k = 0; k < needed; k++) {
          try {
            console.log(`[Workday Debug] Triggering framework-safe click on "Add Another" button, click count=${k+1}`);
            await this._safeClick(addBtn);
            await FormFiller.delay(2500); // Wait for dynamic React card injection and animation
          } catch (e) {
            console.warn(`[Workday] Click failed on "Add Another" button:`, e);
          }
        }
        // Re-query card containers
        if (usingFallback) {
          cardContainers = this._getVirtualCards(sectionType);
        } else {
          cardContainers = this._getCardContainers(sectionType);
          const reCheckInvalid = cardContainers.length > 0 && cardContainers.some(el => {
            const inputs = FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select', el);
            return inputs.length <= 1;
          });
          const currentSectionInputs = this._getSectionInputs(sectionType);
          const reCheckUncovered = currentSectionInputs.some(input => {
            return !cardContainers.some(container => container.contains(input));
          });
          if (cardContainers.length === 0 || reCheckInvalid || reCheckUncovered) {
            cardContainers = this._getVirtualCards(sectionType);
            usingFallback = true;
          }
        }
        console.log(`[Workday] After expansion, found ${cardContainers.length} cards for "${sectionType}".`);
      } else {
        console.warn(`[Workday] "Add Another" button NOT found for section "${sectionType}"`);
      }
    }

    // Process card-by-card deterministically
    const finalCount = Math.min(cardContainers.length, records.length);
    console.log(`[Workday Debug] Proceeding to fill ${finalCount} card(s) for ${sectionType}`);
    for (let i = 0; i < finalCount; i++) {
      const card = cardContainers[i];
      const record = records[i];
      console.log(`[Workday] Filling "${sectionType}" card index ${i + 1}/${finalCount}...`, record);
      await this._fillCard(sectionType, card, record);
    }
    console.log(`[Workday Debug] _fillSection completed for: ${sectionType}`);
  },

  _getCardContainers(sectionType) {
    const { expHeader, eduHeader, certHeader } = this._findHeaders();
    let startHeader = null;
    let endHeader = null;

    if (sectionType === 'experience') {
      startHeader = expHeader;
      endHeader = eduHeader || certHeader;
    } else if (sectionType === 'education') {
      startHeader = eduHeader;
      endHeader = certHeader;
    } else if (sectionType === 'certifications') {
      startHeader = certHeader;
      endHeader = null;
    }

    if (!startHeader) return [];

    // Query elements that are card containers (using case-insensitive queries to match varying casing)
    const selector = '[data-automation-id*="workExperience" i], [data-automation-id*="education" i], [data-automation-id*="certification" i], [data-automation-id*="jobHistory" i], [data-automation-id*="achievement" i], [data-automation-id*="formSpace" i]';
    const allContainers = FormFiller.querySelectorAllDeep(selector, document);

    const sectionContainers = allContainers.filter(el => {
      if (startHeader) {
        const pos = startHeader.compareDocumentPosition(el);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      }
      if (endHeader) {
        const pos = el.compareDocumentPosition(endHeader);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      }
      return true;
    });

    // Filter to keep only the top-level card containers (no container inside another container)
    const cardContainers = sectionContainers.filter(el => {
      return !sectionContainers.some(other => other !== el && other.contains(el));
    });

    console.log(`[Workday Debug] _getCardContainers for "${sectionType}": found ${cardContainers.length} top-level containers`);
    return cardContainers;
  },

  _getVirtualCards(sectionType) {
    const inputs = this._getSectionInputs(sectionType);
    console.log(`[Workday Debug] _getVirtualCards for "${sectionType}": found ${inputs.length} inputs in section.`);
    if (inputs.length === 0) return [];

    const virtualCards = [];
    let currentCard = null;

    inputs.forEach(el => {
      const isStartOfCard = this._isFirstField(sectionType, el);
      if (isStartOfCard && this._hasOtherFields(sectionType, currentCard)) {
        currentCard = [el];
        virtualCards.push(currentCard);
      } else {
        if (!currentCard) {
          // If we encounter inputs before the first matching start field,
          // we group them into a starting card group anyway.
          currentCard = [];
          virtualCards.push(currentCard);
        }
        currentCard.push(el);
      }
    });

    console.log(`[Workday Debug] _getVirtualCards for "${sectionType}": grouped into ${virtualCards.length} virtual card(s).`);
    return virtualCards;
  },

  _isFirstField(sectionType, el) {
    const label = (getFieldLabel(el) || '').trim();
    const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
    
    let regex = null;
    if (sectionType === 'experience') {
      regex = this.mappings.experience.title;
    } else if (sectionType === 'education') {
      regex = this.mappings.education.school;
    } else if (sectionType === 'certifications') {
      regex = this.mappings.certifications.name;
    }

    if (!regex) return false;
    return regex.test(label) || regex.test(automationId);
  },

  _hasOtherFields(sectionType, currentCard) {
    if (!currentCard || currentCard.length === 0) return false;
    
    let otherRegexes = [];
    if (sectionType === 'experience') {
      otherRegexes = [
        this.mappings.experience.company,
        this.mappings.experience.location,
        this.mappings.experience.description,
        this.mappings.experience.start,
        this.mappings.experience.end
      ];
    } else if (sectionType === 'education') {
      otherRegexes = [
        this.mappings.education.degree,
        this.mappings.education.major,
        this.mappings.education.start,
        this.mappings.education.end
      ];
    } else if (sectionType === 'certifications') {
      otherRegexes = [
        this.mappings.certifications.number,
        this.mappings.certifications.issued,
        this.mappings.certifications.expires
      ];
    }

    return currentCard.some(el => {
      const label = (getFieldLabel(el) || '').trim();
      const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
      return otherRegexes.some(regex => regex && (regex.test(label) || regex.test(automationId)));
    });
  },

  _extractLocationFromResume(company, resumeText) {
    if (!company || !resumeText) return '';
    try {
      const escapedCompany = company.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`${escapedCompany}\\s*\\|[^|]*\\|\\s*([^|\\n]+)\\s*\\|`, 'i');
      const match = resumeText.match(regex);
      if (match && match[1]) {
        const loc = match[1].trim();
        if (loc.length < 50 && !/present|september|march|october|april|july/i.test(loc)) {
          return loc;
        }
      }
      
      const fallbackRegex = new RegExp(`${escapedCompany}\\s*\\|\\s*([^|\\n]+)\\s*\\|`, 'i');
      const fallbackMatch = resumeText.match(fallbackRegex);
      if (fallbackMatch && fallbackMatch[1]) {
        const loc = fallbackMatch[1].trim();
        if (loc.length < 50 && !/present|september|march|october|april|july/i.test(loc)) {
          return loc;
        }
      }
    } catch (e) {
      console.warn('[Workday Location Extract Error]', e);
    }
    return '';
  },

  _getSectionInputs(sectionType) {
    const { expHeader, eduHeader, certHeader, skillsHeader } = this._findHeaders();
    let startHeader = null;
    let endHeader = null;

    if (sectionType === 'experience') {
      startHeader = expHeader;
      endHeader = eduHeader || certHeader || skillsHeader;
    } else if (sectionType === 'education') {
      startHeader = eduHeader;
      endHeader = certHeader || skillsHeader;
    } else if (sectionType === 'certifications') {
      startHeader = certHeader;
      endHeader = skillsHeader;
    }

    if (!startHeader) {
      console.log(`[Workday Debug] _getSectionInputs: startHeader not found for sectionType="${sectionType}"`);
      return [];
    }

    const allInputs = FormFiller.querySelectorAllDeep(
      'input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea, select, [role="combobox"], [data-automation-id*="dropdown"], [data-automation-id*="select"]',
      document
    );

    const sectionInputs = [];
    allInputs.forEach(el => {
      // Exclude Clyde/autofill panel elements
      if (el.closest?.('#clyde-cover-letter-preview-panel, #job-autofill-panel, #job-autofill-container, [id^="clyde-"], [id^="job-autofill-"]')) {
        return;
      }

      // If this element contains any input, textarea, select, button, or [role="button"] inside it, skip it
      // as we want to target the actual input/button element, not its wrapper container.
      if (el.querySelector('input, textarea, select, button, [role="button"]')) {
        return;
      }

      if (startHeader) {
        const pos = startHeader.compareDocumentPosition(el);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      }
      if (endHeader) {
        const pos = el.compareDocumentPosition(endHeader);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      }

      if (!sectionInputs.some(existing => existing === el || existing.contains(el))) {
        sectionInputs.push(el);
      }
    });

    return sectionInputs;
  },

  _findFieldInContainer(container, regex) {
    const inputs = Array.isArray(container)
      ? container
      : FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select, button, [role="button"], [role="combobox"], [data-automation-id*="dropdown"], [data-automation-id*="select"]', container);
    
    const matched = inputs.find(el => {
      const label = getFieldLabel(el) || '';
      const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
      return regex.test(label) || regex.test(automationId);
    });

    if (!matched) {
      console.log(`[Workday Debug] _findFieldInContainer: regex ${regex} not matched in container. Scanning all candidate labels/automationIds:`);
      inputs.forEach(el => {
        const label = getFieldLabel(el) || '';
        const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
        console.log(`  -> candidate: tag=${el.tagName}, label="${label}", automationId="${automationId}"`);
      });
    }

    return matched;
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const clean = dateStr.trim().toLowerCase();
    if (/^(present|current|now|ongoing)$/i.test(clean)) {
      return '';
    }

    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    
    // Check if it's already MM/YYYY or similar
    const m = clean.match(/^(\d{1,2})[\/\s-](2\d{3})$/);
    if (m) {
      const month = m[1].padStart(2, '0');
      const year = m[2];
      return `${month}/${year}`;
    }

    // Check for YYYY-MM
    const m2 = clean.match(/^(2\d{3})[\/\s-](\d{1,2})$/);
    if (m2) {
      const year = m2[1];
      const month = m2[2].padStart(2, '0');
      return `${month}/${year}`;
    }

    // Check for Month YYYY or Mon YYYY
    const words = clean.split(/[\s,]+/);
    let year = '';
    let monthIdx = -1;

    for (const w of words) {
      if (/^2\d{3}$/.test(w)) {
        year = w;
      } else {
        const idx = months.findIndex(m => w.startsWith(m));
        if (idx !== -1) {
          monthIdx = idx;
        }
      }
    }

    if (year) {
      if (monthIdx !== -1) {
        const month = String(monthIdx + 1).padStart(2, '0');
        return `${month}/${year}`;
      } else {
        return `01/${year}`;
      }
    }

    return dateStr;
  },

  _isDateInputFor(el, isStart) {
    const labelRegex = isStart ? /from|start/i : /to|end|grad/i;
    
    // 1. Check direct label or automationId
    const label = getFieldLabel(el) || '';
    const automationId = el.getAttribute?.('data-automation-id') || '';
    if (labelRegex.test(label) || labelRegex.test(automationId)) {
      return true;
    }

    // 2. Traverse up ancestors to find a container with a legend/label or automationId matching the regex
    let parent = el.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 6) {
      const parentId = parent.getAttribute?.('data-automation-id') || '';
      if (labelRegex.test(parentId)) {
        return true;
      }
      
      const legend = parent.querySelector('legend, label, [class*="label"], [class*="legend"]');
      if (legend && legend !== el) {
        const legendText = legend.textContent || '';
        if (labelRegex.test(legendText)) {
          return true;
        }
      }
      
      parent = parent.parentElement;
      depth++;
    }

    return false;
  },

  async _fillCardDate(container, dateStr, isStart) {
    console.log(`[Workday Date Debug] _fillCardDate called: dateStr="${dateStr}", isStart=${isStart}`);
    if (!dateStr) {
      console.log(`[Workday Date Debug] Empty dateStr, skipping.`);
      return;
    }
    const formatted = this._formatDate(dateStr);
    console.log(`[Workday Date Debug] Normalised dateStr to: "${formatted}"`);
    if (!formatted) {
      console.log(`[Workday Date Debug] Normalisation returned empty string, skipping.`);
      return;
    }

    const parts = formatted.split('/');
    const monthVal = parts[0];
    const yearVal = parts[1];

    const inputs = Array.isArray(container)
      ? container
      : FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select, [role="combobox"]', container);

    console.log(`[Workday Date Debug] Container inputs count: ${inputs.length}. Filtering for ${isStart ? 'start' : 'end'} date inputs...`);
    let dateInputs = inputs.filter(el => {
      const match = this._isDateInputFor(el, isStart);
      console.log(`  -> candidate: tag=${el.tagName}, label="${getFieldLabel(el)}", automationId="${el.getAttribute?.('data-automation-id') || ''}", matched=${match}`);
      return match;
    });

    if (dateInputs.length === 0) {
      console.log(`[Workday Date Debug] _isDateInputFor returned 0 matches. Trying position-based fallback...`);
      const allDateInputs = inputs.filter(el => {
        const label = (getFieldLabel(el) || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const automationId = (el.getAttribute?.('data-automation-id') || '').toLowerCase();
        return label.includes('month') || label.includes('mm') || placeholder.includes('month') || placeholder.includes('mm') || automationId.includes('month') ||
               label.includes('year') || label.includes('yyyy') || placeholder.includes('year') || placeholder.includes('yyyy') || automationId.includes('year');
      });

      console.log(`[Workday Date Debug] Found ${allDateInputs.length} total date inputs in card:`, allDateInputs.map(el => getFieldLabel(el)));
      if (allDateInputs.length === 4) {
        dateInputs = isStart ? allDateInputs.slice(0, 2) : allDateInputs.slice(2, 4);
      } else if (allDateInputs.length === 2) {
        dateInputs = allDateInputs;
      }
    }

    if (dateInputs.length === 0) {
      console.warn(`[Workday] No date inputs found for ${isStart ? 'start' : 'end'} in card.`);
      return;
    }

    console.log(`[Workday Date Debug] Final date inputs for ${isStart ? 'start' : 'end'}:`, dateInputs.map(el => `label="${getFieldLabel(el)}"`));

    if (dateInputs.length === 1) {
      const el = dateInputs[0];
      const type = el.tagName.toLowerCase() === 'select' ? 'select' : (el.type || 'text');
      console.log(`[Workday Date Debug] Filling single date input with ${formatted}`);
      if (type === 'select') {
        await FormFiller.fillField(el, formatted, type, 'date', 'date');
      } else {
        await FormFiller.typeValueIncrementally(el, formatted);
      }
    } else {
      let monthInput = null;
      let yearInput = null;

      dateInputs.forEach(el => {
        const label = (getFieldLabel(el) || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
        const automationId = (el.getAttribute?.('data-automation-id') || '').toLowerCase();
        const closestAutoId = (el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const name = (el.name || '').toLowerCase();
        
        const isMonth = label.includes('month') || label.includes('mm') || 
                        placeholder.includes('month') || placeholder.includes('mm') || 
                        automationId.includes('month') || closestAutoId.includes('month') ||
                        id.includes('month') || name.includes('month');
                        
        const isYear = label.includes('year') || label.includes('yyyy') || 
                       placeholder.includes('year') || placeholder.includes('yyyy') || 
                       automationId.includes('year') || closestAutoId.includes('year') ||
                       id.includes('year') || name.includes('year');
        
        if (isMonth && !isYear) {
          monthInput = el;
        } else if (isYear && !isMonth) {
          yearInput = el;
        }
      });

      if ((!monthInput || !yearInput) && dateInputs.length >= 2) {
        console.log(`[Workday Date Debug] Could not distinguish both month and year. Using index fallback (0=month, 1=year).`);
        monthInput = dateInputs[0];
        yearInput = dateInputs[1];
      }

      if (monthInput) {
        const type = monthInput.tagName.toLowerCase() === 'select' ? 'select' : (monthInput.type || 'text');
        console.log(`[Workday Date Debug] Filling month input with: ${monthVal}`);
        if (type === 'select') {
          await FormFiller.fillField(monthInput, monthVal, type, 'month', 'month');
        } else {
          await FormFiller.typeValueIncrementally(monthInput, monthVal);
        }
        await FormFiller.delay(100);
      }
      if (yearInput) {
        const type = yearInput.tagName.toLowerCase() === 'select' ? 'select' : (yearInput.type || 'text');
        console.log(`[Workday Date Debug] Filling year input with: ${yearVal}`);
        if (type === 'select') {
          await FormFiller.fillField(yearInput, yearVal, type, 'year', 'year');
        } else {
          await FormFiller.typeValueIncrementally(yearInput, yearVal);
        }
        await FormFiller.delay(100);
      }
    }
  },

  async _fillCard(sectionType, card, record) {
    const mappings = this.mappings[sectionType];
    if (!mappings) return;

    for (const [key, regex] of Object.entries(mappings)) {
      if (key === 'start' || key === 'end') {
        const dateVal = key === 'start' 
          ? (record.startDate || '') 
          : (record.endDate || record.graduationDate || record.expirationDate || '');
        await this._fillCardDate(card, dateVal, key === 'start');
        continue;
      }

      const element = this._findFieldInContainer(card, regex);
      if (!element) {
        console.log(`[Workday Debug] Field "${key}" (regex: ${regex}) not found in card.`);
        continue;
      }

      let value = '';
      if (sectionType === 'experience') {
        if (key === 'title') value = record.role || record.title || '';
        else if (key === 'company') value = record.company || record.organization || '';
        else if (key === 'location') {
          value = record.location || '';
          if (!value && this._profileData) {
            const company = record.company || record.organization || '';
            const resumeText = this._profileData.resumeText || '';
            value = this._extractLocationFromResume(company, resumeText);
            if (!value) {
              const city = this._profileData.profile?.address?.city || '';
              const state = this._profileData.profile?.address?.state || '';
              if (city && state) {
                value = `${city}, ${state}`;
              } else if (city) {
                value = city;
              }
            }
            console.log(`[Workday Debug] Location field not in experience record. Extracted fallback value: "${value}"`);
          }
        }
        else if (key === 'description') value = Array.isArray(record.bullets) ? record.bullets.join('\n') : (record.description || '');
        else if (key === 'isCurrent') {
          const isCurrent = !record.endDate || /^(present|current|now)$/i.test(String(record.endDate).trim());
          value = isCurrent ? 'yes' : 'no';
        }
      } else if (sectionType === 'education') {
        if (key === 'school') value = record.org || record.institution || record.school || '';
        else if (key === 'degree') value = record.degree || '';
        else if (key === 'major') value = record.major || record.field || '';
      } else if (sectionType === 'certifications') {
        if (key === 'name') value = record.name || record.certification || '';
        else if (key === 'number') value = record.number || record.certificationNumber || '';
      }

      if (value !== undefined && value !== null && String(value).trim() !== '') {
        const type = element.tagName.toLowerCase() === 'select' ? 'select' : (element.type || 'text');
        console.log(`[Workday] Card field "${key}" matched: filling with "${value}"`);
        try {
          if (type === 'checkbox') {
            await FormFiller.fillCheckbox(element, value);
          } else {
            await FormFiller.fillField(element, value, type, key, key);
          }
        } catch (err) {
          console.error(`[Workday] Failed to fill "${key}" in card:`, err);
        }
        await FormFiller.delay(100);
      }
    }
  },

  _findHeaders() {
    const querySelectors = [
      'h1, h2, h3, h4, h5, h6, legend, .section-header, [class*="title"], [class*="header"]',
      'span, div, p, label'
    ];
    
    let expHeader = null;
    let eduHeader = null;
    let certHeader = null;
    let skillsHeader = null;

    for (const selector of querySelectors) {
      const headers = FormFiller.querySelectorAllDeep(selector, document);
      for (const h of headers) {
        const txt = (h.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (txt === 'my experience' || txt.length > 50) continue;

        // Clean text by stripping common suffixes like "(optional)"
        const cleanTxt = txt.replace(/\s*\(\s*optional\s*\)\s*$/i, '').trim();

        if ((/work\s+experience|^experience$|work\s+history/i.test(cleanTxt)) && !expHeader) {
          expHeader = h;
        } else if (/^education$/i.test(cleanTxt) && !eduHeader) {
          eduHeader = h;
        } else if (/^certifications?$/i.test(cleanTxt) && !certHeader) {
          certHeader = h;
        } else if (/^skills$|^skills\s+and\s+languages$|^skills\s+and\s+strengths$/i.test(cleanTxt) && !skillsHeader) {
          skillsHeader = h;
        }
      }
      if (expHeader && eduHeader && skillsHeader) break;
    }

    console.log('[Workday Debug] _findHeaders found:', {
      exp: expHeader ? `${expHeader.tagName} "${expHeader.textContent?.trim()}"` : 'null',
      edu: eduHeader ? `${eduHeader.tagName} "${eduHeader.textContent?.trim()}"` : 'null',
      cert: certHeader ? `${certHeader.tagName} "${certHeader.textContent?.trim()}"` : 'null',
      skills: skillsHeader ? `${skillsHeader.tagName} "${skillsHeader.textContent?.trim()}"` : 'null'
    });

    return { expHeader, eduHeader, certHeader, skillsHeader };
  },

  _getFieldsBySection(sectionType, labelRegex) {
    const { expHeader, eduHeader, certHeader } = this._findHeaders();
    
    let startHeader = null;
    let endHeader = null;

    if (sectionType === 'experience') {
      startHeader = expHeader;
      endHeader = eduHeader || certHeader;
    } else if (sectionType === 'education') {
      startHeader = eduHeader;
      endHeader = certHeader;
    } else if (sectionType === 'certifications') {
      startHeader = certHeader;
      endHeader = null;
    }

    if (!startHeader) {
      console.log(`[Workday Debug] Section "${sectionType}" start header not found on page. Returning 0 matched elements.`);
      return [];
    }

    console.log(`[Workday Debug] _getFieldsBySection: sectionType="${sectionType}", startHeader=${startHeader?.textContent?.trim()}, endHeader=${endHeader?.textContent?.trim()}`);

    const inputs = FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select, [data-automation-id*="dropdown"], [data-automation-id*="select"], [role="combobox"], [class*="select"]', document);
    console.log(`[Workday Debug] _getFieldsBySection: globally found ${inputs.length} candidate elements on the page.`);
    
    const matched = [];
    inputs.forEach((el, index) => {
      try {
        if (el.closest?.('#clyde-cover-letter-preview-panel, #job-autofill-panel, #job-autofill-container, [id^="clyde-"], [id^="job-autofill-"]')) {
          return;
        }

        if (startHeader) {
          const pos = startHeader.compareDocumentPosition(el);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
            return;
          }
        }

        if (endHeader) {
          const pos = el.compareDocumentPosition(endHeader);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
            return;
          }
        }

        const label = getFieldLabel(el) || '';
        const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
        const isMatch = labelRegex.test(label) || labelRegex.test(automationId);
        
        if (isMatch) {
          if (!matched.some(existing => existing === el || existing.contains(el))) {
            matched.push(el);
          }
        }
      } catch (err) {
        console.error(`[Workday Debug] Error scanning input:`, el, err);
      }
    });

    const filtered = matched.filter(el => {
      return !matched.some(other => other !== el && el.contains(other));
    });

    console.log(`[Workday Debug] _getFieldsBySection: returned ${filtered.length} matched element(s)`);
    return filtered;
  },

  _getAddButtonBySection(sectionType) {
    const { expHeader, eduHeader, certHeader } = this._findHeaders();
    
    let startHeader = null;
    let endHeader = null;

    if (sectionType === 'experience') {
      startHeader = expHeader;
      endHeader = eduHeader || certHeader;
    } else if (sectionType === 'education') {
      startHeader = eduHeader;
      endHeader = certHeader;
    } else if (sectionType === 'certifications') {
      startHeader = certHeader;
      endHeader = null;
    }

    if (!startHeader) {
      console.log(`[Workday Debug] _getAddButtonBySection: startHeader not found for sectionType="${sectionType}"`);
      return null;
    }

    const findButton = (selector) => {
      const elms = FormFiller.querySelectorAllDeep(selector, document);
      return elms.find(btn => {
        const txt = btn.textContent.trim().toLowerCase();
        const isAddTxt = txt === 'add' || txt === 'add another' || txt === '+ add' || txt === '+ add another';
        if (!isAddTxt) return false;

        if (startHeader) {
          const pos = startHeader.compareDocumentPosition(btn);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        }
        if (endHeader) {
          const pos = btn.compareDocumentPosition(endHeader);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        }
        return true;
      });
    };

    let addBtn = findButton('button, [role="button"], a');
    if (addBtn) {
      console.log(`[Workday Debug] _getAddButtonBySection: found semantic button:`, addBtn);
    } else {
      addBtn = findButton('span, div');
      if (addBtn) {
        console.log(`[Workday Debug] _getAddButtonBySection: found fallback element:`, addBtn);
      }
    }

    if (!addBtn) {
      console.log(`[Workday Debug] _getAddButtonBySection: no "Add" button found for sectionType="${sectionType}"`);
      return null;
    }

    const finalBtn = addBtn.querySelector?.('button, [role="button"], a') || 
                     addBtn.closest?.('button, [role="button"], a') || 
                     addBtn;

    console.log(`[Workday Debug] _getAddButtonBySection resolved to final click target: tag=${finalBtn.tagName}, class="${finalBtn.className}", outerHTML=${finalBtn.outerHTML.substring(0, 200)}`);
    return finalBtn;
  }
});
