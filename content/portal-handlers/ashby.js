PortalHandlers.register({
  name: 'Ashby',

  detect(url) {
    return /ashbyhq\.com/i.test(url) ||
      !!document.querySelector('.ashby-application-form-container, .ashby-survey-form-container, form[action*="ashby"]');
  },

  getFields() {
    const fields = [];
    const processed = new Set();

    const roots = collectAshbyRoots();
    const processedAria = new Set();

    const isVisible = (el) => el && el.offsetParent !== null;

    const textOf = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';

    const getChoiceLabel = (input, root) => {
      if (input.id) {
        const forLabel = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const explicit = textOf(forLabel);
        if (explicit) return explicit;
      }

      const wrapping = input.closest('label');
      if (wrapping) {
        const clone = wrapping.cloneNode(true);
        clone.querySelectorAll('input').forEach(el => el.remove());
        const wrapped = textOf(clone);
        if (wrapped) return wrapped;
      }

      const labelledBy = input.getAttribute('aria-labelledby');
      if (labelledBy) {
        const combined = labelledBy
          .split(/\s+/)
          .map(id => textOf(document.getElementById(id)))
          .filter(Boolean)
          .join(' ');
        if (combined) return combined;
      }

      const next = input.nextElementSibling;
      const nextText = textOf(next);
      if (nextText) return nextText;

      let ancestor = input.parentElement;
      let best = '';
      for (let i = 0; i < 6 && ancestor && ancestor !== root; i++) {
        const peers = Array.from(ancestor.querySelectorAll(`input[type="${input.type}"]`)).filter(isVisible);
        if (peers.length > 1) break;
        const clone = ancestor.cloneNode(true);
        clone.querySelectorAll('input, button, svg, img').forEach(el => el.remove());
        const text = textOf(clone);
        if (text) best = text;
        ancestor = ancestor.parentElement;
      }

      return best || input.value || '';
    };

    const getQuestionLabel = (container, fallback = '') => {
      if (!container) return fallback;

      const directSelectors = [
        'legend',
        ':scope > label',
        ':scope > h1',
        ':scope > h2',
        ':scope > h3',
        ':scope > h4',
        ':scope > p',
        ':scope > div > label'
      ];

      for (const selector of directSelectors) {
        const text = textOf(container.querySelector(selector));
        if (text) return text;
      }

      const labelled = container.getAttribute('aria-labelledby');
      if (labelled) {
        const text = labelled
          .split(/\s+/)
          .map(id => textOf(document.getElementById(id)))
          .filter(Boolean)
          .join(' ');
        if (text) return text;
      }

      const broadSelectors = [
        '[data-testid*="question"]',
        '[class*="question"]',
        '[class*="prompt"]',
        '[class*="label"]',
        '[class*="title"]'
      ];

      for (const selector of broadSelectors) {
        const candidate = container.querySelector(selector);
        const text = textOf(candidate);
        if (text) return text;
      }

      return fallback;
    };

    const findCheckboxGroup = (input, root) => {
      let current = input.parentElement;
      let best = null;

      for (let depth = 0; depth < 10 && current && current !== root; depth++) {
        const matches = Array.from(current.querySelectorAll('input[type="checkbox"]')).filter(isVisible);
        if (matches.length > 1) {
          // Ashby EEO race/ethnicity lists often have 8–12 checkboxes; old cap of 6 split them into junk single fields.
          best = { container: current, matches };
          if (getQuestionLabel(current)) break;
        }
        current = current.parentElement;
      }

      return best || { container: input.closest('fieldset, .ashby-survey-form-container, [class*="question"], [class*="field"]'), matches: [input] };
    };

    for (const root of roots) {
      root.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea').forEach(el => {
        if (processed.has(el) || !isVisible(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) fields.push(field);
      });

      root.querySelectorAll('select').forEach(el => {
        if (processed.has(el) || !isVisible(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.options = Array.from(el.options)
            .map(option => option.text)
            .filter(text => text && !/^--|select|choose/i.test(text.trim()));
          fields.push(field);
        }
      });

      // One field per unique radio name (Ashby uses either shared-name groups or one name per row).
      const radioNames = new Set();
      root.querySelectorAll('input[type="radio"]').forEach(el => {
        if (processed.has(el)) return;
        if (radioNames.has(el.name)) return;
        radioNames.add(el.name);

        const radios = Array.from(root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
          .filter(r => r.isConnected);
        if (radios.length === 0) return;
        radios.forEach(r => processed.add(r));

        const container = radios[0].closest(
          'fieldset, .form-group, .field, .question, [class*="field"], [class*="group"], [class*="question"], [class*="survey"], .ashby-survey-form-container, .ashby-application-form-container'
        ) || radios[0].closest('div');
        const label = getQuestionLabel(container, el.name || 'Radio question');

        fields.push({
          id: el.name || `ashby_radio_${fields.length}`,
          label,
          element: radios[0],
          allElements: radios,
          fieldType: 'radio',
          options: radios.map(r => getChoiceLabel(r, root))
        });
      });

      // Segmented / custom controls: ARIA radiogroup (not <input type="radio">), e.g. visa sponsorship Yes/No.
      root.querySelectorAll('[role="radiogroup"]').forEach(group => {
        if (processedAria.has(group) || !isVisible(group)) return;
        const options = Array.from(group.querySelectorAll('[role="radio"]')).filter(el =>
          el.closest('[role="radiogroup"]') === group && isVisible(el)
        );
        if (options.length < 2) return;
        processedAria.add(group);
        const host = group.closest('[class*="field"], [class*="Field"], [class*="question"], fieldset') ||
          group.parentElement;
        if (host) processedAria.add(host);
        const container = host;
        const label = getQuestionLabel(container, '') || textOf(group);
        fields.push({
          id: group.id || `ashby_rg_${fields.length}`,
          label: label || 'Choice question',
          element: options[0],
          allElements: options,
          fieldType: 'aria-choice-group',
          options: options.map(o => textOf(o) || o.getAttribute('aria-label') || '')
        });
      });

      // Fallback: visa/sponsorship row built from buttons or focusable divs (Ashby pill/segment UI).
      root.querySelectorAll('[class*="field"], [class*="Field"], [class*="question"], fieldset').forEach(scope => {
        if (processedAria.has(scope) || !isVisible(scope)) return;
        const scopeNorm = normalizeFieldText(textOf(scope));
        if (!scopeNorm.includes('visa') || !scopeNorm.includes('sponsorship')) return;

        const clickables = Array.from(scope.querySelectorAll(
          'button, [role="button"], [role="radio"], [type="button"], div[tabindex="0"]'
        )).filter(el => isVisible(el));

        const yesNoCells = clickables.filter(el => {
          const t = normalizeFieldText(textOf(el));
          return t === 'yes' || t === 'no';
        });
        if (yesNoCells.length < 2) return;

        processedAria.add(scope);
        scope.querySelectorAll('[role="radiogroup"]').forEach(g => processedAria.add(g));

        const labelNode = scope.querySelector('label, legend, [class*="label"], [class*="Label"], h3, h4, p');
        const labelText = textOf(labelNode) || textOf(scope).slice(0, 220);

        fields.push({
          id: scope.id || `ashby_visa_${fields.length}`,
          label: labelText,
          element: yesNoCells[0],
          allElements: yesNoCells,
          fieldType: 'aria-choice-group',
          options: yesNoCells.map(c => textOf(c))
        });
      });

      root.querySelectorAll('input[type="checkbox"]').forEach(el => {
        if (processed.has(el) || !isVisible(el)) return;

        const { container, matches } = findCheckboxGroup(el, root);
        const visibleMatches = matches.filter(isVisible);

        if (visibleMatches.length > 1) {
          visibleMatches.forEach(checkbox => processed.add(checkbox));
          fields.push({
            id: container?.id || visibleMatches[0].name || `ashby_checkbox_${fields.length}`,
            label: getQuestionLabel(container, visibleMatches[0].name || 'Checkbox question'),
            element: visibleMatches[0],
            allElements: visibleMatches,
            fieldType: 'checkbox-group',
            options: visibleMatches.map(c => getChoiceLabel(c, root))
          });
          return;
        }

        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.fieldType = 'checkbox';
          fields.push(field);
        }
      });

      root.querySelectorAll('input[type="file"]').forEach(el => {
        if (processed.has(el)) return;
        processed.add(el);
        const field = extractFieldInfo(el);
        if (field) {
          field.fieldType = 'file';
          fields.push(field);
        }
      });

      root.querySelectorAll('[contenteditable="true"]').forEach(el => {
        if (processed.has(el) || !isVisible(el)) return;
        processed.add(el);
        const label = el.getAttribute('aria-label') || getQuestionLabel(el.closest('[class*="question"], [class*="field"], .ashby-survey-form-container'), '');
        if (label) {
          fields.push({
            id: el.id || `ashby_ce_${fields.length}`,
            label,
            element: el,
            fieldType: 'contenteditable'
          });
        }
      });
    }

    return fields;
  },

  getJobDescription() {
    const selectors = [
      '[data-testid="job-posting-description"]',
      '.job-posting-description',
      '.ashby-job-posting-content',
      'main article',
      'article'
    ];

    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text && text.length > 100) return text;
    }

    return '';
  },

  getJobInfo() {
    const title = document.querySelector('h1, [data-testid="job-title"], [class*="title"]')?.textContent?.trim() || document.title;
    const company = document.querySelector('[data-testid="company-name"], [class*="company"], img[alt]')?.textContent?.trim() ||
      document.querySelector('img[alt]')?.alt?.trim() || '';
    return { title, company };
  }
});

function collectAshbyRoots() {
  const roots = new Set();
  document.querySelectorAll('.ashby-application-form-container').forEach(el => roots.add(el));
  document.querySelectorAll('.ashby-survey-form-container').forEach(el => roots.add(el));
  document.querySelectorAll('form[action*="ashby"]').forEach(el => roots.add(el));
  if (roots.size > 0) return Array.from(roots);
  return [document];
}
