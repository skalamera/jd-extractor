// Form filling engine - handles all element types with proper event dispatching

const FormFiller = {
  FILL_DELAY: 150, // ms between fills to avoid race conditions

  querySelectorDeep(selector, root = document) {
    if (root.shadowRoot) {
      const found = this.querySelectorDeep(selector, root.shadowRoot);
      if (found) return found;
    }
    const el = root.querySelector(selector);
    if (el) return el;
    const children = root.querySelectorAll('*');
    for (const child of children) {
      if (child.shadowRoot) {
        const found = this.querySelectorDeep(selector, child.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  },

  querySelectorAllDeep(selector, root = document) {
    const elements = [];
    if (root.shadowRoot) {
      elements.push(...this.querySelectorAllDeep(selector, root.shadowRoot));
    }
    elements.push(...Array.from(root.querySelectorAll(selector)));
    const children = root.querySelectorAll('*');
    for (const child of children) {
      if (child.shadowRoot) {
        elements.push(...this.querySelectorAllDeep(selector, child.shadowRoot));
      }
    }
    return elements;
  },

  normalizeChoiceText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\bdon't\b/g, 'do not')
      .replace(/\bcan't\b/g, 'cannot')
      .replace(/\bi'm\b/g, 'i am')
      .replace(/non[\s-]?binary/g, 'non binary')
      .replace(/non[\s-]?conforming/g, 'non conforming')
      .replace(/decline to self[-\s]?identify/g, 'decline to self identify')
      .replace(/\s+/g, ' ')
      .trim();
  },

  tokenizeChoice(value) {
    return this.normalizeChoiceText(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  },

  getEffectiveInputValue(element) {
    if (!element) return '';
    const v = String(element.value ?? '').trim();
    if (v) return v;
    const avt = element.getAttribute('aria-valuetext');
    if (avt && avt.trim()) return avt.trim();
    const nm = element.getAttribute('name');
    if (nm) {
      const scope = element.closest('[class*="question"], [data-question-id], .application-question, .field, form');
      if (scope) {
        const sameName = scope.querySelector(`input[type="hidden"][name="${CSS.escape(nm)}"]`);
        if (sameName && String(sameName.value).trim()) return String(sameName.value).trim();
      }
    }
    return '';
  },

  isGreenhouseRemixComboboxInput(element) {
    if (!element || element.tagName !== 'INPUT') return false;
    const t = (element.type || '').toLowerCase();
    if (t && t !== 'text' && t !== 'search') return false;
    const cn = String(element.className || '');
    if (/\bremix-css-/.test(cn)) return true;
    const nm = element.getAttribute('name') || '';
    const id = element.getAttribute('id') || '';
    if (/^question_\d+$/i.test(nm) || /^question_\d+$/i.test(id)) return true;
    return false;
  },

  isTinyOrAriaHidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const r = el.getBoundingClientRect();
    return r.width < 4 || r.height < 4;
  },

  /**
   * Greenhouse Remix often labels a 0×0 aria-hidden mirror input; listbox wiring and
   * keyboard focus must target the visible combobox wrapper or sibling input.
   */
  getComboboxInteractTarget(fieldInput) {
    if (!fieldInput) return fieldInput;
    if (!this.isTinyOrAriaHidden(fieldInput)) return fieldInput;

    const outerCombo = fieldInput.closest('[role="combobox"]');
    if (outerCombo && outerCombo !== fieldInput && !this.isTinyOrAriaHidden(outerCombo)) {
      return outerCombo;
    }

    const containerSelector = '[data-question-id], [data-question], .application-question, [class*="application-question"], [class*="ApplicationQuestion"], [class*="question-"], fieldset, .field, .form-group, .form-field, .form-element, [class*="form-group"], [class*="form-field"], [class*="form-element"]';
    const q = fieldInput.closest(containerSelector);
    if (q) {
      const cand = this.querySelectorAllDeep(
        '[role="combobox"], input[class*="remix-css"], input[id^="question_"], input[name^="question_"]',
        q
      );
      for (const el of cand) {
        if (el === fieldInput) continue;
        if (el.getRootNode() !== fieldInput.getRootNode()) continue;
        if (this.isTinyOrAriaHidden(el)) continue;
        
        // Ensure the candidate belongs strictly to the closest container of this field
        if (el.closest(containerSelector) !== q) continue;
        return el;
      }
      const btn = this.querySelectorDeep('button[type="button"]:not([disabled])', q);
      if (btn && !this.isTinyOrAriaHidden(btn) && btn.closest(containerSelector) === q) return btn;
    }

    return outerCombo || fieldInput;
  },

  getListboxElForField(input) {
    if (!input) return null;
    // Locate the aria-controls listbox
    const controls = input.getAttribute('aria-controls');
    if (controls) {
      const lb = this.querySelectorDeep(`#${CSS.escape(controls)}`);
      if (lb) return lb;
    }
    // Search parent hierarchy
    let current = input;
    for (let i = 0; i < 6 && current; i++) {
      const listbox = this.querySelectorDeep('[role="listbox"], [class*="listbox"], [class*="menu"], [class*="dropdown"]', current);
      if (listbox && this.isVisibleOption(listbox)) return listbox;
      current = current.parentNode || current.host;
    }
    // Search globally in document
    const listboxes = this.querySelectorAllDeep('[role="listbox"], [class*="listbox"], [class*="menu"], [class*="dropdown"]');
    return listboxes.find(lb => this.isVisibleOption(lb)) || null;
  },

  normalizeProfileChoice(value) {
    const normalized = this.normalizeChoiceText(value);
    const aliases = {
      male: 'man',
      m: 'man',
      female: 'woman',
      f: 'woman',
      'non-binary': 'non binary',
      'prefer not to answer': 'decline to self identify',
      'i do not want to answer': 'i do not want to answer',
      'i do not wish to answer': 'i do not wish to answer',
      'he/him/his': 'he/him',
      'she/her/hers': 'she/her',
      'they/them/theirs': 'they/them',
      'he/him': 'he/him/his',
      'she/her': 'she/her/hers',
      'they/them': 'they/them/theirs'
    };
    return aliases[normalized] || normalized;
  },

  getChoiceLabel(input) {
    if (input.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (forLabel) {
        const text = forLabel.textContent.trim();
        if (text) return text;
      }
    }

    const wrapping = input.closest('label');
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('input').forEach(el => el.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }

    const nextEl = input.nextElementSibling;
    if (nextEl && !['INPUT', 'SELECT', 'TEXTAREA'].includes(nextEl.tagName)) {
      const text = nextEl.textContent.trim();
      if (text) return text;
    }

    let ancestor = input.parentElement;
    let bestText = '';
    for (let i = 0; i < 4 && ancestor; i++) {
      const peers = ancestor.querySelectorAll(`input[type="${CSS.escape(input.type)}"]`);
      if (peers.length > 1) break;

      const clone = ancestor.cloneNode(true);
      clone.querySelectorAll('input, button, svg, img').forEach(el => el.remove());
      const text = clone.textContent.trim();
      if (text) bestText = text;
      ancestor = ancestor.parentElement;
    }

    return bestText || input.value || '';
  },

  parseMultiValue(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value || '')
      .split(/(?:\s*,\s*|\s*\n\s*)+/)
      .map(v => v.trim())
      .filter(Boolean);
  },

  matchesChoice(label, optionValue, answer) {
    const normalizedAnswer = this.normalizeProfileChoice(answer);
    const normalizedLabel = this.normalizeChoiceText(label);
    const normalizedOptionValue = this.normalizeChoiceText(optionValue);

    if (!normalizedAnswer) return false;

    if (normalizedLabel === normalizedAnswer || normalizedOptionValue === normalizedAnswer) {
      return true;
    }

    const genderCanon = (s) => {
      const t = String(s || '').toLowerCase().replace(/non-binary/g, 'non binary').trim();
      if (t === 'man' || t === 'male' || t === 'm') return '__g_m__';
      if (t === 'woman' || t === 'female' || t === 'f') return '__g_f__';
      if (t === 'non binary' || t === 'nonbinary') return '__g_nb__';
      return t;
    };
    const ga = genderCanon(normalizedAnswer);
    const gl = genderCanon(normalizedLabel);
    const go = genderCanon(normalizedOptionValue);
    if (ga.startsWith('__g_') && (ga === gl || ga === go)) return true;

    const ethCanon = (s) => {
      const t = this.normalizeChoiceText(s);
      if (/\bwhite\b|\bcaucasian\b/.test(t)) return '__e_w__';
      if (/\bhispanic\b|\blatino\b|\blatinx\b/.test(t)) return '__e_h__';
      if (/\bblack\b|\bafrican\s+american\b|\bafrican-american\b/.test(t)) return '__e_b__';
      if (/\basian\b/.test(t)) return '__e_a__';
      if (/\bindigenous\b|\bfirst nations\b|\balaska native\b|\bnative american\b/.test(t)) return '__e_i__';
      if (/\bhawaiian\b|\bpacific islander\b/.test(t)) return '__e_p__';
      if (/\bmiddle eastern\b|\bnorth african\b/.test(t)) return '__e_m__';
      return t;
    };
    const ea = ethCanon(normalizedAnswer);
    const elbl = ethCanon(normalizedLabel);
    const eo = ethCanon(normalizedOptionValue);
    if (String(ea).startsWith('__e_') && (ea === elbl || ea === eo)) return true;

    const workAuthCanon = (s) => {
      const t = this.normalizeChoiceText(s);
      if (
        /\bcan work for any employer\b/.test(t) ||
        /\bauthorized to work for any employer\b/.test(t) ||
        /\bauthorized to work\b.*\bfor any employer\b/.test(t) ||
        /\blegally authorized\b.*\bany employer\b/.test(t) ||
        /\bpermitted to work\b.*\bany employer\b/.test(t)
      ) {
        return '__wa_any__';
      }
      if (
        /\bcan work for current employer\b/.test(t) ||
        /\bonly for my current employer\b/.test(t) ||
        /\bcurrent employer only\b/.test(t)
      ) {
        return '__wa_current__';
      }
      if (
        /\brequire\b.*\bsponsorship\b/.test(t) ||
        /\bwill require\b.*\bsponsorship\b/.test(t) ||
        /\bsponsorship\b.*\bobtain work authorization\b/.test(t) ||
        /\bobtain work authorization\b.*\bsponsorship\b/.test(t) ||
        /\bseeking work authorization\b/.test(t)
      ) {
        return '__wa_sponsor__';
      }
      if (
        /\bstatus\b.*\bis unknown\b/.test(t) ||
        /\bwork\b.*\bin\b.*\bis unknown\b/.test(t) ||
        /\bunknown\b.*\bwork authorization\b/.test(t)
      ) {
        return '__wa_unknown__';
      }
      return t;
    };
    const wa = workAuthCanon(normalizedAnswer);
    const wl = workAuthCanon(normalizedLabel);
    const wo = workAuthCanon(normalizedOptionValue);
    if (String(wa).startsWith('__wa_') && (wa === wl || wa === wo)) return true;

    const veteranCanon = (s) => {
      const t = this.normalizeChoiceText(s);
      const isVeteranButNotProtected = 
        /\b(i\s+am|identify\s+as)\s+a\s+veteran\b/.test(t) ||
        /\bveteran\b.*\bnot\s+(a\s+)?protected\b/.test(t);

      if (isVeteranButNotProtected) {
        return '__v_veteran_not_protected__';
      }
      if (
        (t.includes('not a protected veteran') && !isVeteranButNotProtected) ||
        /\bnot\s+a\s+veteran\b/.test(t) ||
        /\bi\s+am\s+not\s+a\s+veteran\b/.test(t) ||
        /\bno\b.*\bnot\s+a\s+protected\s+veteran\b/.test(t)
      ) {
        return '__v_no__';
      }
      if (
        !isVeteranButNotProtected && (
          /\bprotected\s+veteran\b/.test(t) ||
          /\bidentify\s+as\s+one\s+or\s+more\b.*\bprotected\b/.test(t) ||
          /\byes\b.*\bprotected\s+veteran\b/.test(t)
        )
      ) {
        return '__v_yes__';
      }
      if (
        /\bdecline\b/.test(t) ||
        /\bdo\s+not\s+wish\b/.test(t) ||
        /\bchoose\s+not\s+to\b/.test(t)
      ) {
        return '__v_decline__';
      }
      return t;
    };
    const va_v = veteranCanon(normalizedAnswer);
    const vl_v = veteranCanon(normalizedLabel);
    const vo_v = veteranCanon(normalizedOptionValue);
    if (String(va_v).startsWith('__v_') && (va_v === vl_v || va_v === vo_v)) return true;

    const answerTokens = this.tokenizeChoice(normalizedAnswer);
    const labelTokens = this.tokenizeChoice(normalizedLabel);
    const optionTokens = this.tokenizeChoice(normalizedOptionValue);
    const firstAnswerToken = answerTokens[0];

    if (answerTokens.length === 1 && firstAnswerToken) {
      const labelFirst = labelTokens[0];
      const optionFirst = optionTokens[0];
      return labelFirst === firstAnswerToken || optionFirst === firstAnswerToken ||
        labelTokens.includes(firstAnswerToken) || optionTokens.includes(firstAnswerToken);
    }

    if (normalizedAnswer.length > 4 && (
      (normalizedLabel && normalizedLabel.length > 2 && normalizedLabel.includes(normalizedAnswer)) ||
      (normalizedOptionValue && normalizedOptionValue.length > 2 && normalizedOptionValue.includes(normalizedAnswer)) ||
      (normalizedLabel && normalizedLabel.length > 2 && normalizedAnswer.includes(normalizedLabel)) ||
      (normalizedOptionValue && normalizedOptionValue.length > 2 && normalizedAnswer.includes(normalizedOptionValue))
    )) {
      return true;
    }

    const significantTokens = answerTokens.filter(token => !['i', 'a', 'an', 'the', 'to', 'of', 'or', 'and'].includes(token));
    if (significantTokens.length >= 2) {
      const haystack = new Set([...labelTokens, ...optionTokens]);
      return significantTokens.every(token => haystack.has(token));
    }

    return false;
  },

  async fillField(element, value, fieldType, purpose = '', label = '') {
    if (!element || value === undefined || value === null || value === '') return false;

    switch (fieldType) {
      case 'text':
      case 'textarea':
        return this.fillTextInput(element, value, purpose, label);
      case 'select':
        return this.fillSelect(element, value);
      case 'radio':
        return this.fillRadio(element, value);
      case 'checkbox':
        return this.fillCheckbox(element, value, purpose, label);
      case 'checkbox-group':
        return this.fillCheckboxGroup(element, value);
      case 'custom-dropdown':
        return this.fillCustomDropdown(element, value);
      case 'contenteditable':
        return this.fillContentEditable(element, value);
      case 'file':
        return false; // handled separately
      default:
        return this.fillTextInput(element, value, purpose, label);
    }
  },

  fieldHintsLookLikeLocation(element, purpose = '', label = '') {
    if (purpose === 'address.city' || purpose === 'address.state' || purpose === 'address.country') return true;
    const blob = [
      label,
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      element.id,
      element.name,
      element.getAttribute('data-qa'),
      (() => {
        if (element.id) {
          const l = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
          if (l) return l.textContent;
        }
        return '';
      })()
    ].filter(Boolean).join(' ');
    return /\b(location|city|town|state|country|address|zip|postal)\b/i.test(blob);
  },

  isDateRelated(el, label = '') {
    const l = String(el.getAttribute('aria-label') || el.placeholder || el.id || el.name || label || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    return type === 'date' || 
           /\b(date|from|to|year|calendar|month)\b/i.test(l) || 
           /pick\s+a\s+date/i.test(el.placeholder || '') ||
           el.classList.contains('flatpickr-input') ||
           el.hasAttribute('data-input') ||
           el.closest('sf-date-picker, spl-date-picker') != null;
  },

  async typeValueIncrementally(element, valueStr) {
    const interact = this.getComboboxInteractTarget(element);
    
    // 1. Focus interact element
    let isFocused = false;
    try {
      interact.focus();
      await this.delay(50);
      isFocused = (document.activeElement === interact);
      if (!isFocused) {
        interact.focus();
        await this.delay(100);
        isFocused = (document.activeElement === interact);
      }
    } catch (e) {}

    // 2. Clear existing value
    let cleared = false;
    if (isFocused) {
      try {
        interact.select();
        cleared = document.execCommand('delete');
      } catch (e) {}
    }
    if (!cleared) {
      const isTextArea = interact instanceof HTMLTextAreaElement;
      const isInput = interact instanceof HTMLInputElement;
      const proto = isTextArea ? HTMLTextAreaElement.prototype : (isInput ? HTMLInputElement.prototype : Object.getPrototypeOf(interact));
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        try { nativeSetter.call(interact, ''); } catch { interact.value = ''; }
      } else {
        interact.value = '';
      }
      interact.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    }
    await this.delay(50);

    // 3. Type character-by-character
    for (const char of valueStr) {
      // Keydown
      interact.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));

      // Insert character
      let typedChar = false;
      if (isFocused) {
        try {
          typedChar = document.execCommand('insertText', false, char);
        } catch (e) {}
      }

      if (!typedChar) {
        const next = (interact.value || '') + char;
        const isTextArea = interact instanceof HTMLTextAreaElement;
        const isInput = interact instanceof HTMLInputElement;
        const proto = isTextArea ? HTMLTextAreaElement.prototype : (isInput ? HTMLInputElement.prototype : Object.getPrototypeOf(interact));
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          try { nativeSetter.call(interact, next); } catch { interact.value = next; }
        } else {
          interact.value = next;
        }
        interact.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      }

      // Keyup
      interact.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));

      // Natural delay between characters (15 - 35ms)
      await this.delay(15 + Math.random() * 20);
    }

    // Dispatch final change event
    interact.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));

    // Sync with hidden mirror element if different
    if (element !== interact) {
      const isTextArea = element instanceof HTMLTextAreaElement;
      const isInput = element instanceof HTMLInputElement;
      const proto = isTextArea ? HTMLTextAreaElement.prototype : (isInput ? HTMLInputElement.prototype : Object.getPrototypeOf(element));
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        try { nativeSetter.call(element, interact.value); } catch { element.value = interact.value; }
      } else {
        element.value = interact.value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    }

    // Trigger React onChange hook if present
    const triggerReactChange = (el) => {
      const reactPropsKey = Object.keys(el).find(key => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
      if (reactPropsKey && el[reactPropsKey] && el[reactPropsKey].onChange) {
        try {
          el[reactPropsKey].onChange({ target: el, currentTarget: el });
        } catch (e) {}
      }
    };
    triggerReactChange(interact);
    if (element !== interact) {
      triggerReactChange(element);
    }
  },

  async fillTextInput(element, value, purpose = '', label = '') {
    const interact = this.getComboboxInteractTarget(element);
    const inputLabel = (element.getAttribute('aria-label') || element.placeholder || element.id || element.name || label || '').toLowerCase();

    // Auto-default empty Month/Day fields in date pickers to '01' to prevent invalid date errors
    const isDayField = /\b(day|dd)\b/i.test(inputLabel) && !/birthday/i.test(inputLabel);
    const isMonthField = /\b(month|mm)\b/i.test(inputLabel) && !/birthday/i.test(inputLabel);
    if ((isDayField || isMonthField) && (!value || String(value).trim() === '')) {
      value = '01';
    }
    
    // Phone number cleaning & formatting
    const isPhone = purpose === 'phone' ||
                    element.type === 'tel' || 
                    interact.type === 'tel' || 
                    /\b(phone|mobile|cell|telephone)\b/i.test(label + ' ' + element.id + ' ' + element.name + ' ' + (element.getAttribute('placeholder') || '') + ' ' + interact.id + ' ' + interact.name);
    
    if (isPhone) {
      let cleaned = String(value).trim();
      if (cleaned.startsWith('+')) {
        const parent = element.closest('.field, .form-group, .form-field, [class*="group"], [class*="field"]');
        const hasCountryCodeSelector = parent && parent.querySelector('select, [role="combobox"], [class*="select"], [class*="country-code"]');
        
        if (hasCountryCodeSelector) {
          if (cleaned.startsWith('+1')) {
            cleaned = cleaned.substring(2).trim();
          } else {
            const match = cleaned.match(/^\+(\d{1,3})/);
            if (match) {
              cleaned = cleaned.substring(match[0].length).trim();
            }
          }
        }
      }
      const digitsOnly = cleaned.replace(/\D/g, '');
      if (digitsOnly.length >= 7) {
        cleaned = digitsOnly;
      }
      value = cleaned;

      // SmartRecruiters main-world phone injector bypass
      const isSmartRecruiters = /smartrecruiters/i.test(location.href) || 
                                !!document.querySelector('sf-root, sf-page, spl-root, spl-page, [class*="oneclick-ui"], [data-testid*="oneclick"]');
      if (isSmartRecruiters) {
        const tempId = 'clyde-' + Math.random().toString(36).substring(2, 9);
        element.setAttribute('data-clyde-temp', tempId);

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/portal-handlers/smartrecruiters-inject.js');
        script.setAttribute('data-op', 'phone');
        script.setAttribute('data-temp-id', tempId);
        script.setAttribute('data-val', value);
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        return true;
      }
    }
    
    // Programmatic flatpickr date setter support
    const fp = element._flatpickr || interact._flatpickr;
    if (fp && typeof fp.setDate === 'function') {
      try {
        fp.setDate(value, true);
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
        return true;
      } catch (e) {
        console.warn('[JobAutoFill] flatpickr.setDate failed:', e);
      }
    }
    
    // Special handling for "Present" end dates:
    // If the value is "Present" / "Current" and the label looks like an end-date,
    // find and check the "I currently work here" / "currently study here" checkbox instead.
    const isEndDateLabel = (lab) => {
      const l = String(lab || '').toLowerCase();
      return l === 'to' || l.includes('end date') || l.includes('to date') || l.includes('graduation');
    };
    
    const elementLabel = element.getAttribute('aria-label') || element.placeholder || element.id || '';
    if (isEndDateLabel(elementLabel) && /^(present|current|now)$/i.test(String(value).trim())) {
      console.log(`[JobAutoFill] Special handling: checking 'currently work/study here' checkbox for value "${value}"`);
      
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

      const getCheckboxLabelText = (cb) => {
        let t = this.getChoiceLabel(cb);
        if (t) return t;
        
        const host = cb.getRootNode()?.host;
        if (host) {
          t = host.getAttribute('label') || host.textContent;
          if (t?.trim()) return t.trim();
          
          const p = host.parentElement;
          if (p && p.textContent?.trim()) return p.textContent.trim();
        }
        
        const parentDiv = cb.closest?.('div, [class*="checkbox"], [class*="check"], label');
        if (parentDiv && parentDiv.textContent?.trim()) {
          return parentDiv.textContent.trim();
        }
        return '';
      };

      // Traverse up to find the group container, then find a checkbox
      let container = element.parentElement;
      let checkboxFound = false;
      for (let i = 0; i < 6 && container; i++) {
        const checkboxes = querySelectorAllDeep('input[type="checkbox"], sf-checkbox, [role="checkbox"], [class*="checkbox"], .checkbox, .check-box', container);
        for (const cb of checkboxes) {
          const cbLabel = getCheckboxLabelText(cb);
          console.log(`[JobAutoFill Debug] Checkbox candidate: label="${cbLabel}", tag=${cb.tagName}, class=${cb.className}`);
          if (/\b(currently|current|present|work\s+here|study\s+here)\b/i.test(cbLabel)) {
            console.log(`[JobAutoFill] Found matching currently work/study checkbox: "${cbLabel}". Clicking...`);
            
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
            cb.dispatchEvent(new Event('click', { bubbles: true, cancelable: true, composed: true }));
            
            const host = cb.getRootNode()?.host;
            if (host && host !== cb) {
              try {
                host.click();
                host.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
                host.dispatchEvent(new Event('click', { bubbles: true, cancelable: true, composed: true }));
              } catch (e) {}
            }
            checkboxFound = true;
            break;
          }
        }
        if (checkboxFound) break;
        container = container.parentElement;
      }
      return true; // ALWAYS return true for "Present" on end-date fields to prevent angular library crash!
    }

    const isDate = this.isDateRelated(element, label);

    const isTypeahead =
      !isDate && (
        element.getAttribute('role') === 'combobox' ||
        element.getAttribute('aria-autocomplete') != null ||
        element.getAttribute('aria-haspopup') != null ||
        element.getAttribute('list') != null ||
        element.tagName.toLowerCase() === 'button' ||
        element.getAttribute('role') === 'button' ||
        element.tagName.toLowerCase() === 'select' ||
        element.closest('[role="combobox"]') != null ||
        this.isGreenhouseRemixComboboxInput(element) ||
        (() => {
          let curr = element;
          let depth = 0;
          while (curr && curr !== document.body && depth < 8) {
            const autoId = curr.getAttribute?.('data-automation-id') || '';
            const className = curr.className || '';
            const tagName = curr.tagName.toLowerCase();
            if (/typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(autoId) ||
                /typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(className) ||
                /typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(tagName) ||
                tagName === 'select' ||
                curr.getAttribute?.('role') === 'combobox') {
              return true;
            }
            // Check shadow root host if present
            const host = curr.getRootNode()?.host;
            if (host) {
              const hostAutoId = host.getAttribute?.('data-automation-id') || '';
              const hostClassName = host.className || '';
              const hostTagName = host.tagName.toLowerCase();
              if (/typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(hostAutoId) ||
                  /typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(hostClassName) ||
                  /typeahead|autocomplete|combobox|search|select|dropdown|prompt/i.test(hostTagName)) {
                return true;
              }
            }
            
            const nextNode = curr.parentElement || curr.getRootNode()?.host;
            curr = (nextNode && nextNode !== curr) ? nextNode : null;
            depth++;
          }

          const container = element.closest('.field, [class*="input"], [class*="wrapper"]');
          if (container) {
            if (container.tagName.toLowerCase().includes('spl-') && 
                !/select|autocomplete|typeahead|combobox/i.test(container.tagName) &&
                !container.querySelector('spl-select, [class*="select"]')) {
               return false;
            }
            if (container.querySelector('svg, .icon, [class*="icon"], [class*="search"]') || 
                /typeahead|autocomplete|combobox|search/i.test(container.className || '')) {
              return true;
            }
          }
          return false;
        })()
      );

    const locationLike = this.fieldHintsLookLikeLocation(element, purpose, label);
    console.log(`[JobAutoFill Debug] fillTextInput: element=${element.tagName}#${element.id}.${element.className}, label="${inputLabel}", value="${value}", isDate=${isDate}, isTypeahead=${isTypeahead}`);

    if (isTypeahead) {
      if (locationLike) await this.delay(200);
      const picked = await this.pickTypeaheadOption(element, value);
      if (picked) return true;
      const v = this.getEffectiveInputValue(element);
      if (v && !/^select\.{0,3}$/i.test(v)) return true;
      try {
        interact.blur();
        if (element !== interact) element.blur();
      } catch (e) {}
      return false;
    }
    
    if (isDate) {
      console.log(`[JobAutoFill] Setting date value in one shot: "${value}" for element`, element);
      
      // Clean up the date string: if it's "YYYY-MM-DD" convert to "MM/DD/YYYY", if "YYYY-MM" to "MM/YYYY"
      let dateVal = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        const [y, m, d] = dateVal.split('-');
        if (inputLabel.includes('yyyy') && !inputLabel.includes('dd') && !inputLabel.includes('day')) {
          dateVal = `${m}/${y}`;
        } else {
          dateVal = `${m}/${d}/${y}`;
        }
      } else if (/^\d{4}-\d{2}$/.test(dateVal)) {
        const [y, m] = dateVal.split('-');
        dateVal = `${m}/${y}`;
      }
      
      // Focus and set value directly
      try { interact.focus(); } catch(e){}
      
      const setVal = (el, val) => {
        const isTextArea = el instanceof HTMLTextAreaElement;
        const isInput = el instanceof HTMLInputElement;
        const proto = isTextArea ? HTMLTextAreaElement.prototype : (isInput ? HTMLInputElement.prototype : Object.getPrototypeOf(el));
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          try { nativeSetter.call(el, val); } catch { el.value = val; }
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      };
      
      setVal(interact, dateVal);
      if (element !== interact) {
        setVal(element, dateVal);
      }
      
      // Trigger React onChange
      const triggerReactChange = (el) => {
        const reactPropsKey = Object.keys(el).find(key => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
        if (reactPropsKey && el[reactPropsKey] && el[reactPropsKey].onChange) {
          try {
            el[reactPropsKey].onChange({ target: el, currentTarget: el });
          } catch (e) {}
        }
      };
      triggerReactChange(interact);
      if (element !== interact) triggerReactChange(element);
      
      try {
        interact.blur();
        if (element !== interact) element.blur();
      } catch (e) {}
      await this.delay(100);
      return true;
    }

    // Direct filling logic for non-typeahead inputs (First Name, Phone Number, etc.)
    await this.typeValueIncrementally(element, value);

    // Blur natively to release focus cleanly
    try {
      interact.blur();
      if (element !== interact) element.blur();
    } catch (e) {}
    await this.delay(50);
    return true;
  },

  isVisibleOption(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    
    let r = el.getBoundingClientRect();
    if (style.display === 'contents') {
      const firstChild = el.firstElementChild;
      if (firstChild) {
        r = firstChild.getBoundingClientRect();
      }
    }
    
    return r.width >= 2 && r.height >= 2;
  },

  isVisibleListbox(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  },

  async fireKey(element, key, code, keyCode) {
    const createEvent = (type) => {
      const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, view: window });
      Object.defineProperty(ev, 'keyCode', { value: keyCode });
      Object.defineProperty(ev, 'which', { value: keyCode });
      return ev;
    };
    element.dispatchEvent(createEvent('keydown'));
    await this.delay(10);
    element.dispatchEvent(createEvent('keyup'));
  },

  getListboxElForField(input) {
    if (!input) return null;
    // Locate the aria-controls listbox
    const controls = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    if (controls) {
      const lb = this.querySelectorDeep(`#${CSS.escape(controls)}`) || document.getElementById(controls);
      if (lb) return lb;
    }
    // Search parent hierarchy
    let current = input;
    const selectors = '[role="listbox"], [class*="listbox"], [class*="menu"], [class*="dropdown"], sf-typeahead, spl-overlay, sf-overlay, sf-list-box, spl-list-box, sf-typeahead-items, [data-automation-id*="popup"], [data-automation-id*="promptPopup"], [data-automation-id*="prompt"]';
    for (let i = 0; i < 6 && current; i++) {
      const listbox = this.querySelectorDeep(selectors, current);
      if (listbox && this.isVisibleListbox(listbox)) return listbox;
      current = current.parentNode || current.host;
    }
    // Search globally using querySelectorAllDeep to find any visible matching listbox
    const globalLbs = this.querySelectorAllDeep(selectors);
    const visibleLb = globalLbs.find(lb => this.isVisibleListbox(lb));
    if (visibleLb) return visibleLb;

    // Fallback: search for any visible option and climb up to get its listbox container
    const optSelectors = '[role="option"], [data-automation-id*="option"], [data-automation-id="promptOption"], [class*="option"]';
    const globalOpts = this.querySelectorAllDeep(optSelectors);
    const visibleOpt = globalOpts.find(o => this.isVisibleOption(o));
    if (visibleOpt) {
      const lb = visibleOpt.closest('[role="listbox"], [data-automation-id*="popup"], [data-automation-id*="promptPopup"], [class*="popup"], [class*="listbox"], [class*="dropdown"]') || visibleOpt.parentElement;
      if (lb) {
        console.log('[JobAutoFill Listbox Fallback] Found listbox via visible option sibling:', lb);
        return lb;
      }
    }
    return null;
  },

  async waitForOptions(input, timeoutMs = 2500) {
    const start = Date.now();
    const optSelectors = '[role="option"], li, a, [class*="option"], [class*="item"], [id*="option"], [id*="item"], [data-automation-id*="option"], [data-automation-id*="promptOption"], [data-automation-id="promptOption"]';
    while (Date.now() - start < timeoutMs) {
      const lb = this.getListboxElForField(input);
      if (lb) {
        const opts = this.querySelectorAllDeep(optSelectors, lb)
          .filter(o => this.isVisibleOption(o));
        if (opts.length > 0) return { lb, visible: opts };
      }
      await this.delay(100);
    }
    return { lb: null, visible: [] };
  },

  async pickTypeaheadOption(input, value) {
    const interact = this.getComboboxInteractTarget(input);
    const valueStr = String(value).trim();
    const valueLower = valueStr.toLowerCase();

    console.log(`[JobAutoFill Typeahead] pickTypeaheadOption started for value="${valueStr}". Input element:`, input, `Interact target:`, interact);

    if (this.isDateRelated(input)) {
      const v = String(value).trim().toLowerCase();
      if (v === 'not provided' || v === 'unknown' || v === 'none' || v === 'null') {
        console.log(`[JobAutoFill Typeahead] Intercepted and skipped invalid date string "${value}" for calendar field`);
        return true; // return success safely without writing
      }
    }

    // 0. Click combobox/select dropdown elements to focus / open them
    const tagName = interact.tagName.toLowerCase();
    const isEditable = (tagName === 'input' || tagName === 'textarea') && !interact.hasAttribute('readonly');
    
    console.log(`[JobAutoFill Typeahead] Element isEditable=${isEditable} (tagName=${tagName})`);
    
    // Always dispatch a click or focus to trigger page listeners
    try {
      console.log(`[JobAutoFill Typeahead] Dispatching click to open dropdown listbox...`);
      interact.click();
      await this.delay(200);
    } catch (e) {
      console.warn(`[JobAutoFill Typeahead] Click on interact element failed:`, e);
    }

    // 1. Compute truncated search query and type if editable
    let searchQuery = valueStr;
    if (valueStr.length > 15) {
      const words = valueStr.split(/\s+/);
      if (words.length > 3) {
        searchQuery = words.slice(0, 3).join(' ');
      }
      if (searchQuery.length > 25) {
        searchQuery = searchQuery.substring(0, 25);
      }
      searchQuery = searchQuery.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();
    }

    if (isEditable) {
      console.log(`[JobAutoFill Typeahead] Typing search string: "${searchQuery}"`);
      await this.typeValueIncrementally(input, searchQuery);
      await this.delay(150);
    } else {
      console.log(`[JobAutoFill Typeahead] Skip typing because element is non-editable`);
    }

    // 2. Open dropdown using keyboard
    console.log(`[JobAutoFill Typeahead] Pressing ArrowDown to trigger listbox rendering`);
    await this.fireKey(interact, 'ArrowDown', 'ArrowDown', 40);

    // 3. Wait for options to render
    console.log(`[JobAutoFill Typeahead] Waiting for options to render in listbox...`);
    const { lb, visible } = await this.waitForOptions(interact);
    console.log(`[JobAutoFill Typeahead] waitForOptions returned listbox:`, lb, `visible options count:`, visible.length);
    
    if (!visible.length) {
      console.log(`[JobAutoFill Typeahead] No dropdown options rendered for: "${valueStr}"`);
      return false;
    }

    // Print all options for debugging
    console.log(`[JobAutoFill Typeahead] Rendered options:`, visible.map(o => o.textContent?.trim()));

    // 4. Find the best match option using punctuation-insensitive comparisons
    const cleanPunctuation = (s) => String(s || '').replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cleanValue = cleanPunctuation(valueStr);

    const exactMatch = visible.find(opt => {
      const txt = opt.textContent?.trim().toLowerCase();
      return txt === valueLower || 
             this.normalizeChoiceText(txt) === this.normalizeChoiceText(valueStr) ||
             cleanPunctuation(txt) === cleanValue;
    });

    const partialMatch = exactMatch || visible.find(opt => {
      const txt = opt.textContent?.trim().toLowerCase();
      const cleanTxt = cleanPunctuation(txt);
      return txt.includes(valueLower) || 
             valueLower.includes(txt) || 
             cleanTxt.includes(cleanValue) || 
             cleanValue.includes(cleanTxt);
    });

    const target = partialMatch || visible[0];
    console.log(`[JobAutoFill Typeahead] Exact match:`, exactMatch ? exactMatch.textContent?.trim() : 'none', 
                `Partial match:`, partialMatch ? partialMatch.textContent?.trim() : 'none',
                `Selected target option:`, target ? target.textContent?.trim() : 'none');

    if (target) {
      // framework-safe pointer events + click
      target.scrollIntoView({ block: 'nearest' });
      try {
        console.log(`[JobAutoFill Typeahead] Dispatching mouse events and clicking option:`, target.textContent?.trim());
        target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        await this.delay(250); // wait a bit more for React state updates
      } catch (e) {
        console.warn(`[JobAutoFill Typeahead] Failed to click option via events, standard click fallback:`, e);
        target.click();
      }
      
      // Dispatch events on input
      console.log(`[JobAutoFill Typeahead] Dispatching change/input events on input`);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      if (input !== interact) {
        interact.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        interact.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
      return true;
    }

    return false;
  },

  fillSelect(element, value) {
    const options = Array.from(element.options);
    const valueLower = String(value).toLowerCase().trim();

    // Try exact match first
    let match = options.find(o => o.value.toLowerCase() === valueLower || o.text.toLowerCase() === valueLower);

    // Try partial match
    if (!match) {
      match = options.find(o =>
        o.text.toLowerCase().includes(valueLower) || valueLower.includes(o.text.toLowerCase())
      );
    }

    // Try fuzzy match on key words
    if (!match) {
      const valueWords = valueLower.split(/\s+/);
      match = options.find(o => {
        const optText = o.text.toLowerCase();
        return valueWords.some(word => word.length > 2 && optText.includes(word));
      });
    }

    if (match) {
      element.value = match.value;
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      return true;
    }

    return false;
  },

  fillRadio(element, value, allElements) {
    const radios = allElements || document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`);
    const normalizedValue = this.normalizeProfileChoice(value);

    console.log(`[JobAutoFill] fillRadio value="${value}" normalized="${normalizedValue}" labels:`, Array.from(radios).map(r => ({ label: this.getChoiceLabel(r), value: r.value })));

    const clickRadio = (radio) => {
      if (radio.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
        if (lab) {
          lab.click();
          radio.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
          return;
        }
      }
      radio.checked = true;
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    };

    // Single-radio fields: each option has a unique name (Ashby pattern).
    // The field label IS the option text. Click if the answer is affirmative or matches.
    if (radios.length === 1) {
      const label = this.getChoiceLabel(radios[0]);
      const normalizedInput = this.normalizeChoiceText(value);
      const isNegative = /^(no|false|0)$/i.test(normalizedInput);
      const isMatch = this.matchesChoice(label, radios[0].value, normalizedValue) ||
        /^(yes|true|on|1|i acknowledge)$/i.test(normalizedInput);
      console.log(`[JobAutoFill] Single-radio "${label}": isNegative=${isNegative} isMatch=${isMatch}`);
      if (!isNegative && isMatch) { clickRadio(radios[0]); return true; }
      return false;
    }

    // Multi-radio group: find the right option.
    for (const radio of radios) {
      if (this.matchesChoice(this.getChoiceLabel(radio), radio.value, normalizedValue)) {
        clickRadio(radio); return true;
      }
    }

    return false;
  },

  getClickableChoiceLabel(el) {
    const al = el.getAttribute('aria-label');
    if (al?.trim()) return al.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const combined = labelledBy
        .split(/\s+/)
        .map(id => {
          const node = document.getElementById(id);
          return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
        })
        .filter(Boolean)
        .join(' ');
      if (combined) return combined;
    }
    return el.textContent.replace(/\s+/g, ' ').trim();
  },

  fillAriaChoiceGroup(element, value, allElements) {
    const options = allElements?.length ? allElements : [element];
    const normalizedValue = this.normalizeProfileChoice(value);
    console.log(`[JobAutoFill] fillAriaChoiceGroup value="${value}" options:`, options.map(o => this.getClickableChoiceLabel(o)));

    const clickOption = (opt) => {
      opt.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof opt.focus === 'function') opt.focus();
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      opt.click();
    };

    for (const opt of options) {
      const label = this.getClickableChoiceLabel(opt);
      if (this.matchesChoice(label, '', normalizedValue)) {
        clickOption(opt);
        return true;
      }
    }

    const v = this.normalizeChoiceText(String(value));
    if (v === 'yes' || v === 'no') {
      const hit = options.find(o => this.normalizeChoiceText(this.getClickableChoiceLabel(o)) === v);
      if (hit) {
        clickOption(hit);
        return true;
      }
    }

    return false;
  },

  getSelectedAriaChoiceLabel(allElements) {
    const opts = Array.from(allElements || []);
    const explicit = opts.filter(el =>
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-pressed') === 'true'
    );
    if (explicit.length === 1) return this.getClickableChoiceLabel(explicit[0]);

    const checkedInput = opts.filter(el => el.matches?.('input:checked'));
    if (checkedInput.length === 1) return this.getClickableChoiceLabel(checkedInput[0]);

    const selectedClass = opts.filter(el => {
      const c = String(el.className || '');
      return /\b(selected|active|pressed|checked)\b/i.test(c) && !/\bunselected|inactive\b/i.test(c);
    });
    if (selectedClass.length === 1) return this.getClickableChoiceLabel(selectedClass[0]);

    return '';
  },

  fillCheckbox(element, value, purpose = '', label = '') {
    const normalizedValue = FormFiller.normalizeProfileChoice ? FormFiller.normalizeProfileChoice(value) : String(value).toLowerCase().trim();
    const cleanLabel = (label || (FormFiller.getChoiceLabel ? FormFiller.getChoiceLabel(element) : '') || '').trim();

    let shouldCheck = false;

    // Check if the profile value directly matches the option label/text (e.g. for multi-choice checkbox questions)
    if (cleanLabel && normalizedValue && (
      (FormFiller.matchesChoice && FormFiller.matchesChoice(cleanLabel, element.value, normalizedValue)) ||
      cleanLabel.toLowerCase().includes(normalizedValue) ||
      normalizedValue.includes(cleanLabel.toLowerCase())
    )) {
      shouldCheck = true;
    } else {
      // Fallback to truthy boolean check (e.g. for single agreement/acknowledgement checkboxes)
      shouldCheck = /^(yes|true|1|checked|agree|acknowledge|accept|statement|disclosure)$/i.test(String(value)) ||
                    /agree|acknowledge|accept|statement|disclosure|philosophy/i.test(String(purpose || '')) ||
                    /agree|acknowledge|accept|statement|disclosure|philosophy/i.test(String(label || ''));
    }

    if (element.checked !== shouldCheck) {
      element.checked = shouldCheck;
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      element.dispatchEvent(new Event('click', { bubbles: true, cancelable: true, composed: true }));
    }
    return true;
  },

  fillCheckboxGroup(element, value, allElements) {
    const checkboxes = allElements || [element];
    const desiredValues = this.parseMultiValue(value).map(v => this.normalizeProfileChoice(v));
    if (desiredValues.length === 0) return false;

    let changed = false;
    let matched = false;

    for (const checkbox of checkboxes) {
      const label = this.getChoiceLabel(checkbox);
      const shouldCheck = desiredValues.some(answer => this.matchesChoice(label, checkbox.value, answer));

      if (shouldCheck) matched = true;
      if (checkbox.checked !== shouldCheck) {
        const lab = checkbox.id && document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`);
        if (lab) {
          lab.click();
        } else {
          checkbox.checked = shouldCheck;
          checkbox.dispatchEvent(new Event('click', { bubbles: true, cancelable: true, composed: true }));
        }
        checkbox.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
        changed = true;
      }
    }

    return matched || changed;
  },

  getSelectedRadioLabel(elements) {
    const selected = Array.from(elements || []).find(radio => radio.checked);
    return selected ? this.getChoiceLabel(selected) : '';
  },

  getCheckedCheckboxLabels(elements) {
    return Array.from(elements || [])
      .filter(checkbox => checkbox.checked)
      .map(checkbox => this.getChoiceLabel(checkbox));
  },

  async fillCustomDropdown(element, value) {
    // Click to open the dropdown (using framework-safe events)
    try {
      element.scrollIntoView({ block: 'nearest' });
      element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true }));
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
      element.click();
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
    } catch (e) {
      element.click();
    }
    await this.delay(300);

    // Look for dropdown options that appeared
    const optionSelectors = [
      '[role="option"]', '[role="listbox"] li', '.dropdown-option',
      '.select-option', '[class*="option"]', 'li[data-value]',
      '[data-automation-id*="option"]'
    ];

    for (const selector of optionSelectors) {
      const options = this.querySelectorAllDeep(selector);
      for (const option of options) {
        const optionText = option.textContent.trim();
        const optionVal = option.getAttribute('data-value') || '';
        const optLower = optionText.toLowerCase().trim();
        const valLower = String(value).toLowerCase().trim();
        const isGenderMismatch = (valLower === 'male' && optLower === 'female') || (valLower === 'female' && optLower === 'male');

        if (!isGenderMismatch && (
            this.matchesChoice(optionText, optionVal, value) ||
            optLower.includes(valLower) ||
            valLower.includes(optLower)
        )) {
          
          try {
            option.scrollIntoView({ block: 'nearest' });
            option.click();
          } catch (e) {
            option.click();
          }
          return true;
        }
      }
    }

    // Close dropdown if we couldn't find a match
    document.body.click();
    return false;
  },

  fillContentEditable(element, value) {
    element.focus();
    element.innerHTML = value.replace(/\n/g, '<br>');
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    return true;
  },

  async attachFile(fileInput, base64Data, fileName, mimeType = 'application/pdf') {
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const file = new File([bytes], fileName, { type: mimeType });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));

      return true;
    } catch (e) {
      console.error('[JobAutoFill] File attachment failed:', e);
      return false;
    }
  },

  escapePdfText(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .split('')
      .map((ch) => {
        const c = ch.codePointAt(0);
        if (c >= 0x20 && c <= 0x7e) {
          if (ch === '\\') return '\\\\';
          if (ch === '(') return '\\(';
          if (ch === ')') return '\\)';
          return ch;
        }
        if (ch === '\t') return ' ';
        return ' ';
      })
      .join('');
  },

  wrapCoverLetterLines(text, maxChars) {
    const paragraphs = String(text || '').split(/\n/);
    const out = [];
    for (const p of paragraphs) {
      const t = p.trimEnd();
      if (!t) {
        out.push('');
        continue;
      }
      const words = t.split(/\s+/);
      let line = '';
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (next.length > maxChars && line) {
          out.push(line);
          line = w.length > maxChars ? w.slice(0, maxChars) : w;
        } else {
          line = next;
        }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [''];
  },

  /** Single-page PDF (built-in Helvetica), same idea as a simple resume PDF upload. */
  buildCoverLetterPdfPayload(coverLetterText, applicantName) {
    const base = String(applicantName || 'Applicant').replace(/\s+/g, '_').replace(/[^\w-]/g, '') || 'Applicant';
    const fileName = `Cover_Letter_${base}.pdf`;
    const lines = this.wrapCoverLetterLines(coverLetterText, 92);
    const maxLines = 48;
    const useLines = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      useLines.push('... (truncated - see .txt download for full letter)');
    }

    const streamParts = ['BT', '/F1 11 Tf', '50 780 Td'];
    let first = true;
    for (const line of useLines) {
      if (!first) streamParts.push('0 -14 Td');
      first = false;
      streamParts.push(`(${this.escapePdfText(line)}) Tj`);
    }
    streamParts.push('ET');
    const streamBody = streamParts.join('\n');
    const enc = new TextEncoder();
    const streamLen = enc.encode(`${streamBody}\n`).length;

    let pdf = '%PDF-1.4\n';
    const offsets = {};
    const appendObj = (id, body) => {
      offsets[id] = pdf.length;
      pdf += body;
    };

    appendObj(1, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    appendObj(2, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    appendObj(
      3,
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'
    );
    appendObj(5, '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    appendObj(
      4,
      `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamBody}\nendstream\nendobj\n`
    );

    const xrefPos = pdf.length;
    const maxId = 5;
    pdf += `xref\n0 ${maxId + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let id = 1; id <= maxId; id++) {
      pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefPos}\n%%EOF`;

    const u8 = enc.encode(pdf);
    return { u8, fileName };
  },

  coverLetterPdfToBase64(u8) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + chunk, u8.length)));
    }
    return btoa(binary);
  },

  attachCoverLetterAsFile(fileInput, coverLetterText, applicantName) {
    const namePrefix = String(applicantName || 'Applicant').trim().replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${namePrefix}_Cover_Letter.txt`;
    const blob = new Blob([coverLetterText], { type: 'text/plain' });
    const file = new File([blob], fileName, { type: 'text/plain' });
    
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));

    return true;
  },

  attachGeneratedTextAsPdf(fileInput, text, fileName) {
    const { u8 } = this.buildGeneratedPdfPayload(text, fileName);
    const file = new File([u8], fileName, { type: 'application/pdf' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));

    return true;
  },

  buildGeneratedPdfPayload(text, fileName) {
    const lines = this.wrapCoverLetterLines(text, 92);
    const maxLines = 48;
    const enc = new TextEncoder();
    
    // Very basic uncompressed PDF builder (same as cover letter generator)
    let streamBody = '';
    let y = 750;
    let first = true;

    for (const line of lines) {
      if (y < 50) { y = 750; }
      if (first) {
        streamBody += `BT\n/F1 11 Tf\n50 ${y} Td\n`;
      }
      if (!first) streamBody += '0 -14 Td\n';
      first = false;
      streamBody += `(${this.escapePdfText(line)}) Tj\n`;
      y -= 14;
    }
    streamBody += 'ET';

    const streamLen = enc.encode(`${streamBody}\n`).length;

    let pdf = '%PDF-1.4\n';
    const offsets = {};
    const appendObj = (id, body) => {
      offsets[id] = pdf.length;
      pdf += body;
    };

    appendObj(1, `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    appendObj(2, `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
    appendObj(3, `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`);
    appendObj(4, `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamBody}\nendstream\nendobj\n`);
    appendObj(5, `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

    const xrefPos = pdf.length;
    const maxId = 5;
    pdf += `xref\n0 ${maxId + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let id = 1; id <= maxId; id++) {
      pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefPos}\n%%EOF`;

    const u8 = enc.encode(pdf);
    return { u8, fileName };
  },

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Main orchestration: fill all fields on the page
  async fillAllFields(detectedFields, profile, aiAnswers, resumeFile, coverLetterText) {
    let filled = 0;
    let failed = 0;
    const results = [];

    for (const field of detectedFields) {
      const purpose = classifyFieldPurpose(field.label, field.options || [], field.fieldType);

      let value = null;
      let success = false;

      if (purpose === 'resumeFile' && field.fieldType === 'file' && resumeFile) {
        // Attach resume
        success = await this.attachFile(field.element, resumeFile.data, resumeFile.fileName);
        results.push({ field: field.label, action: 'resume attached', success });
      } else if (purpose === 'coverLetter' && coverLetterText) {
        if (field.fieldType === 'file') {
          success = await this.attachCoverLetterAsFile(field.element, coverLetterText, profile.fullName || 'Applicant');
          results.push({ field: field.label, action: 'cover letter file attached', success });
        } else {
          success = await this.fillField(field.element, coverLetterText, field.fieldType);
          results.push({ field: field.label, action: 'cover letter text filled', success });
        }
      } else if (purpose === 'ai') {
        // Use AI-generated answer
        value = aiAnswers?.[field.id];
        if (value) {
          if (field.fieldType === 'radio' && field.allElements) {
            success = this.fillRadio(field.element, value, field.allElements);
          } else if (field.fieldType === 'aria-choice-group' && field.allElements) {
            success = this.fillAriaChoiceGroup(field.element, value, field.allElements);
          } else {
            success = await this.fillField(field.element, value, field.fieldType);
          }
          results.push({ field: field.label, action: 'AI answer', success });
        }
      } else {
        // Direct fill from profile
        value = getProfileValue(profile, purpose);
        if (value) {
          if (field.fieldType === 'radio' && field.allElements) {
            success = this.fillRadio(field.element, value, field.allElements);
          } else if (field.fieldType === 'aria-choice-group' && field.allElements) {
            success = this.fillAriaChoiceGroup(field.element, value, field.allElements);
          } else {
            success = await this.fillField(field.element, String(value), field.fieldType);
          }
          results.push({ field: field.label, action: `profile: ${purpose}`, success });
        }
      }

      if (success) {
        filled++;
        // Highlight filled field
        field.element.style.outline = '2px solid #34a853';
        field.element.style.outlineOffset = '2px';
      } else if (value !== null) {
        failed++;
        field.element.style.outline = '2px solid #ea4335';
        field.element.style.outlineOffset = '2px';
      }

      await this.delay(this.FILL_DELAY);
    }

    return { filled, failed, total: detectedFields.length, results };
  }
};
