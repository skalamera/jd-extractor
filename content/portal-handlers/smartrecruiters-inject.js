(function() {
  const script = document.currentScript;
  if (!script) return;
  const op = script.getAttribute('data-op');
  const tid = script.getAttribute('data-temp-id');
  const val = script.getAttribute('data-val');
  if (!tid || !val) return;

  const findDeep = (selector, root = document) => {
    const el = root.querySelector(selector);
    if (el) return el;
    const walk = (r) => {
      const all = r.querySelectorAll('*');
      for (const child of all) {
        if (child.shadowRoot) {
          const found = child.shadowRoot.querySelector(selector);
          if (found) return found;
          const nested = walk(child.shadowRoot);
          if (nested) return nested;
        }
      }
      return null;
    };
    return walk(root);
  };

  const el = findDeep(`[data-clyde-temp="${tid}"]`);
  if (!el) return;

  if (op === 'date') {
    let fp = null;
    let curr = el;
    while (curr) {
      if (curr._flatpickr) {
        fp = curr._flatpickr;
        break;
      }
      curr = curr.parentNode || curr.host;
    }

    if (fp && typeof fp.setDate === 'function') {
      try {
        fp.setDate(val, true);
        if (typeof fp.close === 'function') {
          fp.close();
        }
      } catch (e) {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      }
    } else {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    }
  } else if (op === 'phone') {
    // Brute-force focus and type incrementally to satisfy Angular's masking directive
    el.focus();
    el.value = '';
    for (let i = 0; i < val.length; i++) {
      const char = val[i];
      el.value += char;
      
      const keyEvDown = new KeyboardEvent('keydown', { key: char, code: 'Digit' + char, bubbles: true, cancelable: true, composed: true });
      const keyEvUp = new KeyboardEvent('keyup', { key: char, code: 'Digit' + char, bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(keyEvDown);
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
      el.dispatchEvent(keyEvUp);
    }
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    el.blur();
  }

  el.removeAttribute('data-clyde-temp');
})();