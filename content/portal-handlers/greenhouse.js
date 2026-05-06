PortalHandlers.register({
  name: 'Greenhouse',

  detect(url) {
    return /greenhouse\.io/i.test(url) || !!document.querySelector('#application_form, #greenhouse-application');
  },

  getFields() {
    const fields = [];
    const form = document.querySelector('#application_form, form[action*="greenhouse"]') || document;

    // Standard input fields (skip Select2 search boxes — we use the real <select> via s2id_* below)
    form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea').forEach(el => {
      if (el.offsetParent === null) return; // skip hidden
      if (el.closest('[id^="s2id_"], .select2-container, [class*="select2-container"]')) return;
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Select dropdowns
    form.querySelectorAll('select').forEach(el => {
      if (el.offsetParent === null) return;
      const field = extractFieldInfo(el);
      if (field) {
        field.options = Array.from(el.options).map(o => o.text).filter(t => t && t !== '--');
        fields.push(field);
      }
    });

    // Custom Select2 dropdowns (Greenhouse uses these)
    form.querySelectorAll('[id^="s2id_"]').forEach(el => {
      const targetId = el.id.replace('s2id_', '');
      const select = document.getElementById(targetId);
      if (select && !fields.find(f => f.element === select)) {
        const field = extractFieldInfo(select);
        if (field) {
          field.options = Array.from(select.options).map(o => o.text).filter(t => t && t !== '--');
          field.customDropdown = 'select2';
          fields.push(field);
        }
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
    const desc = document.querySelector('.job-post-content, #content, .job_description');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('.app-title, .job-title, h1')?.textContent?.trim() || '';
    const company = document.querySelector('.company-name, .employer-name')?.textContent?.trim() || '';
    return { title, company };
  }
});
