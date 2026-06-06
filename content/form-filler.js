// Form filling engine - handles all element types with proper event dispatching

const FormFiller = {
  FILL_DELAY: 150, // ms between fills to avoid race conditions

  querySelectorDeep(selector, root = document) {
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
    const elements = Array.from(root.querySelectorAll(selector));
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

  getListboxElForField(fieldInput) {
    if (!fieldInput) return null;
    const interact = this.getComboboxInteractTarget(fieldInput);
    const chain = [
      interact?.closest?.('[role="combobox"]'),
      interact,
      fieldInput?.closest?.('[role="combobox"]'),
      fieldInput
    ].filter(Boolean);

    const isValidListbox = (el) => {
      if (!el) return false;
      if (el.contains(interact) || el.contains(fieldInput)) return false;
      const tag = el.tagName?.toLowerCase();
      if (['input', 'textarea', 'button'].includes(tag)) return false;
      
      const cn = String(el.className || '').toLowerCase();
      const id = String(el.id || '').toLowerCase();
      const role = String(el.getAttribute('role') || '').toLowerCase();
      // Exclude validation summaries, errors, alerts, warnings, and messages
      const isValidation = /\b(validation|error|alert|warning|tooltip|feedback|message)\b/i.test(cn + ' ' + id);
      if (isValidation && role !== 'listbox') {
        return false;
      }
      return true;
    };

    const seen = new Set();
    for (const node of chain) {
      if (seen.has(node)) continue;
      seen.add(node);
      const cid = node.getAttribute?.('aria-controls') || node.getAttribute?.('aria-owns') || node.getAttribute?.('list');
      if (cid) {
        try {
          const lb = this.querySelectorDeep(`#${CSS.escape(cid)}`);
          if (lb && isValidListbox(lb)) return lb;
        } catch {}
      }
    }

    // Fallback: search the parent shadow root (not the whole document) for any listbox-like element
    const rootNode = fieldInput.getRootNode();
    if (rootNode && rootNode !== document && typeof rootNode.querySelector === 'function') {
      const fb = rootNode.querySelector('[role="listbox"], ul, .results, [class*="results"], [class*="listbox"], [class*="dropdown"], [class*="list"]');
      if (fb && isValidListbox(fb)) return fb;
    }
    const container = fieldInput.closest?.('.field, [class*="group"], [class*="input"], [class*="wrapper"]');
    if (container) {
      const fb = this.querySelectorDeep('[role="listbox"], ul, .results, [class*="results"], [class*="listbox"], [class*="dropdown"], [class*="list"]', container);
      if (fb && isValidListbox(fb)) return fb;
    }

    // Fallback 2: Search globally (crossing shadow roots) for visible listbox-like elements
    try {
      const visibleListboxes = this.querySelectorAllDeep(
        '[role="listbox"], ul, .results, sf-typeahead-items, sf-autocomplete-items, ' +
        '[class*="results"], [class*="listbox"], [class*="dropdown"], [class*="menu"], ' +
        '[class*="autocomplete-panel"], [class*="suggestions-panel"], [class*="dropdown-panel"], ' +
        '[class*="overlay"], [class*="typeahead"], [class*="autocomplete"], [class*="suggestions"], ' +
        '[class*="popover"], [class*="selection"], [class*="options"], ' +
        '[class*="spl-listbox"], [class*="spl-dropdown"], [class*="spl-menu"], [class*="spl-select"], ' +
        '[class*="spl-typeahead"], [class*="spl-autocomplete"], [class*="spl-option"], [class*="spl-popup"], [class*="spl-overlay"]'
      ).filter(el => {
        if (!isValidListbox(el)) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 10;
      });

      // Strict constraint: If there is exactly one visible listbox on the page, use it
      if (visibleListboxes.length === 1) {
        return visibleListboxes[0];
      }

      // If there are multiple, resolve by high-confidence proximity (tighter 120px threshold)
      if (visibleListboxes.length > 1) {
        const isPositionedNear = (inputEl, candidateEl) => {
          const r1 = inputEl.getBoundingClientRect();
          const r2 = candidateEl.getBoundingClientRect();
          if (r2.width === 0 || r2.height === 0) return false;
          const vertDist = Math.min(Math.abs(r2.top - r1.bottom), Math.abs(r2.bottom - r1.top));
          const horizDist = Math.max(0, r1.left - r2.right, r2.left - r1.right);
          return vertDist <= 120 && horizDist <= 120;
        };
        const nearby = visibleListboxes.filter(el => isPositionedNear(interact, el));
        if (nearby.length === 1) {
          return nearby[0];
        }
      }
    } catch {}

    return null;
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
      normalizedLabel.includes(normalizedAnswer) ||
      normalizedOptionValue.includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizedLabel) ||
      normalizedAnswer.includes(normalizedOptionValue)
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

  async fillField(element, value, fieldType) {
    if (!element || value === undefined || value === null || value === '') return false;

    switch (fieldType) {
      case 'text':
      case 'textarea':
        return this.fillTextInput(element, value);
      case 'select':
        return this.fillSelect(element, value);
      case 'radio':
        return this.fillRadio(element, value);
      case 'checkbox':
        return this.fillCheckbox(element, value);
      case 'checkbox-group':
        return this.fillCheckboxGroup(element, value);
      case 'custom-dropdown':
        return this.fillCustomDropdown(element, value);
      case 'contenteditable':
        return this.fillContentEditable(element, value);
      case 'file':
        return false; // handled separately
      default:
        return this.fillTextInput(element, value);
    }
  },

  fieldHintsLookLikeLocation(element) {
    const blob = [
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

  async fillTextInput(element, value) {
    const interact = this.getComboboxInteractTarget(element);
    
    // Phone number cleaning & formatting
    const isPhone = element.type === 'tel' || 
                    interact.type === 'tel' || 
                    /\b(phone|mobile|cell|telephone)\b/i.test(element.id + ' ' + element.name + ' ' + (element.getAttribute('placeholder') || '') + ' ' + interact.id + ' ' + interact.name);
    
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

    const isTypeahead =
      element.getAttribute('role') === 'combobox' ||
      element.getAttribute('aria-autocomplete') != null ||
      element.getAttribute('aria-haspopup') != null ||
      element.getAttribute('list') != null ||
      element.closest('[role="combobox"]') != null ||
      this.isGreenhouseRemixComboboxInput(element) ||
      (() => {
        const host = element.getRootNode()?.host;
        const chain = [element, host].filter(Boolean);
        for (const el of chain) {
          if (/typeahead|autocomplete|combobox|search/i.test(el.className || '') ||
              /typeahead|autocomplete|combobox|search/i.test(el.tagName || '')) {
            return true;
          }
        }
        const container = element.closest('.field, [class*="input"], [class*="wrapper"]');
        if (container) {
          if (container.tagName.toLowerCase().includes('spl-') && !container.querySelector('spl-select, [class*="select"]')) {
             return false;
          }
          if (container.querySelector('svg, .icon, [class*="icon"], [class*="search"]') || 
              /typeahead|autocomplete|combobox|search/i.test(container.className || '')) {
            return true;
          }
        }
        return false;
      })();

    const locationLike = this.fieldHintsLookLikeLocation(element);

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
    if (!el || el.getAttribute('aria-disabled') === 'true') return false;
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

  async fireKey(element, key, code, keyCode) {
    const createEvent = (type) => {
      const ev = new KeyboardEvent(type, {
        key,
        code,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      Object.defineProperty(ev, 'keyCode', { value: keyCode, configurable: true });
      Object.defineProperty(ev, 'which', { value: keyCode, configurable: true });
      return ev;
    };
    element.dispatchEvent(createEvent('keydown'));
    await this.delay(15);
    element.dispatchEvent(createEvent('keyup'));
  },

  collectListboxOptions(listbox) {
    if (!listbox) return [];
    if (listbox.classList?.contains('flatpickr-calendar') || /flatpickr/i.test(listbox.className || '')) {
      const calendarOpts = this.querySelectorAllDeep('.flatpickr-monthSelect-month, .flatpickr-day, .flatpickr-month, span.flatpickr-monthSelect-month', listbox);
      if (calendarOpts.length > 0) {
        return [...new Set(calendarOpts)].filter(o => this.isVisibleOption(o));
      }
    }
    let opts = this.querySelectorAllDeep('[role="option"], sf-typeahead-item, sf-autocomplete-item', listbox);
    if (opts.length === 0) {
      opts = this.querySelectorAllDeep('li, a, [class*="option"], [class*="item"], [class*="result"], [class*="choice"], [class*="select"]', listbox);
    }
    return [...new Set(opts)].filter(o => this.isVisibleOption(o));
  },

  async waitForDropdownToClose(lb, timeoutMs = 2000) {
    if (!lb) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!document.body.contains(lb)) return;
      const style = window.getComputedStyle(lb);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const opts = this.collectListboxOptions(lb);
      if (opts.length === 0) return;
      await this.delay(50);
    }
  },

  async waitForOptions(fieldInput, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const lb = this.getListboxElForField(fieldInput);
      if (lb) {
        const visible = this.collectListboxOptions(lb);
        if (visible.length > 0) {
          return { lb, visible };
        }
      }
      await this.delay(100);
    }
    return { lb: null, visible: [] };
  },

  async pickTypeaheadOption(fieldInput, value) {
    // Intercept invalid dates for calendar/date-picker fields to prevent library crashes
    const isDateRelated = (el) => {
      const label = String(el.getAttribute('aria-label') || el.placeholder || el.id || el.name || '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      return type === 'date' || /\b(date|from|to|year|calendar|month)\b/i.test(label) || /pick\s+a\s+date/i.test(el.placeholder || '');
    };
    
    if (isDateRelated(fieldInput)) {
      const v = String(value).trim().toLowerCase();
      if (v === 'not provided' || v === 'unknown' || v === 'none' || v === 'null') {
        console.log(`[JobAutoFill] Intercepted and skipped invalid date string "${value}" for calendar field`);
        return true; // return success safely without writing
      }
    }

    const interact = this.getComboboxInteractTarget(fieldInput);
    const logHint = fieldInput.getAttribute('aria-label') || fieldInput.placeholder || fieldInput.id ||
      interact.getAttribute('aria-label') || interact.id || interact.getAttribute('name') || '';
    console.log(`[JobAutoFill Debug] pickTypeaheadOption started for "${logHint}" value="${value}"`);
    const valueStr = String(value).trim();
    const valueLower = valueStr.toLowerCase();
    const strictShort = /^(yes|no)$/i.test(valueStr);

    const cleanCompareText = (str) => {
      return String(str || '')
        .toLowerCase()
        .replace(/[’'"]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const targetClean = cleanCompareText(valueStr);

    let typeValue = valueStr;
    if (/[’'"]/.test(typeValue)) {
      typeValue = typeValue.replace(/[’'"]/g, '');
    }

    const optionText = (option) => {
      const raw = option.getAttribute('aria-label') || option.textContent || '';
      return raw.replace(/\s+/g, ' ').trim().toLowerCase();
    };

    const pickBestOption = (visible, isFlatpickr = false) => {
      if (!visible.length) return null;
      
      const validOptions = visible.filter(o => {
        const text = optionText(o);
        return text.length > 0 && !/^select\.{0,3}$/i.test(text);
      });
      
      if (!validOptions.length) return null;

      const pool = strictShort ? validOptions : validOptions;
      const searchIn = pool;

      let exact = null;
      for (const option of searchIn) {
        const text = optionText(option);
        if (text === valueLower || cleanCompareText(text) === targetClean) {
          exact = option;
          break;
        }
      }
      if (exact) {
        console.log(`[JobAutoFill Debug] pickBestOption matched EXACT option: "${optionText(exact)}"`);
        return exact;
      }
      if (strictShort) return null;

      let partial = null;
      for (const option of visible) {
        const text = optionText(option);
        const textClean = cleanCompareText(text);
        if (text.includes(valueLower) || 
            textClean.includes(targetClean) || 
            (text && valueLower.includes(text.split(',')[0]?.trim())) ||
            (textClean && targetClean.includes(textClean.split(' ')[0]?.trim()))) {
          partial = option;
          break;
        }
      }
      if (partial) {
        console.log(`[JobAutoFill Debug] pickBestOption matched PARTIAL option: "${optionText(partial)}"`);
        return partial;
      }

      if (isFlatpickr) {
        return null;
      }

      const highlighted = visible.find(o => o.getAttribute('aria-selected') === 'true') ||
        visible.find(o => /highlight|focus|active/i.test(String(o.className || '')));
      if (highlighted) {
        console.log(`[JobAutoFill Debug] pickBestOption fallback to HIGHLIGHTED option: "${optionText(highlighted)}"`);
        return highlighted;
      }
      
      console.log(`[JobAutoFill Debug] pickBestOption fallback to FIRST option: "${optionText(visible[0])}"`);
      return visible[0];
    };

    const triggerReactChange = (el) => {
      const reactPropsKey = Object.keys(el).find(key => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
      if (reactPropsKey && el[reactPropsKey] && el[reactPropsKey].onChange) {
        try {
          el[reactPropsKey].onChange({ target: el, currentTarget: el });
        } catch (e) {}
      }
    };

    const isWritableInput = (el) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
    };

    const dispatchEvents = (el, val) => {
      if (!el) return;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      triggerReactChange(el);
    };

    const hasInteractInput = interact && interact !== fieldInput && isWritableInput(interact);

    // Step 1: Incremental Focus-Secured Typing
    await this.typeValueIncrementally(fieldInput, typeValue);
    await this.delay(100);

    // Step 2: Trigger Dropdown Opening (Via ArrowDown Key)
    this.fireKey(interact, 'ArrowDown', 'ArrowDown', 40);
    
    // Step 3: Wait for Dropdown Options (State Machine Transition to DropdownRendered)
    let { lb, visible } = await this.waitForOptions(fieldInput, 3500);

    console.log(`[JobAutoFill Debug] Found ${visible.length} options inside listbox:`, visible.map(o => optionText(o)));

    const isFp = !!(lb && (lb.classList?.contains('flatpickr-calendar') || /flatpickr/i.test(lb.className || '')));
    const best = pickBestOption(visible, isFp);

    const commitBestOptionViaKeyboard = async (keyTarget, visibleOptions, bestOption) => {
      const idx = visibleOptions.indexOf(bestOption);
      if (idx < 0) return false;
      
      keyTarget.focus();
      await this.delay(100);
      
      console.log(`[JobAutoFill Debug] Navigating to option at index ${idx} via ArrowDown...`);
      for (let i = 0; i <= idx; i++) {
        this.fireKey(keyTarget, 'ArrowDown', 'ArrowDown', 40);
        await this.delay(100);
      }
      
      console.log(`[JobAutoFill Debug] Pressing Enter to select option...`);
      this.fireKey(keyTarget, 'Enter', 'Enter', 13);
      await this.delay(300);
      return true;
    };

    if (best) {
      console.log(`[JobAutoFill Debug] Selected best option: "${optionText(best)}"`);
      
      // Step 4: Keyboard Selection Commit (Highly framework-compatible)
      let committed = false;
      try {
        committed = await commitBestOptionViaKeyboard(interact, visible, best);
      } catch (e) {
        console.warn('[JobAutoFill] Keyboard selection commit failed:', e);
      }

      // Verify if value is now successfully populated
      const ev = this.getEffectiveInputValue(fieldInput).toLowerCase().replace(/\s+/g, ' ').trim();
      const hasValue = ev && !/^select\.{0,3}$/i.test(ev);

      // Fallback: Dispatch pointer/hover & mouse click sequence
      if (!committed || !hasValue) {
        console.log('[JobAutoFill Debug] Keyboard commit did not populate value. Falling back to Mouse Click...');
        try {
          best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          best.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
          best.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, cancelable: false }));
          best.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          best.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false }));
          best.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          best.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          best.click();
          await this.delay(250);
        } catch (e) {
          console.warn('[JobAutoFill] Mouse click selection failed:', e);
        }
      }

      dispatchEvents(fieldInput, fieldInput.value);
      try {
        interact.blur();
        if (fieldInput !== interact) fieldInput.blur();
      } catch (e) {}
      
      if (hasInteractInput) {
        dispatchEvents(interact, interact.value);
      }

      // Step 5: Wait for Dropdown Closure to prevent sibling cross-contamination
      await this.waitForDropdownToClose(lb);
      await this.delay(50);
      return true;
    }

    // Fallback: Try document-wide option search
    const searchRoots = [];
    const pac = document.querySelector('.pac-container');
    if (pac) searchRoots.push(pac);
    const formScope = fieldInput.closest('form, #application_form, [id*="application"]');
    if (formScope) searchRoots.push(formScope);
    const questionScope = fieldInput.closest('[class*="question"], .application-question, [data-question-id]');
    if (questionScope) searchRoots.push(questionScope);
    searchRoots.push(document.body);

    const tryPickFromRoot = (root) => {
      if (!root) return null;
      const candidates = [];
      const sel = [
        '[role="option"]',
        '[role="listbox"] li',
        '[class*="menu"] [role="option"]',
        '[class*="Menu"] [role="option"]',
        '.pac-item',
        '.MuiAutocomplete-option',
        '[class*="Autocomplete-option"]',
        '[class*="LocationSuggestion"]',
        'li[role="menuitem"]'
      ].join(', ');
      this.querySelectorAllDeep(sel, root).forEach(o => candidates.push(o));
      const vis = [...new Set(candidates)].filter(o => this.isVisibleOption(o));
      const fp = !!(root && (root.classList?.contains('flatpickr-calendar') || /flatpickr/i.test(root.className || '')));
      return pickBestOption(vis, fp);
    };

    for (const root of searchRoots) {
      const fb = tryPickFromRoot(root);
      if (fb) {
        fb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        try {
          fb.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
          fb.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, cancelable: false }));
          fb.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          fb.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false }));
          fb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          fb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          fb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          fb.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        } catch (e) {}
        fb.click();
        await this.delay(250);
        
        dispatchEvents(fieldInput, fieldInput.value);
        try {
          interact.blur();
          if (fieldInput !== interact) fieldInput.blur();
        } catch (e) {}
        
        if (hasInteractInput) {
          dispatchEvents(interact, interact.value);
        }
        const fbParentListbox = fb.closest('[role="listbox"], ul, [class*="listbox"], [class*="dropdown"], [class*="menu"]');
        if (fbParentListbox) {
          await this.waitForDropdownToClose(fbParentListbox);
        }
        return true;
      }
    }

    // Step 6: Blind Keyboard Commit Fallback
    console.log(`[JobAutoFill Debug] Blind keyboard commit fallback on "${logHint}"`);
    try {
      interact.focus();
      await this.delay(100);
      this.fireKey(interact, 'ArrowDown', 'ArrowDown', 40);
      await this.delay(150);
      this.fireKey(interact, 'Enter', 'Enter', 13);
      await this.delay(250);
      
      // Check if value was committed
      const ev = this.getEffectiveInputValue(fieldInput).toLowerCase().replace(/\s+/g, ' ').trim();
      if (ev && !/^select\.{0,3}$/i.test(ev)) {
        console.log(`[JobAutoFill Debug] Blind keyboard commit succeeded for "${logHint}" (value: "${ev}")`);
        try {
          interact.blur();
          if (fieldInput !== interact) fieldInput.blur();
        } catch (e) {}
        const activeLb = this.getListboxElForField(fieldInput);
        if (activeLb) {
          await this.waitForDropdownToClose(activeLb);
        }
        return true;
      }
    } catch (e) {
      console.warn(`[JobAutoFill] Blind keyboard commit failed for "${logHint}":`, e);
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

  fillCheckbox(element, value) {
    const shouldCheck = /^(yes|true|1|checked|agree)$/i.test(String(value));
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
    // Click to open the dropdown
    element.click();
    await this.delay(300);

    // Look for dropdown options that appeared
    const valueLower = String(value).toLowerCase().trim();
    const optionSelectors = [
      '[role="option"]', '[role="listbox"] li', '.dropdown-option',
      '.select-option', '[class*="option"]', 'li[data-value]',
      '[data-automation-id*="option"]'
    ];

    for (const selector of optionSelectors) {
      const options = document.querySelectorAll(selector);
      for (const option of options) {
        if (option.textContent.trim().toLowerCase().includes(valueLower) ||
            valueLower.includes(option.textContent.trim().toLowerCase())) {
          option.click();
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
