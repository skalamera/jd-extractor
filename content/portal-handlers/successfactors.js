/* SAP SuccessFactors Portal Handler for Clyde Apply
 */

PortalHandlers.register({
  name: 'SuccessFactors',

  detect(url) {
    return /successfactors\./i.test(url) || 
      !!document.querySelector('[id*="successfactors"]') || 
      !!document.querySelector('form[id*="career_ns"]') ||
      !!document.querySelector('[id*="_rcm_"]') ||
      !!document.querySelector('.sapUiLayoutGrid');
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
      return true; // fallback for complex/iframe SAP tables
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
      const name = r.name || 'sf_radio_group';
      if (!radioGroups[name]) {
        radioGroups[name] = [];
      }
      radioGroups[name].push(r);
    });

    for (const [name, elements] of Object.entries(radioGroups)) {
      const container = elements[0].closest('.sapUiLayoutGrid, .sapMRbg, tr, td, .form-group, .form-field') || elements[0].parentNode;
      const label = container?.querySelector('label, .sapMLabel')?.textContent?.trim() || '';
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

    // Handle file inputs
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
      '.jobdescription',
      '#job-description',
      '[id*="job-description"]',
      '.sapMText[id*="jobDescription"]',
      '.SAPJobDescription',
      '.job-details',
      '.sapMPage'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 50) return el.textContent.trim();
    }
    return '';
  },

  getJobInfo() {
    const title = document.querySelector('.jobTitle, .sapMTitle, h1, [id*="jobTitle"]')?.textContent?.trim() || '';
    const company = document.querySelector('.company, .sapMLabel[id*="company"], .logo img')?.alt?.trim() || '';
    return { title, company };
  }
});
