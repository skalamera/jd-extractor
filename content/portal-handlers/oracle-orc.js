/* Oracle Recruiting Cloud (ORC) Portal Handler for Clyde Apply
 * Handles Oracle JET-based custom input elements (Shadow DOM).
 */

PortalHandlers.register({
  name: 'OracleRecruitingCloud',

  detect(url) {
    return /oraclecloud\.com/i.test(url) || 
      /candidateExperience/i.test(url) ||
      !!document.querySelector('oj-input-text, oj-select-one, oj-text-area, oj-checkbox-set, oj-radioset, .oj-form');
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
      
      // Oracle JET nested custom inputs inside Shadow DOM
      const jetWrapper = el.closest('oj-input-text, oj-select-one, oj-text-area, oj-combobox-one');
      let label = '';
      if (jetWrapper) {
        label = jetWrapper.getAttribute('label-hint') || jetWrapper.getAttribute('aria-label') || jetWrapper.placeholder || '';
      }

      const field = extractFieldInfo(el);
      if (field) {
        processed.add(el);
        if (label) field.label = label;
        if (el.tagName === 'SELECT') {
          field.options = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select...');
        }
        fields.push(field);
      }
    });

    // Handle radios/checkbox sets
    const radios = FormFiller.querySelectorAllDeep('input[type="radio"]');
    const radioGroups = {};
    radios.forEach(r => {
      const name = r.name || 'orc_radio_group';
      if (!radioGroups[name]) {
        radioGroups[name] = [];
      }
      radioGroups[name].push(r);
    });

    for (const [name, elements] of Object.entries(radioGroups)) {
      const container = elements[0].closest('oj-radioset, .oj-form-control, tr, td, .form-group') || elements[0].parentNode;
      let label = container?.getAttribute('label-hint') || container?.querySelector('label, .oj-label')?.textContent?.trim() || '';
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
      '.description-text',
      '.job-description',
      '[class*="job-description"]',
      '#job-description',
      '.jd-content',
      '.oj-heading'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 50) return el.textContent.trim();
    }
    return '';
  },

  getJobInfo() {
    const title = document.querySelector('.job-title, h1, .oj-heading')?.textContent?.trim() || '';
    const company = document.querySelector('.company-name, .employer, .logo img')?.alt?.trim() || '';
    return { title, company };
  }
});
