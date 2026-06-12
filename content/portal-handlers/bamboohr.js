/* BambooHR Portal Handler for Clyde Apply
 */

PortalHandlers.register({
  name: 'BambooHR',

  detect(url) {
    return /bamboohr\.(com|co\.uk)/i.test(url) || 
      !!document.querySelector('form[action*="bamboohr"]') ||
      !!document.querySelector('[id*="bamboohr"]');
  },

  getFields() {
    const fields = [];
    const processed = new Set();
    
    const isVisible = (el) => {
      if (!el || el.closest?.('[aria-hidden="true"]')) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      if (r.width >= 1 || r.height >= 1) return true;
      return true;
    };

    const inputs = FormFiller.querySelectorAllDeep('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), select, textarea');
    
    inputs.forEach(el => {
      if (processed.has(el) || !isVisible(el)) return;
      const field = extractFieldInfo(el);
      if (field) {
        processed.add(el);
        if (el.tagName === 'SELECT') {
          field.options = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select...');
        }
        fields.push(field);
      }
    });

    // Handle radio groups
    const radios = FormFiller.querySelectorAllDeep('input[type="radio"]');
    const radioGroups = {};
    radios.forEach(r => {
      const name = r.name || 'bamboohr_radio_group';
      if (!radioGroups[name]) {
        radioGroups[name] = [];
      }
      radioGroups[name].push(r);
    });

    for (const [name, elements] of Object.entries(radioGroups)) {
      const container = elements[0].closest('.form-field, .form-group, tr, td') || elements[0].parentNode;
      const label = container?.querySelector('label, span[class*="label"]')?.textContent?.trim() || '';
      const options = elements.map(r => {
        const radioLabel = r.closest('label')?.textContent?.trim() || r.nextSibling?.textContent?.trim() || r.value;
        return radioLabel;
      });
      fields.push({
        id: name,
        label: label || name,
        element: elements[0],
        allElements: elements,
        fieldType: 'radio',
        options
      });
    }

    // Handle files
    FormFiller.querySelectorAllDeep('input[type="file"]').forEach(el => {
      if (processed.has(el) || !isVisible(el)) return;
      const field = extractFieldInfo(el);
      if (field) {
        processed.add(el);
        field.fieldType = 'file';
        fields.push(field);
      }
    });

    return fields;
  },

  getJobDescription() {
    const selectors = [
      '.js-jobs-description',
      '#job-description',
      '.description',
      '.bamboo-description',
      '[class*="description"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 50) return el.textContent.trim();
    }
    return '';
  },

  getJobInfo() {
    const title = document.querySelector('.js-jobs-title, h1, .job-title')?.textContent?.trim() || '';
    const company = document.querySelector('.company-name, .logo img, [class*="company"]')?.textContent?.trim() || '';
    return { title, company };
  }
});
