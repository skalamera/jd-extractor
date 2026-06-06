/* SmartRecruiters OneClick-UI Portal Handler
 * Handles SmartRecruiters SPA with sf- custom elements (Shadow DOM),
 * multi-card Experience/Education sections, and "Present" date checkbox.
 */

PortalHandlers.register({
  name: 'SmartRecruiters',

  detect(url) {
    return /smartrecruiters\.com/i.test(url) ||
      !!document.querySelector('sf-root, sf-page, [class*="oneclick-ui"], [data-testid*="oneclick"]');
  },

  getFields() {
    const fields = [];
    const sfSelector = 'sf-input, sf-select, sf-textarea, sf-checkbox, sf-radio-group, sf-date-picker';

    this._findAllDeep(document, sfSelector).forEach(el => {
      if (el.offsetParent === null) return;
      const shadowRoot = el.shadowRoot;
      if (!shadowRoot) return;

      // Skip elements inside active editing cards — customFill handles those
      const closestCard = el.closest('sf-card');
      if (closestCard && closestCard.hasAttribute('edit-mode')) return;

      const input = shadowRoot.querySelector('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), select, textarea');
      if (!input) return;

      let label = '';
      const labelEl = shadowRoot.querySelector('label, [slot="label"], .label, [class*="label"], [part="label"]');
      if (labelEl) label = labelEl.textContent.trim();
      if (!label) label = el.getAttribute('aria-label') || el.getAttribute('label') || el.getAttribute('name') || '';

      const field = extractFieldInfo(input);
      if (field) {
        field.label = label || field.label;
        field.element = input;
        fields.push(field);
      }
    });

    // Also include native elements not inside sf-* wrappers (e.g. legacy fields)
    this._findAllDeep(document, 'input:not([type="hidden"]):not([type="submit"]):not([type="file"]), select, textarea').forEach(el => {
      if (el.offsetParent === null) return;
      // Skip if already captured via sf-* wrapper
      if (el.closest(sfSelector)) return;
      // Skip elements inside active sf-card edit mode
      const card = el.closest('sf-card');
      if (card && card.hasAttribute('edit-mode')) return;
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    return fields;
  },

  getJobDescription() {
    const selectors = [
      '[data-testid="job-description"]',
      '[class*="job-description"]',
      '.job-description',
      '[class*="description-content"]',
      '[class*="jd-content"]',
      '[class*="job-desc"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 20) return el.textContent.trim();
    }
    return '';
  },

  getJobInfo() {
    const title = document.querySelector('[data-testid="job-title"], .job-title, h1, [class*="page-title"]')?.textContent?.trim() || '';
    const company = document.querySelector('[data-testid="company-name"], [class*="company-name"], [class*="employer"]')?.textContent?.trim() || '';
    return { title, company };
  },

  /* ------------------------------------------------------------------ */
  /*  customFill: Multi-card Experience & Education workflow             */
  /*  Handles the full cycle per entry:                                  */
  /*    1. Click "+ Add"                                                 */
  /*    2. Wait for the card to render in edit mode                      */
  /*    3. Fill fields via Shadow DOM (double-write/dispatch)            */
  /*    4. Click Save                                                    */
  /*    5. Wait for card to commit                                       */
  /* ------------------------------------------------------------------ */
  async customFill(profileData) {
    const structured = profileData?.structured || {};
    const profile = profileData?.profile || {};
    const experience = structured.experience || profile.experience || [];
    const education = structured.education || profile.education || [];

    console.log(`[SmartRecruiters] customFill: ${experience.length} experience, ${education.length} education`);

    if (experience.length > 0) {
      await this._fillSection('experience', experience);
    }
    if (education.length > 0) {
      await this._fillSection('education', education);
    }
  },

  /* Internal helpers — prefixed with _ for clarity */

  /* Find a sf-section by its header text */
  _findSection(labelKeyword) {
    const sections = this._findAllDeep(document, 'sf-section');
    for (const sec of sections) {
      const header = sec.getAttribute('label') || sec.getAttribute('header') || '';
      const text = sec.textContent?.toLowerCase() || '';
      if (header.toLowerCase().includes(labelKeyword) || text.includes(labelKeyword)) {
        return sec;
      }
    }
    // Fallback 1: search by header elements deep inside shadow roots
    const headers = this._findAllDeep(document, 'h1, h2, h3, h4, h5, h6, .section-header, .section-title, [class*="section-header"], [class*="section-title"]');
    for (const hdr of headers) {
      if (hdr.textContent.toLowerCase().includes(labelKeyword)) {
        // Climb up crossing shadow root boundaries to find container
        let current = hdr;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const tag = current.tagName?.toLowerCase() || '';
            if (tag === 'sf-section' || tag.includes('card') || tag.includes('group') || current.classList?.contains('section') || current.id?.includes('section')) {
              return current;
            }
          }
          current = current.parentNode || current.host;
        }
        return hdr.parentElement;
      }
    }
    // Fallback 2: Universal text-based elements search deep inside shadow roots
    const all = this._findAllDeep(document, '*');
    for (const el of all) {
      const tag = el.tagName?.toLowerCase() || '';
      if (['script', 'style', 'svg', 'body', 'html', 'iframe', 'sf-root', 'sf-page'].includes(tag)) continue;

      const text = (el.textContent || '').trim().toLowerCase();
      if (text === labelKeyword || text === labelKeyword + '*' || text === labelKeyword + ':') {
        let current = el;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const currentTag = current.tagName?.toLowerCase() || '';
            if (currentTag === 'sf-section' || currentTag === 'sf-card-group' || currentTag.includes('section') || currentTag.includes('card') || currentTag.includes('group') || current.classList?.contains('section') || current.id?.includes('section')) {
              return current;
            }
          }
          current = current.parentNode || current.host;
        }
        return el.parentElement;
      }
    }
    return null;
  },

  /* Click a button inside a container that matches text content (handles Shadow DOM) */
  async _clickButtonIn(container, textMatcher) {
    // Search container itself and all shadow roots within
    const candidates = this._findAllDeep(container, 'button, [role="button"], sf-button, a[class*="btn"], [class*="button"]');
    for (const btn of candidates) {
      const btnText = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (textMatcher(btnText)) {
        console.log(`[SmartRecruiters] Clicking button "${btnText}"`);
        btn.click();
        return true;
      }
    }
    return false;
  },

  /* Deep search across Shadow DOM boundaries */
  _findAllDeep(container, selector) {
    const results = [];
    function walk(root) {
      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
      } catch (e) { /* cross-origin shadow roots might throw */ }
      const allChildren = root.querySelectorAll('*');
      for (const child of allChildren) {
        if (child.shadowRoot) walk(child.shadowRoot);
      }
    }
    walk(container);
    return results;
  },

  /* Find first matching element deep inside Shadow DOM */
  _findDeep(container, selector) {
    const all = this._findAllDeep(container, selector);
    return all.length > 0 ? all[0] : null;
  },

  /* Set input value with double-write/dispatch (essential for Shadow DOM SPA frameworks) */
  _setInputValue(input, value) {
    if (!input) return;
    const tag = input.tagName.toLowerCase();
    if (tag === 'select') {
      // Match option by text or value
      const options = Array.from(input.options);
      const match = options.find(o =>
        o.text.toLowerCase() === value.toLowerCase() ||
        o.value.toLowerCase() === value.toLowerCase()
      ) || options.find(o =>
        o.text.toLowerCase().includes(value.toLowerCase()) ||
        value.toLowerCase().includes(o.text.toLowerCase())
      );
      if (match) {
        input.value = match.value;
        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      }
      return;
    }
    // Double-write: set via native property descriptor for framework detection
    const nativeSetter = Object.getOwnPropertyDescriptor(
      input.constructor.prototype, 'value'
    ) || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(input, value);
    } else {
      input.value = value;
    }
    // Dispatch input + change with composed: true so shadow-piercing frameworks detect it
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
  },

  /* Find a labeled input deep inside a card's shadow DOM */
  _findCardField(card, labels) {
    // Try to find sf-* custom elements first
    const sfElements = this._findAllDeep(card, 'sf-input, sf-select, sf-textarea, sf-date-picker, sf-checkbox');
    for (const sfEl of sfElements) {
      const text = sfEl.textContent?.toLowerCase() || '';
      const attr = (sfEl.getAttribute('label') || sfEl.getAttribute('name') || '').toLowerCase();
      for (const label of labels) {
        if (text.includes(label) || attr.includes(label)) {
          // Get the actual input from shadow root
          if (sfEl.shadowRoot) {
            const input = sfEl.shadowRoot.querySelector('input:not([type="hidden"]), select, textarea');
            return input || sfEl;
          }
          return sfEl;
        }
      }
    }
    // Fallback: look for native input/select/textarea with matching name or placeholder
    const inputs = this._findAllDeep(card, 'input:not([type="hidden"]):not([type="submit"]), select, textarea');
    for (const inp of inputs) {
      const name = (inp.name || inp.placeholder || inp.id || '').toLowerCase();
      for (const label of labels) {
        if (name.includes(label)) return inp;
      }
    }
    return null;
  },

  /* Fill a date picker field inside a card */
  async _fillDateField(card, labels, dateText) {
    if (!dateText) return;
    const field = this._findCardField(card, labels);
    if (!field) return;
    // For sf-date-picker, the actual input is inside shadow root
    let input = field;
    if (field.tagName.toLowerCase() === 'sf-date-picker' && field.shadowRoot) {
      input = field.shadowRoot.querySelector('input[type="text"], input[type="date"]');
    }
    if (input.tagName.toLowerCase() === 'input') {
      this._setInputValue(input, dateText);
    }
  },

  /* Fill a text input field inside a card (sf-input or sf-textarea) */
  async _fillTextField(card, labels, value) {
    if (!value) return;
    const field = this._findCardField(card, labels);
    if (!field) return;
    let input = field;
    if (field.shadowRoot) {
      input = field.shadowRoot.querySelector('input:not([type="hidden"]), textarea') || field;
    }
    this._setInputValue(input, value);
  },

  /* Fill a dropdown/select field inside a card */
  async _fillSelectField(card, labels, value) {
    if (!value) return;
    const field = this._findCardField(card, labels.concat('select'));
    if (!field) return;
    let select = field;
    if (field.shadowRoot) {
      select = field.shadowRoot.querySelector('select') || field;
    }
    this._setInputValue(select, value);
  },

  /* Check/uncheck a checkbox inside a card (e.g. "Present" / "Currently working here") */
  async _handlePresentCheckbox(card, labels, shouldCheck) {
    if (!shouldCheck) return;
    // Look for sf-checkbox or native checkbox
    const cb = this._findCardField(card, labels);
    if (!cb) return;
    let checkbox = cb;
    if (cb.shadowRoot) {
      checkbox = cb.shadowRoot.querySelector('input[type="checkbox"]') || cb;
    }
    if (checkbox.tagName.toLowerCase() === 'input' && checkbox.type === 'checkbox') {
      if (!checkbox.checked) {
        checkbox.click();
      }
    } else {
      // Maybe it's a sf-checkbox itself — click to toggle on
      try { cb.click(); } catch (e) { }
    }
  },

  /* Fill all textarea fields from bullet points */
  async _fillDescriptionField(card, labels, bullets) {
    if (!bullets || bullets.length === 0) return;
    const text = bullets.join('\n');
    await this._fillTextField(card, labels, text);
  },

  /* ------------------------------------------------------------------ */
  /*  Fill a full section (experience or education) with multi-card loop */
  /* ------------------------------------------------------------------ */
  async _fillSection(sectionType, records) {
    const isExp = sectionType === 'experience';
    const sectionLabel = isExp ? 'experience' : 'education';
    const section = this._findSection(sectionLabel);
    if (!section) {
      console.log(`[SmartRecruiters] Section "${sectionLabel}" not found, skipping.`);
      return;
    }

    console.log(`[SmartRecruiters] Filling ${records.length} ${sectionType} entries...`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`[SmartRecruiters] Processing ${sectionType} entry ${i + 1}/${records.length}`);

      // Click "+ Add" / "Add Another" button inside this section
      const clicked = await this._clickButtonIn(section, text =>
        text === '+ add' || text === 'add' || text === '+add' ||
        text === 'add more' || text === 'add another' ||
        /^\+?\s*add(\s+(more|another|new|experience|education|position|entry|work|school))?\s*$/i.test(text)
      );

      if (!clicked) {
        console.log(`[SmartRecruiters] No "+ Add" button found in ${sectionLabel} section. Trying existing card.`);
        // Maybe the card is already open? Check if there's an editable card
      }

      await sleep(600); // Wait for card render

      // Find the active editing card (the one without saved/rendered data)
      const cards = section.querySelectorAll('sf-card');
      let activeCard = null;
      for (const card of cards) {
        if (card.hasAttribute('edit-mode') || card.getAttribute('mode') === 'edit') {
          activeCard = card;
          break;
        }
      }
      // Fallback: find the last card (might be the newest)
      if (!activeCard && cards.length > 0) {
        activeCard = cards[cards.length - 1];
      }
      if (!activeCard) {
        console.log(`[SmartRecruiters] No card found in ${sectionLabel} section, skipping entry.`);
        continue;
      }

      // Fill fields based on section type
      if (isExp) {
        await this._fillTextField(activeCard, ['employer', 'company', 'organization', 'org'], record.company || record.organization || '');
        await this._fillTextField(activeCard, ['job title', 'title', 'position', 'role'], record.role || record.title || '');
        await this._fillTextField(activeCard, ['location', 'city'], record.location || '');

        // Handle date range
        const period = record.period || '';
        const [startDate, endDate] = this._parseDateRange(period, record.startDate, record.endDate);
        await this._fillDateField(activeCard, ['start date', 'start', 'from', 'date from', 'begin'], startDate);

        // "Present" checkbox handling
        const isCurrent = this._isCurrentPosition(endDate, record.isCurrent);
        if (isCurrent) {
          await this._handlePresentCheckbox(activeCard, ['present', 'currently', 'current', 'still working', 'ongoing'], true);
        } else if (endDate) {
          await this._fillDateField(activeCard, ['end date', 'end', 'to', 'date to', 'until'], endDate);
        }

        await this._fillDescriptionField(activeCard, ['description', 'responsibilities', 'summary', 'details'], record.bullets || record.description || []);
      } else {
        // Education
        await this._fillTextField(activeCard, ['school', 'institution', 'university', 'college', 'organization', 'org'], record.org || record.institution || record.school || '');
        // Also try "name" as school name
        await this._fillTextField(activeCard, ['degree', 'qualification', 'certificate'], record.degree || record.qualification || '');
        await this._fillTextField(activeCard, ['field of study', 'major', 'discipline', 'subject', 'area of study'], record.major || record.field || '');

        const period = record.period || '';
        const [startDate, endDate] = this._parseDateRange(period, record.startDate, record.endDate);
        await this._fillDateField(activeCard, ['start date', 'start', 'from', 'begin'], startDate);
        if (endDate) {
          await this._fillDateField(activeCard, ['end date', 'end', 'to', 'until', 'graduation', 'graduated', 'year'], endDate);
        }

        await this._fillDescriptionField(activeCard, ['description', 'details', 'activities', 'notes'], record.bullets || record.description || []);
      }

      await sleep(200); // Let values settle

      // Click Save button inside this card
      const saveClicked = await this._clickButtonIn(activeCard, text =>
        text === 'save' || text === 'save & add' || text === 'add and save' || text === 'submit' || text === 'done'
      );
      if (!saveClicked) {
        // Try broader search in section
        await this._clickButtonIn(section, text =>
          text === 'save' || text === 'save & add' || text === 'add and save' || text === 'submit' || text === 'done'
        );
      }

      await sleep(800); // Wait for save/commit animation
    }

    console.log(`[SmartRecruiters] Finished filling ${records.length} ${sectionType} entries.`);
  },

  /* Parse a date range string into start and end dates */
  _parseDateRange(period, startDate, endDate) {
    if (startDate && endDate) return [startDate, endDate];
    if (period && (period.includes('–') || period.includes('-') || period.includes('to'))) {
      const parts = period.split(/[–\-–\s]+to\s+|–/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return [parts[0], parts[1]];
      }
      if (parts.length === 1) {
        // Could be "Present" with a start year
        if (period.toLowerCase().includes('present') || period.toLowerCase().includes('current')) {
          return [parts[0], ''];
        }
      }
    }
    if (period && !period.includes('-')) {
      // Single date or year — treat as end date (graduation year, etc.)
      return ['', period];
    }
    return ['', ''];
  },

  /* Determine if the position is current/present */
  _isCurrentPosition(endDate, isCurrent) {
    if (isCurrent === true || isCurrent === 'true') return true;
    if (!endDate) return false;
    const end = endDate.toLowerCase();
    return end.includes('present') || end.includes('current') || end.includes('now') || end.includes('ongoing');
  }
});

/* Simple delay helper (not exported, module-scoped) */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// AI Fallback Fill for any custom/empty fields inside the active card
const emptyFields = this._getEmptyFieldsInCard(activeCard);
if (emptyFields.length > 0) {
  console.log(`[SmartRecruiters] Found ${emptyFields.length} empty field(s) in active card. Filling via AI...`);
  const aiFieldData = emptyFields.map(f => ({
    id: f.id,
    label: f.label,
    fieldType: f.fieldType,
    options: f.options || null
  }));

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'FILL_FIELDS',
      payload: { fields: aiFieldData, jobDescription: '' }
    });
    if (result && result.answers) {
      for (const f of emptyFields) {
        const ans = result.answers[f.id];
        if (ans) {
          console.log(`[SmartRecruiters] AI answered empty card field "${f.label}": "${ans}"`);

          const isTypeahead = /typeahead|autocomplete|combobox|search/i.test(f.element.closest('sf-input, sf-select, sf-textarea')?.className || '') ||
            /typeahead|autocomplete|combobox|search/i.test(f.element.closest('sf-input, sf-select, sf-textarea')?.tagName || '') ||
            f.element.closest('.field, [class*="wrapper"]')?.querySelector('svg, .icon, [class*="search"]') != null;

          if (isTypeahead) {
            const isDate = /\b(date|from|to|year|calendar|month)\b/i.test(f.label.toLowerCase());
            if (isDate) {
              if (ans.toLowerCase() !== 'not provided') {
                this._setInputValue(f.element, ans);
              }
            } else {
              await FormFiller.pickTypeaheadOption(f.element, ans);
            }
          } else {
            this._setInputValue(f.element, ans);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[SmartRecruiters] AI card field filling failed:', err);
  }
}

await sleep(200);

// Click Save button inside this card
const saveClicked = await this._clickButtonIn(activeCard, text =>
  text === 'save' || text === 'save & add' || text === 'add and save' || text === 'submit' || text === 'done'
);
if (!saveClicked) {
  await this._clickButtonIn(section, text =>
    text === 'save' || text === 'save & add' || text === 'add and save' || text === 'submit' || text === 'done'
  );
}

await sleep(1000); // Wait for save/commit animation
    }

console.log(`[SmartRecruiters] Finished filling ${records.length} ${sectionType} entries.`);
  },

/* Parse a date range string into start and end dates */
_parseDateRange(period, startDate, endDate) {
  if (startDate && endDate) return [startDate, endDate];
  if (period && (period.includes('–') || period.includes('-') || period.includes('to'))) {
    const parts = period.split(/[–\-–\s]+to\s+|–/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return [parts[0], parts[1]];
    }
    if (parts.length === 1) {
      // Could be "Present" with a start year
      if (period.toLowerCase().includes('present') || period.toLowerCase().includes('current')) {
        return [parts[0], ''];
      }
    }
  }
  if (period && !period.includes('-')) {
    // Single date or year — treat as end date (graduation year, etc.)
    return ['', period];
  }
  return ['', ''];
},

/* Determine if the position is current/present */
_isCurrentPosition(endDate, isCurrent) {
  if (isCurrent === true || isCurrent === 'true') return true;
  if (!endDate) return false;
  const end = endDate.toLowerCase();
  return end.includes('present') || end.includes('current') || end.includes('now') || end.includes('ongoing');
}
});

/* Simple delay helper (not exported, module-scoped) */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
