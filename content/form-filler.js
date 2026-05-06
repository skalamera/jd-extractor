// Form filling engine - handles all element types with proper event dispatching

const FormFiller = {
  FILL_DELAY: 150, // ms between fills to avoid race conditions

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

    const q = fieldInput.closest(
      '[data-question-id], [data-question], .application-question, [class*="application-question"], [class*="ApplicationQuestion"], [class*="question-"], fieldset, .field'
    );
    if (q) {
      const cand = q.querySelectorAll(
        '[role="combobox"], input[class*="remix-css"], input[id^="question_"], input[name^="question_"]'
      );
      for (const el of cand) {
        if (el === fieldInput) continue;
        if (this.isTinyOrAriaHidden(el)) continue;
        return el;
      }
      const btn = q.querySelector('button[type="button"]:not([disabled])');
      if (btn && !this.isTinyOrAriaHidden(btn)) return btn;
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
    const seen = new Set();
    for (const node of chain) {
      if (seen.has(node)) continue;
      seen.add(node);
      const cid = node.getAttribute?.('aria-controls') || node.getAttribute?.('aria-owns') || node.getAttribute?.('list');
      if (cid) {
        const lb = document.getElementById(cid);
        if (lb) return lb;
      }
    }
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
      element.getAttribute('data-qa')
    ].filter(Boolean).join(' ');
    return /\blocation\b/i.test(blob);
  },

  async typeIncrementalForAutocomplete(element, valueStr) {
    const interact = this.getComboboxInteractTarget(element);
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    interact.focus();
    await this.delay(70);
    if (nativeInputValueSetter) nativeInputValueSetter.call(element, '');
    else element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    const s = String(valueStr);
    for (let i = 0; i < s.length; i += 2) {
      const part = s.slice(i, i + 2);
      const next = (element.value || '') + part;
      if (nativeInputValueSetter) nativeInputValueSetter.call(element, next);
      else element.value = next;
      try {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: part
        }));
      } catch {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await this.delay(35);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    // Try to trigger React 16/17+ internal change handlers directly if native setter isn't enough
    const reactPropsKey = Object.keys(element).find(key => key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
    if (reactPropsKey && element[reactPropsKey] && element[reactPropsKey].onChange) {
      try {
        element[reactPropsKey].onChange({ target: element, currentTarget: element });
      } catch (e) {}
    }
    await this.delay(450);
  },

  async fillTextInput(element, value) {
    const interact = this.getComboboxInteractTarget(element);
    interact.focus();

    // Clear existing value
    element.value = '';

    // Use the native setter to bypass React/Vue controlled components
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    // Dispatch events in the correct order for framework compatibility
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: String(value)
      }));
    } catch {
      /* InputEvent unsupported */
    }

    if (interact !== element && interact.tagName === 'INPUT' && nativeInputValueSetter) {
      nativeInputValueSetter.call(interact, value);
      interact.dispatchEvent(new Event('input', { bubbles: true }));
      interact.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const isTypeahead =
      element.getAttribute('role') === 'combobox' ||
      element.getAttribute('aria-autocomplete') != null ||
      element.getAttribute('aria-haspopup') != null ||
      element.getAttribute('list') != null ||
      element.closest('[role="combobox"]') != null ||
      this.isGreenhouseRemixComboboxInput(element);

    const locationLike = this.fieldHintsLookLikeLocation(element);

    if (isTypeahead) {
      if (locationLike) await this.delay(450);
      let picked = await this.pickTypeaheadOption(element, value);
      if (!picked) picked = await this.pickTypeaheadOption(element, value);
      if (!picked && locationLike) {
        await this.typeIncrementalForAutocomplete(element, value);
        picked = await this.pickTypeaheadOption(element, value);
      }
      if (!picked && locationLike) {
        picked = await this.pickTypeaheadOption(element, value);
      }
      if (picked) return true;
      const v = this.getEffectiveInputValue(element);
      if (v && !/^select\.{0,3}$/i.test(v)) return true;
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      return false;
    }

    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  },

  isVisibleOption(el) {
    if (!el || el.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    return el.offsetParent !== null || style.position === 'fixed';
  },

  fireKey(element, key, code, keyCode) {
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true
    }));
  },

  collectListboxOptions(listbox) {
    if (!listbox) return [];
    const opts = [...listbox.querySelectorAll('[role="option"]')];
    return [...new Set(opts)].filter(o => this.isVisibleOption(o));
  },

  async tryComboboxKeyboardCommit(keyTarget, visibleOptions, bestOption) {
    const idx = visibleOptions.indexOf(bestOption);
    if (idx < 0) return;
    keyTarget.focus();
    await this.delay(50);
    for (let i = 0; i <= idx; i++) {
      this.fireKey(keyTarget, 'ArrowDown', 'ArrowDown', 40);
      await this.delay(50);
    }
    this.fireKey(keyTarget, 'Enter', 'Enter', 13);
    await this.delay(100);
  },

  async pickTypeaheadOption(fieldInput, value) {
    const interact = this.getComboboxInteractTarget(fieldInput);
    const logHint = fieldInput.getAttribute('aria-label') || fieldInput.placeholder || fieldInput.id ||
      interact.getAttribute('aria-label') || interact.id || interact.getAttribute('name') || '';
    console.log(`[JobAutoFill] pickTypeaheadOption for "${logHint}" value="${value}"`);
    const valueStr = String(value).trim();
    const valueLower = valueStr.toLowerCase();
    const strictShort = /^(yes|no)$/i.test(valueStr);

    const optionText = (option) => {
      const raw = option.getAttribute('aria-label') || option.textContent || '';
      return raw.replace(/\s+/g, ' ').trim().toLowerCase();
    };

    const pickBestOption = (visible) => {
      if (!visible.length) return null;
      const notPlaceholder = (o) => !/^select\.{0,3}$/i.test(optionText(o));
      const pool = strictShort ? visible.filter(notPlaceholder) : visible;
      const searchIn = pool.length ? pool : visible;

      let exact = null;
      for (const option of searchIn) {
        const text = optionText(option);
        if (text === valueLower) {
          exact = option;
          break;
        }
      }
      if (exact) return exact;
      if (strictShort) return null;

      let partial = null;
      for (const option of visible) {
        const text = optionText(option);
        if (text.includes(valueLower) || (text && valueLower.includes(text.split(',')[0]?.trim()))) {
          partial = option;
          break;
        }
      }
      if (partial) return partial;

      const highlighted = visible.find(o => o.getAttribute('aria-selected') === 'true') ||
        visible.find(o => /highlight|focus|active/i.test(String(o.className || '')));
      if (highlighted) return highlighted;
      return visible[0];
    };

    const tryOpenAndCollect = async () => {
      interact.focus();
      await this.delay(80);
      let lb = this.getListboxElForField(fieldInput);
      let visible = this.collectListboxOptions(lb);
      if (visible.length) return { lb, visible };

      this.fireKey(interact, 'ArrowDown', 'ArrowDown', 40);
      await this.delay(200);
      lb = this.getListboxElForField(fieldInput);
      visible = this.collectListboxOptions(lb);
      if (visible.length) return { lb, visible };

      this.fireKey(interact, ' ', 'Space', 32);
      await this.delay(200);
      lb = this.getListboxElForField(fieldInput);
      visible = this.collectListboxOptions(lb);
      if (visible.length) return { lb, visible };

      const r = interact.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== interact && typeof hit.click === 'function') {
          hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          hit.click();
        } else {
          interact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
          interact.click();
        }
      } else {
        interact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        interact.click();
      }
      await this.delay(250);
      lb = this.getListboxElForField(fieldInput);
      visible = this.collectListboxOptions(lb);
      return { lb, visible };
    };

    await this.delay(200);

    for (let attempt = 0; attempt < 5; attempt++) {
      const { visible } = await tryOpenAndCollect();
      const best = pickBestOption(visible);
      if (best) {
        if (strictShort) {
          await this.tryComboboxKeyboardCommit(interact, visible, best);
          await this.delay(120);
          const ev = this.getEffectiveInputValue(fieldInput).toLowerCase().replace(/\s+/g, ' ').trim();
          if (ev === valueLower) {
            fieldInput.dispatchEvent(new Event('blur', { bubbles: true }));
            await this.delay(50);
            return true;
          }
        }

        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        best.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        best.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
        best.click();

        await this.delay(220);
        fieldInput.dispatchEvent(new Event('input', { bubbles: true }));
        fieldInput.dispatchEvent(new Event('change', { bubbles: true }));
        fieldInput.dispatchEvent(new Event('blur', { bubbles: true }));
        await this.delay(50);
        return true;
      }
      await this.delay(120);
    }

    const lb0 = this.getListboxElForField(fieldInput);
    const searchRoots = [];
    if (lb0) searchRoots.push(lb0);
    const pac = document.querySelector('.pac-container');
    if (pac) searchRoots.push(pac);
    const formScope = fieldInput.closest('form, #application_form, [id*="application"]');
    if (formScope) searchRoots.push(formScope);
    const questionScope = fieldInput.closest(
      '[class*="question"], .application-question, [data-question-id], [class*="application-question"]'
    );
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
      root.querySelectorAll(sel).forEach(o => candidates.push(o));
      const visible = [...new Set(candidates)].filter(o => this.isVisibleOption(o));
      return pickBestOption(visible);
    };

    let best = null;
    for (const root of searchRoots) {
      best = tryPickFromRoot(root);
      if (best) break;
    }

    if (!best) return false;

    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    best.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    best.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
    best.click();

    await this.delay(220);
    fieldInput.dispatchEvent(new Event('input', { bubbles: true }));
    fieldInput.dispatchEvent(new Event('change', { bubbles: true }));
    fieldInput.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
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
      element.dispatchEvent(new Event('change', { bubbles: true }));
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
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      radio.checked = true;
      radio.click();
      radio.dispatchEvent(new Event('change', { bubbles: true }));
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
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('click', { bubbles: true }));
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
          checkbox.dispatchEvent(new Event('click', { bubbles: true }));
        }
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
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
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
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

      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));

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

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    return true;
  },

  attachGeneratedTextAsPdf(fileInput, text, fileName) {
    const { u8 } = this.buildGeneratedPdfPayload(text, fileName);
    const file = new File([u8], fileName, { type: 'application/pdf' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

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
