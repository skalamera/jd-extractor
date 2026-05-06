PortalHandlers.register({
  name: 'Workday',

  detect(url) {
    return /myworkdayjobs\.com|workday\.com\/.*\/job/i.test(url) ||
      !!document.querySelector('[data-automation-id]');
  },

  getFields() {
    const fields = [];

    // Workday uses data-automation-id attributes extensively
    const automationFields = document.querySelectorAll('[data-automation-id]');
    const processed = new Set();

    automationFields.forEach(container => {
      // Find inputs within or as the element
      const inputs = container.matches('input, textarea, select')
        ? [container]
        : container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea, select');

      inputs.forEach(el => {
        if (processed.has(el) || el.offsetParent === null) return;
        processed.add(el);

        const automationId = el.closest('[data-automation-id]')?.getAttribute('data-automation-id') || '';
        const field = extractFieldInfo(el);
        if (field) {
          field.automationId = automationId;
          fields.push(field);
        }
      });
    });

    // Also scan for any remaining visible inputs not caught above
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea, select').forEach(el => {
      if (processed.has(el) || el.offsetParent === null) return;
      processed.add(el);
      const field = extractFieldInfo(el);
      if (field) fields.push(field);
    });

    // Custom dropdowns (Workday uses div-based dropdowns)
    document.querySelectorAll('[data-automation-id*="dropdown"], [data-automation-id*="select"]').forEach(el => {
      if (processed.has(el)) return;
      const label = el.closest('[data-automation-id]')?.querySelector('label')?.textContent?.trim() ||
        el.getAttribute('aria-label') || '';
      if (label) {
        fields.push({
          id: el.getAttribute('data-automation-id') || `wd_${fields.length}`,
          label,
          element: el,
          fieldType: 'custom-dropdown',
          automationId: el.getAttribute('data-automation-id')
        });
      }
    });

    // File inputs
    document.querySelectorAll('input[type="file"]').forEach(el => {
      if (processed.has(el)) return;
      const field = extractFieldInfo(el);
      if (field) {
        field.fieldType = 'file';
        fields.push(field);
      }
    });

    return fields;
  },

  getJobDescription() {
    const desc = document.querySelector('[data-automation-id="jobPostingDescription"], .job-description, [data-automation-id="job-posting-description"]');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('[data-automation-id="jobPostingHeader"], h1, [data-automation-id="job-title"]')?.textContent?.trim() || '';
    const company = document.querySelector('[data-automation-id="companyName"], .css-1h46us2')?.textContent?.trim() || '';
    return { title, company };
  }
});
