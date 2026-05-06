PortalHandlers.register({
  name: 'Taleo',

  detect(url) {
    return /taleo\.net|oracle\.com\/.*\/hcmUI/i.test(url) ||
      !!document.querySelector('#requisitionDescriptionInterface, .taleo-apply');
  },

  getFields() {
    const fields = [];

    // Taleo uses various ID patterns
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Select dropdowns
    document.querySelectorAll('select').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) {
        field.options = Array.from(el.options).map(o => o.text).filter(t => t && !t.startsWith('--') && t !== 'Select');
        fields.push(field);
      }
    });

    // Radio groups
    const radioNames = new Set();
    document.querySelectorAll('input[type="radio"]').forEach(el => {
      if (radioNames.has(el.name)) return;
      radioNames.add(el.name);

      const radios = document.querySelectorAll(`input[type="radio"][name="${el.name}"]`);
      const container = el.closest('tr, .field-container, .form-group');
      const label = container?.querySelector('label, .label, td:first-child')?.textContent?.trim() || el.name;
      const options = Array.from(radios).map(r => {
        return r.closest('label')?.textContent?.trim() || r.nextSibling?.textContent?.trim() || r.value;
      });

      fields.push({
        id: el.name || `taleo_radio_${fields.length}`,
        label,
        element: radios[0],
        allElements: Array.from(radios),
        fieldType: 'radio',
        options
      });
    });

    // File inputs
    document.querySelectorAll('input[type="file"]').forEach(el => {
      const field = extractFieldInfo(el);
      if (field) {
        field.fieldType = 'file';
        fields.push(field);
      }
    });

    return fields;
  },

  getJobDescription() {
    const desc = document.querySelector('#requisitionDescriptionInterface, .requisition-description, .job-description');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('.requisition-title, .job-title, h1')?.textContent?.trim() || '';
    const company = '';
    return { title, company };
  }
});
