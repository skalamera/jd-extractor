/* SmartRecruiters OneClick-UI Portal Handler for Clyde Apply
 * Handles SmartRecruiters SPA with sf- custom elements (Shadow DOM),
 * multi-card Experience/Education sections, and "Present" date checkbox.
 */

PortalHandlers.register({
  name: 'SmartRecruiters',

  detect(url) {
    return /smartrecruiters\.com/i.test(url) ||
      !!document.querySelector('sf-root, sf-page, spl-root, spl-page, [class*="oneclick-ui"], [data-testid*="oneclick"]');
  },

  getFields() {
    const fields = [];
    const sfSelector = 'sf-input, sf-select, sf-textarea, sf-checkbox, sf-radio-group, sf-date-picker';

    this._findAllDeep(document, sfSelector).forEach(el => {
      if (el.offsetParent === null) return;
      const shadowRoot = el.shadowRoot;
      if (!shadowRoot) return;

      // Skip elements inside active editing cards — customFill handles those
      const closestCard = el.closest('sf-card, spl-card, oc-experience-entry, oc-experience-edit-form, oc-education-entry, oc-education-edit-form');
      if (closestCard && (closestCard.hasAttribute('edit-mode') || closestCard.getAttribute('mode') === 'edit' || closestCard.tagName.toLowerCase().includes('edit-form'))) return;

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

    // Native elements not inside sf-*/spl-* wrappers
    this._findAllDeep(document, 'input:not([type="hidden"]):not([type="submit"]):not([type="file"]), select, textarea').forEach(el => {
      if (el.offsetParent === null) return;
      // Skip if already captured via sf-* wrapper
      if (el.closest(sfSelector)) return;

      const card = el.closest('sf-card, spl-card, oc-experience-entry, oc-experience-edit-form, oc-education-entry, oc-education-edit-form');
      if (card && (card.hasAttribute('edit-mode') || card.getAttribute('mode') === 'edit' || card.tagName.toLowerCase().includes('edit-form'))) return;

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

  _findSection(labelKeyword) {
    console.log(`[SmartRecruiters] _findSection looking for: "${labelKeyword}"`);
    const sections = this._findAllDeep(document, 'sf-section, spl-section, sf-card-group, spl-card-group');
    console.log(`[SmartRecruiters] _findSection found ${sections.length} section elements`);
    for (const sec of sections) {
      const header = sec.getAttribute('label') || sec.getAttribute('header') || '';
      const text = sec.textContent?.toLowerCase() || '';
      if (header.toLowerCase().includes(labelKeyword) || text.includes(labelKeyword)) {
        console.log(`[SmartRecruiters] Found section matching "${labelKeyword}" by header/text:`, sec);
        return sec;
      }
    }
    const headers = this._findAllDeep(document, 'h1, h2, h3, h4, h5, h6, .section-header, .section-title, [class*="section-header"], [class*="section-title"]');
    for (const hdr of headers) {
      if (hdr.textContent.toLowerCase().includes(labelKeyword)) {
        let current = hdr;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const tag = current.tagName?.toLowerCase() || '';
            if (tag === 'sf-section' || tag === 'spl-section' || tag === 'sf-card-group' || tag === 'spl-card-group' || tag.includes('section') || tag.includes('card') || tag.includes('group') || current.classList?.contains('section') || current.id?.includes('section')) {
              console.log(`[SmartRecruiters] Found section matching "${labelKeyword}" by header parent:`, current);
              return current;
            }
          }
          current = current.parentNode || current.host;
        }
        const parent = hdr.parentElement;
        if (parent && parent.querySelector('button, spl-button, sf-button, [role="button"]')) {
          console.log(`[SmartRecruiters] Found header row containing button, returning its parent:`, parent.parentElement);
          return parent.parentElement;
        }
        console.log(`[SmartRecruiters] Found section matching "${labelKeyword}" by header parentElement:`, hdr.parentElement);
        return hdr.parentElement;
      }
    }
    const all = this._findAllDeep(document, '*');
    for (const el of all) {
      const tag = el.tagName?.toLowerCase() || '';
      if (['script', 'style', 'svg', 'body', 'html', 'iframe', 'sf-root', 'sf-page', 'spl-root', 'spl-page'].includes(tag)) continue;

      const text = (el.textContent || '').trim().toLowerCase();
      if (text === labelKeyword || text === labelKeyword + '*' || text === labelKeyword + ':') {
        let current = el;
        while (current) {
          if (current.nodeType === Node.ELEMENT_NODE) {
            const currentTag = current.tagName?.toLowerCase() || '';
            if (currentTag === 'sf-section' || currentTag === 'spl-section' || currentTag === 'sf-card-group' || currentTag === 'spl-card-group' || currentTag.includes('section') || currentTag.includes('card') || currentTag.includes('group') || current.classList?.contains('section') || current.id?.includes('section')) {
              console.log(`[SmartRecruiters] Found section matching "${labelKeyword}" by text parent:`, current);
              return current;
            }
          }
          current = current.parentNode || current.host;
        }
        const parent = el.parentElement;
        if (parent && parent.querySelector('button, spl-button, sf-button, [role="button"]')) {
          console.log(`[SmartRecruiters] Found header row containing button, returning its parent:`, parent.parentElement);
          return parent.parentElement;
        }
        console.log(`[SmartRecruiters] Found section matching "${labelKeyword}" by text parentElement:`, el.parentElement);
        return el.parentElement;
      }
    }
    console.log(`[SmartRecruiters] Section matching "${labelKeyword}" NOT found.`);
    return null;
  },

  async _clickButtonIn(container, textMatcher) {
    const candidates = this._findAllDeep(container, 'button, [role="button"], sf-button, spl-button, a[class*="btn"], [class*="button"]');
    console.log(`[SmartRecruiters] _clickButtonIn found ${candidates.length} candidates in container:`, container);
    for (const btn of candidates) {
      let btnText = (btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!btnText) {
        const host = btn.getRootNode()?.host;
        if (host) {
          btnText = (host.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          console.log(`[SmartRecruiters]     Retrieved text from shadow host (${host.tagName}): "${btnText}"`);
        }
      }
      console.log(`[SmartRecruiters]   Candidate button: tag=${btn.tagName}, text="${btnText}", outerHTML=${btn.outerHTML?.substring(0, 100)}`);
      if (textMatcher(btnText)) {
        console.log(`[SmartRecruiters] Clicking button "${btnText}"`);
        btn.click();
        return true;
      }
    }
    console.log(`[SmartRecruiters] No matching button found in container.`);
    return false;
  },

  _findAllDeep(container, selector) {
    const results = [];
    function walk(root) {
      if (!root) return;
      try {
        results.push(...Array.from(root.querySelectorAll(selector)));
      } catch (e) { }
      if (root.shadowRoot) {
        walk(root.shadowRoot);
      }
      try {
        const allChildren = root.querySelectorAll('*');
        for (const child of allChildren) {
          if (child.shadowRoot) walk(child.shadowRoot);
        }
      } catch (e) { }
    }
    walk(container);
    return results;
  },

  _findDeep(container, selector) {
    const all = this._findAllDeep(container, selector);
    return all.length > 0 ? all[0] : null;
  },

  _setInputValue(input, value) {
    if (!input) return;
    const tag = input.tagName.toLowerCase();
    if (tag === 'select') {
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
    const nativeSetter = Object.getOwnPropertyDescriptor(
      input.constructor.prototype, 'value'
    ) || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    try {
      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(input, value);
      } else {
        input.value = value;
      }
    } catch (e) {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
  },

  _findCardField(card, labels) {
    const allElements = this._findAllDeep(card, '*');
    const sfElements = allElements.filter(el => {
      const tag = el.tagName.toLowerCase();
      return tag.startsWith('sf-') || tag.startsWith('spl-');
    });
    for (const sfEl of sfElements) {
      const text = sfEl.textContent?.toLowerCase() || '';
      const attr = (sfEl.getAttribute('label') || sfEl.getAttribute('name') || '').toLowerCase();
      for (const label of labels) {
        if (text.includes(label) || attr.includes(label)) {
          // Perform a deep search for native inputs inside the shadow DOM hierarchy of the component
          const input = this._findDeep(sfEl, 'input:not([type="hidden"]), select, textarea');
          return input || sfEl;
        }
      }
    }
    const inputs = this._findAllDeep(card, 'input:not([type="hidden"]):not([type="submit"]), select, textarea');
    for (const inp of inputs) {
      const name = (inp.name || inp.placeholder || inp.id || '').toLowerCase();
      for (const label of labels) {
        if (name.includes(label)) return inp;
      }
    }
    return null;
  },

  _parseDateToDateObject(dateStr) {
    if (!dateStr) return null;
    const clean = String(dateStr).trim();
    if (!clean) return null;

    // Try parsing YYYY-MM or YYYY-MM-DD
    const ymdMatch = clean.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = ymdMatch[3] ? parseInt(ymdMatch[3], 10) : 1;
      return new Date(year, month, day);
    }

    // Try parsing MM/YYYY or MM-YYYY
    const myMatch = clean.match(/^(\d{1,2})[-/](\d{4})$/);
    if (myMatch) {
      const month = parseInt(myMatch[1], 10) - 1;
      const year = parseInt(myMatch[2], 10);
      return new Date(year, month, 1);
    }

    // Try parsing Month YYYY (e.g. "January 2020" or "Jan 2020")
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const words = clean.toLowerCase().split(/[\s,]+/);
    if (words.length >= 2) {
      let monthIndex = -1;
      let year = -1;
      for (const w of words) {
        const parsedInt = parseInt(w, 10);
        if (parsedInt > 1900 && parsedInt < 2100) {
          year = parsedInt;
        } else {
          const mIdx = months.findIndex(m => w.startsWith(m));
          if (mIdx !== -1) {
            monthIndex = mIdx;
          }
        }
      }
      if (year !== -1 && monthIndex !== -1) {
        return new Date(year, monthIndex, 1);
      }
    }

    // Fallback to native constructor
    const nativeDate = new Date(clean);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate;
    }

    return null;
  },

  async _fillDateField(card, labels, dateText) {
    if (!dateText) return;
    const field = this._findCardField(card, labels);
    console.log(`[SmartRecruiters] _fillDateField looking for [${labels.join(', ')}], found:`, field);
    if (!field) return;
    let input = field;
    if (input.tagName.toLowerCase() !== 'input') {
      input = this._findDeep(field, 'input[type="text"], input[type="date"], input') || field;
      console.log(`[SmartRecruiters]   Resolved custom date element to native input:`, input);
    }
    if (input.tagName.toLowerCase() === 'input') {
      const dateObj = this._parseDateToDateObject(dateText);
      let fp = null;
      let curr = input;
      while (curr) {
        if (curr._flatpickr) {
          fp = curr._flatpickr;
          break;
        }
        curr = curr.parentNode || curr.host;
      }

      if (fp && typeof fp.setDate === 'function') {
        console.log(`[SmartRecruiters]   Found flatpickr instance. Setting date via flatpickr:`, dateObj || dateText);
        try {
          fp.setDate(dateObj || dateText, true);
        } catch (e) {
          console.error(`[SmartRecruiters]   Failed to set date via flatpickr:`, e);
          this._setInputValue(input, dateText);
        }
      } else {
        this._setInputValue(input, dateText);
      }

      // Propagate events up the shadow/DOM hierarchy to trigger Angular FormControl updates
      let parent = input;
      while (parent && parent !== card) {
        parent.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
        parent.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
        parent = parent.parentNode || parent.host;
      }
    }
  },

  async _fillTextField(card, labels, value) {
    if (!value) return;
    const field = this._findCardField(card, labels);
    console.log(`[SmartRecruiters] _fillTextField looking for [${labels.join(', ')}], found:`, field);
    if (!field) return;
    let input = field;
    if (input.tagName.toLowerCase() !== 'input' && input.tagName.toLowerCase() !== 'textarea') {
      input = this._findDeep(field, 'input:not([type="hidden"]), textarea') || field;
      console.log(`[SmartRecruiters]   Resolved custom text element to native input:`, input);
    }
    this._setInputValue(input, value);

    const isLocation = labels.some(l => l.includes('location') || l.includes('city'));
    if (isLocation && input && input.tagName.toLowerCase() === 'input') {
      console.log(`[SmartRecruiters] Location field detected. Simulating autocomplete selection...`);
      try {
        input.focus();
      } catch (e) {}
      await sleep(600);
      
      const fireKey = (el, key, code, keyCode) => {
        const createEvent = (type) => {
          const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, view: window });
          Object.defineProperty(ev, 'keyCode', { value: keyCode });
          Object.defineProperty(ev, 'which', { value: keyCode });
          return ev;
        };
        el.dispatchEvent(createEvent('keydown'));
        el.dispatchEvent(createEvent('keyup'));
      };

      fireKey(input, 'ArrowDown', 'ArrowDown', 40);
      await sleep(300);
      fireKey(input, 'Enter', 'Enter', 13);
    }
  },

  async _fillSelectField(card, labels, value) {
    if (!value) return;
    const field = this._findCardField(card, labels.concat('select'));
    console.log(`[SmartRecruiters] _fillSelectField looking for [${labels.join(', ')}], found:`, field);
    if (!field) return;
    let select = field;
    if (select.tagName.toLowerCase() !== 'select') {
      select = this._findDeep(field, 'select') || field;
      console.log(`[SmartRecruiters]   Resolved custom select element to native select:`, select);
    }
    this._setInputValue(select, value);
  },

  async _handlePresentCheckbox(card, labels, shouldCheck) {
    const cb = this._findCardField(card, labels);
    if (!cb) return;
    let checkbox = cb;
    if (cb.shadowRoot) {
      checkbox = cb.shadowRoot.querySelector('input[type="checkbox"]') || cb;
    }
    if (checkbox.tagName.toLowerCase() === 'input' && checkbox.type === 'checkbox') {
      if (checkbox.checked !== !!shouldCheck) {
        checkbox.click();
      }
    } else {
      const isChecked = cb.hasAttribute('checked') || cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('checked');
      if (isChecked !== !!shouldCheck) {
        try { cb.click(); } catch (e) { }
      }
    }
  },

  async _fillDescriptionField(card, labels, bullets) {
    if (!bullets || bullets.length === 0) return;
    const text = Array.isArray(bullets) ? bullets.join('\n') : String(bullets);
    await this._fillTextField(card, labels, text);
  },

  async _fillSection(sectionType, records) {
    const isExp = sectionType === 'experience';
    const sectionLabel = isExp ? 'experience' : 'education';
    const section = this._findSection(sectionLabel);
    if (!section) {
      console.log(`[SmartRecruiters] Section "${sectionLabel}" not found, skipping.`);
      return;
    }

    console.log(`[SmartRecruiters] Section element for ${sectionLabel}:`, section);
    console.log(`[SmartRecruiters] Filling ${records.length} ${sectionType} entries...`);

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`[SmartRecruiters] Processing ${sectionType} entry ${i + 1}/${records.length}`);

      const clicked = await this._clickButtonIn(section, text =>
        text === '+ add' || text === 'add' || text === '+add' ||
        text === 'add more' || text === 'add another' ||
        /^\+?\s*add(\s+(more|another|new|experience|education|position|entry|work|school))?\s*$/i.test(text)
      );
      console.log(`[SmartRecruiters] Clicked status: ${clicked}`);

      // Wait for the new edit card to appear and be active
      let activeCard = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(300);
        const cards = this._findAllDeep(section, 'sf-card, spl-card, oc-experience-entry, oc-experience-edit-form, oc-education-entry, oc-education-edit-form');
        
        // 1. Look for explicit edit forms
        for (const card of cards) {
          const tag = card.tagName.toLowerCase();
          if (tag.includes('edit-form') || tag.includes('edit-card') || card.hasAttribute('edit-mode') || card.getAttribute('mode') === 'edit') {
            activeCard = card;
            break;
          }
        }
        if (activeCard) break;

        // 2. If not found, look for any card that contains inputs
        for (const card of cards) {
          const inputs = this._findAllDeep(card, 'input, select, textarea');
          if (inputs.length > 0) {
            activeCard = card;
            break;
          }
        }
        if (activeCard) break;

        console.log(`[SmartRecruiters] Waiting for edit card to appear... (attempt ${attempt + 1}/10)`);
      }

      console.log(`[SmartRecruiters] activeCard selection:`, activeCard);
      if (!activeCard) {
        console.log(`[SmartRecruiters] No active edit card found in ${sectionLabel} section, skipping entry.`);
        continue;
      }

      if (isExp) {
        await this._fillTextField(activeCard, ['employer', 'company', 'organization', 'org'], record.company || record.organization || '');
        await this._fillTextField(activeCard, ['job title', 'title', 'position', 'role'], record.role || record.title || '');
        await this._fillTextField(activeCard, ['location', 'city'], record.location || '');

        const period = record.period || '';
        const [startDate, endDate] = this._parseDateRange(period, record.startDate, record.endDate);
        await this._fillDateField(activeCard, ['start date', 'start', 'from', 'date from', 'begin'], startDate);

        const isCurrent = this._isCurrentPosition(endDate, record.isCurrent);
        if (isCurrent) {
          await this._handlePresentCheckbox(activeCard, ['present', 'currently', 'current', 'still working', 'ongoing'], true);
        } else {
          await this._handlePresentCheckbox(activeCard, ['present', 'currently', 'current', 'still working', 'ongoing'], false);
          if (endDate) {
            await this._fillDateField(activeCard, ['end date', 'end', 'to', 'date to', 'until'], endDate);
          }
        }

        await this._fillDescriptionField(activeCard, ['description', 'responsibilities', 'summary', 'details'], record.bullets || record.description || []);
      } else {
        await this._fillTextField(activeCard, ['school', 'institution', 'university', 'college', 'organization', 'org'], record.org || record.institution || record.school || '');
        await this._fillTextField(activeCard, ['degree', 'qualification', 'certificate'], record.degree || record.qualification || '');
        await this._fillTextField(activeCard, ['field of study', 'major', 'discipline', 'subject', 'area of study'], record.major || record.field || '');

        const period = record.period || '';
        // FIX: Check both record.endDate and record.graduationDate
        const [startDate, endDate] = this._parseDateRange(period, record.startDate, record.endDate || record.graduationDate);
        await this._fillDateField(activeCard, ['start date', 'start', 'from', 'begin'], startDate);
        if (endDate) {
          await this._fillDateField(activeCard, ['end date', 'end', 'to', 'until', 'graduation', 'graduated', 'year'], endDate);
        }

        await this._fillDescriptionField(activeCard, ['description', 'details', 'activities', 'notes'], record.bullets || record.description || []);
      }

      await sleep(300);

      const saveClicked = await this._clickButtonIn(activeCard, text =>
        text.includes('save') || text.includes('submit') || text === 'done' || text === 'add'
      );
      if (!saveClicked) {
        await this._clickButtonIn(section, text =>
          text.includes('save') || text.includes('submit') || text === 'done' || text === 'add'
        );
      }

      // Wait for the activeCard to save and close (or disconnect, or no longer have inputs)
      console.log(`[SmartRecruiters] Waiting for card to save and close...`);
      let savedSuccessfully = false;
      for (let saveWait = 0; saveWait < 15; saveWait++) {
        await sleep(300);
        if (!activeCard.isConnected) {
          savedSuccessfully = true;
          break;
        }
        const tag = activeCard.tagName.toLowerCase();
        const stillEditing = tag.includes('edit-form') || tag.includes('edit-card') || 
                             activeCard.hasAttribute('edit-mode') || activeCard.getAttribute('mode') === 'edit' ||
                             this._findAllDeep(activeCard, 'input, select, textarea').length > 0;
        if (!stillEditing) {
          savedSuccessfully = true;
          break;
        }
      }
      console.log(`[SmartRecruiters] Card save wait completed. savedSuccessfully: ${savedSuccessfully}`);
      if (!savedSuccessfully) {
        console.log(`[SmartRecruiters] Card did not save successfully. Stopping loop to prevent overwriting.`);
        break;
      }
      await sleep(500); // Small safety delay
    }

    console.log(`[SmartRecruiters] Finished filling ${records.length} ${sectionType} entries.`);
  },

  _parseDateRange(period, startDate, endDate) {
    if (startDate && endDate) return [startDate, endDate];
    if (period && (period.includes('–') || period.includes('-') || period.includes('to'))) {
      const parts = period.split(/[–\-–\s]+to\s+|–/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) return [parts[0], parts[1]];
      if (parts.length === 1) {
        if (period.toLowerCase().includes('present') || period.toLowerCase().includes('current')) {
          return [parts[0], ''];
        }
      }
    }
    if (period && !period.includes('-')) {
      return ['', period];
    }
    return ['', ''];
  },

  _isCurrentPosition(endDate, isCurrent) {
    if (isCurrent === true || isCurrent === 'true') return true;
    if (!endDate) return false;
    const end = endDate.toLowerCase();
    return end.includes('present') || end.includes('current') || end.includes('now') || end.includes('ongoing');
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}