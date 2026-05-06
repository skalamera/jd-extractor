PortalHandlers.register({
  name: 'LinkedIn',

  detect(url) {
    return /linkedin\.com\/jobs/i.test(url) ||
      !!document.querySelector('.jobs-easy-apply-content, .jobs-apply-form');
  },

  getFields() {
    const fields = [];
    const form = document.querySelector('.jobs-easy-apply-content, .jobs-apply-form, .artdeco-modal__content') || document;

    // Text inputs (LinkedIn uses artdeco-text-input)
    form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]):not([type="checkbox"]):not([type="radio"])').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Textareas
    form.querySelectorAll('textarea').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Select dropdowns
    form.querySelectorAll('select').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) {
        field.options = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select an option');
        fields.push(field);
      }
    });

    // Radio button groups
    const radioGroups = new Map();
    form.querySelectorAll('input[type="radio"]').forEach(el => {
      const name = el.name;
      if (!radioGroups.has(name)) {
        radioGroups.set(name, []);
      }
      radioGroups.get(name).push(el);
    });

    radioGroups.forEach((radios, name) => {
      const container = radios[0].closest('.fb-dash-form-element, .jobs-easy-apply-form-section__grouping');
      const label = container?.querySelector('legend, label, span[aria-hidden="true"]')?.textContent?.trim() || name;
      const options = radios.map(r => {
        return r.closest('label')?.textContent?.trim() || r.value;
      });
      fields.push({
        id: name || `linkedin_radio_${fields.length}`,
        label,
        element: radios[0],
        allElements: radios,
        fieldType: 'radio',
        options
      });
    });

    // Checkboxes
    form.querySelectorAll('input[type="checkbox"]').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) {
        field.fieldType = 'checkbox';
        fields.push(field);
      }
    });

    // File inputs
    form.querySelectorAll('input[type="file"]').forEach(el => {
      const field = extractFieldInfo(el);
      if (field) {
        field.fieldType = 'file';
        fields.push(field);
      }
    });

    return fields;
  },

  getJobDescription() {
    const desc = document.querySelector('.jobs-description__content, .job-view-layout .description__text, #job-details');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24')?.textContent?.trim() || '';
    const company = document.querySelector('.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .company-name')?.textContent?.trim() || '';
    return { title, company };
  },

  // LinkedIn Easy Apply has multiple steps
  isMultiStep() {
    return true;
  },

  getNextButton() {
    return document.querySelector('button[aria-label="Continue to next step"], button[aria-label="Review your application"], footer button.artdeco-button--primary');
  }
});
