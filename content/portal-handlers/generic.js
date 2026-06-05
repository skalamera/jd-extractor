// Generic handler - fallback for unrecognized ATS/job sites
const GenericHandler = {
  name: 'Generic',

  detect() {
    return true; // always matches as fallback
  },

  getFields() {
    const fields = [];
    const contexts = [document];

    const processed = new Set();

    const isElementVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    };

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

    const getChoiceLabel = (input) => {
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

      const next = input.nextElementSibling;
      if (next && !['INPUT', 'SELECT', 'TEXTAREA'].includes(next.tagName)) {
        const text = next.textContent.trim();
        if (text) return text;
      }

      let ancestor = input.parentElement;
      let best = '';
      for (let i = 0; i < 4 && ancestor; i++) {
        if (ancestor.querySelectorAll(`input[type="${CSS.escape(input.type)}"]`).length > 1) break;
        const clone = ancestor.cloneNode(true);
        clone.querySelectorAll('input, button, svg, img').forEach(el => el.remove());
        const text = clone.textContent.trim();
        if (text) best = text;
        ancestor = ancestor.parentElement;
      }

      return best || input.value || '';
    };

    const getGroupContainer = (input, inputType) => {
      const selectors = [
        'fieldset',
        '.form-group',
        '.form-field',
        '.field',
        '.question',
        '.application-question',
        '[class*="survey"]',
        '[class*="question"]',
        '[class*="fieldset"]',
        '[class*="field"]',
        '[class*="group"]'
      ];

      for (const selector of selectors) {
        const container = input.closest(selector);
        if (!container) continue;

        const matches = Array.from(container.querySelectorAll(`input[type="${inputType}"]`))
          .filter(isElementVisible);
        if (matches.length > 1) return { container, matches };
      }

      return { container: null, matches: [input] };
    };

    const getGroupLabel = (container, fallback = '') => {
      if (!container) return fallback;

      const selectors = [
        'legend',
        ':scope > label',
        ':scope > .label',
        ':scope > h2',
        ':scope > h3',
        ':scope > h4',
        ':scope > p',
        '[data-testid*="question"]',
        '[class*="question"]',
        '[class*="prompt"]',
        '[class*="label"]'
      ];

      for (const selector of selectors) {
        const label = container.querySelector(selector);
        const text = label?.textContent?.trim();
        if (text) return text;
      }

      return fallback;
    };

    contexts.forEach(ctx => {
      console.log(`[JobAutoFill Debug] getFields started. Document has:`, {
        allInputsCount: document.querySelectorAll('input').length,
        allDeepInputsCount: querySelectorAllDeep('input').length,
        visibleInputsCount: Array.from(document.querySelectorAll('input')).filter(el => isElementVisible(el)).length,
        visibleDeepInputsCount: querySelectorAllDeep('input').filter(el => isElementVisible(el)).length,
        textInputsFound: querySelectorAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea', ctx).length
      });

      // Text inputs and textareas
      querySelectorAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) fields.push(field);
      });

      // Selects
      querySelectorAllDeep('select', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.options = Array.from(el.options).map(o => o.text).filter(t => t.trim() && !t.startsWith('--') && t !== 'Select' && t !== 'Select...' && t !== 'Choose...');
          fields.push(field);
        }
      });

      // Radio groups
      const radioNames = new Set();
      querySelectorAllDeep('input[type="radio"]', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;
        if (radioNames.has(el.name)) return;
        radioNames.add(el.name);
        const radios = querySelectorAllDeep(`input[type="radio"][name="${CSS.escape(el.name)}"]`, ctx);
        const container = el.closest('fieldset, .form-group, .field, .question, [class*="field"], [class*="group"], [class*="question"], [class*="survey"]') ||
          el.closest('div');
        const label = getGroupLabel(container, el.name);
        const options = Array.from(radios).map(getChoiceLabel);

        radios.forEach(radio => processed.add(radio));
        fields.push({
          id: el.name || `radio_${fields.length}`,
          label,
          element: radios[0],
          allElements: Array.from(radios),
          fieldType: 'radio',
          options
        });
      });

      // Checkbox groups
      querySelectorAllDeep('input[type="checkbox"]', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;

        const { container, matches } = getGroupContainer(el, 'checkbox');
        if (matches.length > 1) {
          const options = matches.map(getChoiceLabel);
          const label = getGroupLabel(container, el.name || options[0] || `checkbox_${fields.length}`);

          matches.forEach(checkbox => processed.add(checkbox));
          fields.push({
            id: container?.id || el.name || `checkbox_group_${fields.length}`,
            label,
            element: matches[0],
            allElements: matches,
            fieldType: 'checkbox-group',
            options
          });
        }
      });

      // Standalone checkboxes
      querySelectorAllDeep('input[type="checkbox"]', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.fieldType = 'checkbox';
          fields.push(field);
        }
      });

      // File inputs
      querySelectorAllDeep('input[type="file"]', ctx).forEach(el => {
        if (processed.has(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.fieldType = 'file';
          fields.push(field);
        }
      });

      // Contenteditable fields
      querySelectorAllDeep('[contenteditable="true"]', ctx).forEach(el => {
        if (processed.has(el) || !isElementVisible(el)) return;
        processed.add(el);
        const label = el.getAttribute('aria-label') ||
          el.closest('.field, .form-group')?.querySelector('label')?.textContent?.trim() || '';
        if (label) {
          fields.push({
            id: el.id || `ce_${fields.length}`,
            label,
            element: el,
            fieldType: 'contenteditable'
          });
        }
      });
    });

    return fields;
  },

  getJobDescription() {
    // Try common selectors for job descriptions
    const selectors = [
      '.job-description', '.job_description', '#job-description',
      '[class*="description"]', '[id*="description"]',
      '.posting-requirements', '.job-details',
      'article', '.content'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        return el.textContent.trim();
      }
    }
    return '';
  },

  getJobInfo() {
    const title = document.querySelector('h1, [class*="title"]')?.textContent?.trim() || document.title;
    const company = document.querySelector('[class*="company"], [class*="employer"]')?.textContent?.trim() || '';
    return { title, company };
  }
};
