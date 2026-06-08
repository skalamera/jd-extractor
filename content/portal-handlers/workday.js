PortalHandlers.register({
  name: 'Workday',

  detect(url) {
    return /myworkdayjobs\.com|workday\.com\/.*\/job/i.test(url) ||
      !!document.querySelector('[data-automation-id]');
  },

  getFields() {
    const fields = [];

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
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Custom dropdowns (Workday uses div-based dropdowns)
    document.querySelectorAll('[data-automation-id*="dropdown"], [data-automation-id*="select"]').forEach(el => {
      if (processed.has(el)) return;
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

  async customFill(profileData) {
    console.log('[Workday Debug] customFill started with Linear Sectioning!');
    const structured = profileData?.structured || {};
    const profile = profileData?.profile || {};
    const experience = structured.experience || profile.experience || [];
    const education = structured.education || profile.education || [];
    const certifications = structured.certifications || profile.certifications || [];

    console.log('[Workday Debug] Raw profileData.profile:', JSON.stringify(profile, null, 2));
    console.log('[Workday Debug] Raw profileData.structured:', JSON.stringify(structured, null, 2));
    console.log(`[Workday] customFill running: ${experience.length} experiences, ${education.length} education entries, ${certifications.length} certifications`);

    if (experience.length > 0) {
      await this._fillSection('experience', experience, {
        title: /job\s*title|title|position|role/i,
        company: /company|employer|organization|employer\s*name/i,
        location: /location|city|town/i,
        isCurrent: /currently|current|present|still\s*work/i,
        start: /from|start\s*date/i,
        end: /to|end\s*date/i,
        description: /description|responsibilities|summary/i
      });
    } else {
      console.log('[Workday Debug] No experience records found to fill.');
    }

    if (education.length > 0) {
      await this._fillSection('education', education, {
        school: /school|university|college|institution/i,
        degree: /degree|qualification/i,
        major: /field\s*of\s*study|major|discipline|subject/i,
        start: /from|start\s*date/i,
        end: /to|end\s*date|graduation|graduated/i
      });
    } else {
      console.log('[Workday Debug] No education records found to fill.');
    }

    if (certifications.length > 0) {
      await this._fillSection('certifications', certifications, {
        name: /certification\s*name|certification|license/i,
        number: /certification\s*number|license\s*number/i,
        issued: /issued|start\s*date|date\s*issued/i,
        expires: /expiration|expires|end\s*date/i
      });
    } else {
      console.log('[Workday Debug] No certification records found to fill.');
    }
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

  async _fillSection(sectionType, records, fieldMappings) {
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

    const firstFieldRegex = Object.values(fieldMappings)[0];
    let currentInputs = this._getFieldsBySection(sectionType, firstFieldRegex);
    console.log(`[Workday] Currently found ${currentInputs.length} entries for "${sectionType}". Target is ${records.length}.`);

    // Add card rows if we need more
    const targetCount = records.length;
    if (currentInputs.length < targetCount) {
      const addBtn = this._getAddButtonBySection(sectionType);

      if (addBtn) {
        const needed = targetCount - currentInputs.length;
        console.log(`[Workday] Clicking "Add Another" button ${needed} times to match records...`);
        for (let k = 0; k < needed; k++) {
          try {
            console.log(`[Workday Debug] Triggering framework-safe click on "Add Another" button, click count=${k+1}`);
            await this._safeClick(addBtn);
            await FormFiller.delay(1200); // Wait for dynamic React card injection and animation
          } catch (e) {
            console.warn(`[Workday] Click failed on "Add Another" button:`, e);
          }
        }
        // Re-query inputs
        currentInputs = this._getFieldsBySection(sectionType, firstFieldRegex);
        console.log(`[Workday] After expansion, found ${currentInputs.length} entries for "${sectionType}".`);
      } else {
        console.warn(`[Workday] "Add Another" button NOT found for section "${sectionType}"`);
      }
    }

    // Process card-by-card deterministically
    const finalCount = Math.min(currentInputs.length, records.length);
    console.log(`[Workday Debug] Proceeding to fill ${finalCount} card(s) for ${sectionType}`);
    for (let i = 0; i < finalCount; i++) {
      const record = records[i];
      console.log(`[Workday] Filling "${sectionType}" card index ${i + 1}/${finalCount}...`, record);

      for (const [key, regex] of Object.entries(fieldMappings)) {
        const allFields = this._getFieldsBySection(sectionType, regex);
        const element = allFields[i];
        if (!element) {
          console.warn(`[Workday] Field "${key}" at card index ${i} NOT found!`);
          continue;
        }

        let value = '';
        if (sectionType === 'experience') {
          if (key === 'title') value = record.role || record.title || '';
          else if (key === 'company') value = record.company || record.organization || '';
          else if (key === 'location') value = record.location || '';
          else if (key === 'description') value = Array.isArray(record.bullets) ? record.bullets.join('\n') : (record.description || '');
          else if (key === 'start') value = record.startDate || '';
          else if (key === 'end') value = record.endDate || '';
          else if (key === 'isCurrent') {
            const isCurrent = !record.endDate || /^(present|current|now)$/i.test(String(record.endDate).trim());
            value = isCurrent ? 'yes' : 'no';
          }
        } else if (sectionType === 'education') {
          if (key === 'school') value = record.org || record.institution || record.school || '';
          else if (key === 'degree') value = record.degree || '';
          else if (key === 'major') value = record.major || record.field || '';
          else if (key === 'start') value = record.startDate || '';
          else if (key === 'end') value = record.endDate || record.graduationDate || '';
        } else if (sectionType === 'certifications') {
          if (key === 'name') value = record.name || record.certification || '';
          else if (key === 'number') value = record.number || record.certificationNumber || '';
          else if (key === 'issued') value = record.issuedDate || record.startDate || '';
          else if (key === 'expires') value = record.expirationDate || record.endDate || '';
        }

        if (value !== undefined && value !== null && String(value).trim() !== '') {
          const type = element.tagName.toLowerCase() === 'select' ? 'select' : (element.type || 'text');
          console.log(`[Workday] Card ${i + 1}: filling "${key}" with "${value}"`);
          try {
            await FormFiller.fillField(element, value, type, key, key);
            console.log(`[Workday] Card ${i + 1}: successfully filled "${key}"`);
          } catch (err) {
            console.error(`[Workday] Card ${i + 1}: failed to fill "${key}" with error:`, err);
          }
          await FormFiller.delay(100);
        } else {
          console.log(`[Workday Debug] Skipping empty/missing value for card ${i + 1} field "${key}"`);
        }
      }
    }
    console.log(`[Workday Debug] _fillSection completed for: ${sectionType}`);
  },

  _findHeaders() {
    const querySelectors = [
      'h1, h2, h3, h4, h5, h6, legend, .section-header, [class*="title"], [class*="header"]',
      'span, div, p, label'
    ];
    
    let expHeader = null;
    let eduHeader = null;
    let certHeader = null;

    for (const selector of querySelectors) {
      const headers = FormFiller.querySelectorAllDeep(selector, document);
      for (const h of headers) {
        const txt = (h.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        // Skip page titles and overlong containers
        if (txt === 'my experience' || txt.length > 40) continue;

        if (/work\s+experience|^experience$/i.test(txt) && !expHeader) {
          expHeader = h;
        } else if (/^education$/i.test(txt) && !eduHeader) {
          eduHeader = h;
        } else if (/^certifications?$/i.test(txt) && !certHeader) {
          certHeader = h;
        }
      }
      // If we've successfully mapped the core headers, we can break early
      if (expHeader && eduHeader) break;
    }

    console.log('[Workday Debug] _findHeaders found:', {
      exp: expHeader ? `${expHeader.tagName} "${expHeader.textContent?.trim()}"` : 'null',
      edu: eduHeader ? `${eduHeader.tagName} "${eduHeader.textContent?.trim()}"` : 'null',
      cert: certHeader ? `${certHeader.tagName} "${certHeader.textContent?.trim()}"` : 'null'
    });

    return { expHeader, eduHeader, certHeader };
  },

  _getFieldsBySection(sectionType, labelRegex) {
    const { expHeader, eduHeader, certHeader } = this._findHeaders();
    
    // Determine the boundaries of this section
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

    // Safety check: if startHeader is not found, return empty array immediately
    if (!startHeader) {
      console.log(`[Workday Debug] Section "${sectionType}" start header not found on page. Returning 0 matched elements.`);
      return [];
    }

    console.log(`[Workday Debug] _getFieldsBySection: sectionType="${sectionType}", startHeader=${startHeader?.textContent?.trim()}, endHeader=${endHeader?.textContent?.trim()}`);

    // Query all inputs globally
    const inputs = FormFiller.querySelectorAllDeep('input:not([type="hidden"]), textarea, select, [data-automation-id*="dropdown"], [data-automation-id*="select"], [role="combobox"], [class*="select"]', document);
    console.log(`[Workday Debug] _getFieldsBySection: globally found ${inputs.length} candidate elements on the page.`);
    
    const matched = [];
    inputs.forEach(el => {
      try {
        if (el.closest?.('#clyde-cover-letter-preview-panel, #job-autofill-panel, #job-autofill-container, [id^="clyde-"], [id^="job-autofill-"]')) {
          return;
        }

        // Check if the element is after startHeader (if startHeader exists)
        if (startHeader) {
          const pos = startHeader.compareDocumentPosition(el);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        }

        // Check if the element is before endHeader (if endHeader exists)
        if (endHeader) {
          const pos = el.compareDocumentPosition(endHeader);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        }

        const label = getFieldLabel(el) || '';
        const automationId = el.closest?.('[data-automation-id]')?.getAttribute?.('data-automation-id') || '';
        const isMatch = labelRegex.test(label) || labelRegex.test(automationId);
        
        console.log(`[Workday Debug]   - Element tag=${el.tagName}, label="${label}", automationId="${automationId}", matched=${isMatch}`);
        if (isMatch) {
          if (!matched.some(existing => existing === el || existing.contains(el))) {
            matched.push(el);
          }
        }
      } catch (err) {
        console.error(`[Workday Debug] Error scanning input:`, el, err);
      }
    });

    // Return only leaf-level inputs (filter out parents/containers)
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

    if (!startHeader) return null;

    const buttons = FormFiller.querySelectorAllDeep('button, [role="button"], a, span, div', document);
    const addBtn = buttons.find(btn => {
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

    console.log(`[Workday Debug] _getAddButtonBySection: sectionType="${sectionType}" found addBtn text="${addBtn?.textContent?.trim()}"`);
    return addBtn;
  }
});
