PortalHandlers.register({
  name: 'iCIMS',

  detect(url) {
    return /icims\.com/i.test(url) ||
      !!document.querySelector('.iCIMS_MainWrapper, #iCIMS_Content');
  },

  getFields() {
    const fields = [];

    // iCIMS often uses iframes - try to access them
    const iframes = document.querySelectorAll('iframe[id*="icims"], iframe[src*="icims"]');
    const contexts = [document];

    iframes.forEach(iframe => {
      try {
        if (iframe.contentDocument) {
          contexts.push(iframe.contentDocument);
        }
      } catch (e) {
        // Cross-origin iframe, can't access
      }
    });

    contexts.forEach(ctx => {
      ctx.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="file"]), textarea, select').forEach(el => {
        if (el.offsetParent === null && ctx === document) return;
        const field = extractFieldInfo(el);
        if (field) {
          if (el.tagName === 'SELECT') {
            field.options = Array.from(el.options).map(o => o.text).filter(t => t && !t.startsWith('--'));
          }
          fields.push(field);
        }
      });

      // File inputs
      ctx.querySelectorAll('input[type="file"]').forEach(el => {
        const field = extractFieldInfo(el);
        if (field) {
          field.fieldType = 'file';
          fields.push(field);
        }
      });
    });

    return fields;
  },

  getJobDescription() {
    const desc = document.querySelector('.iCIMS_JobDescription, .iCIMS_InfoMsg_Job, [class*="description"]');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('.iCIMS_Header h1, .iCIMS_JobTitle, h1')?.textContent?.trim() || '';
    const company = document.querySelector('.iCIMS_CompanyName, .company')?.textContent?.trim() || '';
    return { title, company };
  }
});
