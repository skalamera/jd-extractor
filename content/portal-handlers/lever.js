PortalHandlers.register({
  name: 'Lever',

  detect(url) {
    return /jobs\.lever\.co/i.test(url) || !!document.querySelector('.application-form');
  },

  getFields() {
    const fields = [];
    const processed = new Set();
    const form = document.querySelector('.application-form, form[action*="lever"]') || document;

    const isVisible = (el) => {
      if (!el || el.closest?.('[aria-hidden="true"]')) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      if (r.width >= 1 && r.height >= 1) return true;
      const inApplyForm = el.closest?.('.application-form, form[action*="lever"]');
      if (inApplyForm && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return true;
      return false;
    };

    const textLike =
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]):not([type="radio"]):not([type="checkbox"])';

    const pushExtracted = (el) => {
      if (processed.has(el) || !isVisible(el)) return;
      const field = extractFieldInfo(el);
      if (!field) return;
      processed.add(el);
      fields.push(field);
    };

    // Legacy cards + current layouts: custom sections may omit `.application-question`.
    form.querySelectorAll(`.application-question ${textLike}, .application-question textarea`).forEach(pushExtracted);
    form.querySelectorAll(`${textLike}, textarea`).forEach(pushExtracted);

    // Selects
    form.querySelectorAll('select').forEach(el => {
      if (processed.has(el) || !isVisible(el)) return;
      const field = extractFieldInfo(el);
      if (field) {
        processed.add(el);
        field.options = Array.from(el.options).map(o => o.text).filter(t => t && t !== 'Select...');
        fields.push(field);
      }
    });

    // Radio groups
    form.querySelectorAll('.application-question').forEach(container => {
      const radios = container.querySelectorAll('input[type="radio"]');
      if (radios.length === 0) return;
      const label = container.querySelector('.application-label, label')?.textContent?.trim() || '';
      const options = Array.from(radios).map(r => {
        const radioLabel = r.closest('label')?.textContent?.trim() || r.nextSibling?.textContent?.trim() || r.value;
        return radioLabel;
      });
      fields.push({
        id: radios[0].name || `radio_${fields.length}`,
        label,
        element: radios[0],
        allElements: Array.from(radios),
        fieldType: 'radio',
        options
      });
    });

    // File inputs (dedupe if already picked up as part of a question card)
    form.querySelectorAll('input[type="file"]').forEach(el => {
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
    const desc = document.querySelector('.posting-page .section-wrapper .content, [data-qa="posting-description"]');
    return desc?.textContent?.trim() || '';
  },

  getJobInfo() {
    const title = document.querySelector('.posting-headline h2, .posting-title')?.textContent?.trim() || '';
    const company = document.querySelector('.posting-headline .company, .main-header-logo img')?.alt?.trim() || '';
    return { title, company };
  }
});
