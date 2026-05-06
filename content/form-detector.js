// Shared field extraction utility used by all portal handlers

/** Textareas often sit after headings / .application-label with no placeholder (Lever, etc.). */
function getTextareaContextLabel(el) {
  if (el.tagName !== 'TEXTAREA') return '';

  const fromSiblingsBefore = (node) => {
    const p = node.parentElement;
    if (!p) return '';
    const kids = [...p.children];
    const idx = kids.indexOf(node);
    if (idx <= 0) return '';
    const parts = [];
    for (let i = 0; i < idx; i++) {
      const c = kids[i];
      if (['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT'].includes(c.tagName)) continue;
      const tx = c.textContent.replace(/\s+/g, ' ').trim();
      if (tx.length > 2 && tx.length < 2000) parts.push(tx);
    }
    return parts.length ? parts.join(' ') : '';
  };

  const fromPrevChain = (node) => {
    const bits = [];
    let w = node.previousElementSibling;
    for (let i = 0; i < 14 && w; i++, w = w.previousElementSibling) {
      if (['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT'].includes(w.tagName)) continue;
      const tx = w.textContent.replace(/\s+/g, ' ').trim();
      if (tx.length > 2 && tx.length < 2000) bits.push(tx);
    }
    return bits.length ? bits.reverse().join(' ') : '';
  };

  let s = fromSiblingsBefore(el);
  if (s) return s;
  s = fromPrevChain(el);
  if (s) return s;

  let a = el.parentElement;
  for (let d = 0; d < 14 && a; d++, a = a.parentElement) {
    const direct = [...a.children].find(c => c !== el && c.contains?.(el));
    if (direct) {
      const kids = [...a.children];
      const idx = kids.indexOf(direct);
      if (idx > 0) {
        const parts = [];
        for (let i = 0; i < idx; i++) {
          const c = kids[i];
          if (['SCRIPT', 'STYLE', 'SVG'].includes(c.tagName)) continue;
          const tx = c.textContent.replace(/\s+/g, ' ').trim();
          if (tx.length > 2 && tx.length < 2000) parts.push(tx);
        }
        if (parts.length) return parts.join(' ');
      }
    }
  }

  return '';
}

function extractFieldInfo(element) {
  const id = element.id || element.name || `field_${Math.random().toString(36).slice(2, 8)}`;
  let label = getFieldLabel(element);
  const type = element.type || element.tagName.toLowerCase();

  if (!label && !element.placeholder && element.tagName === 'TEXTAREA') {
    label = getTextareaContextLabel(element);
  }

  if (!label && !element.placeholder) return null; // skip unlabeled fields

  const field = {
    id,
    label: label || element.placeholder || id,
    element,
    fieldType: classifyFieldType(type, element),
    inputType: type
  };

  return field;
}

function getFieldLabel(element) {
  // 1. Explicit label via for attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. aria-label
  if (element.getAttribute('aria-label')) {
    return element.getAttribute('aria-label').trim();
  }

  // 3. aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  // 4. Parent label
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(el => el.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // 5. Preceding label sibling
  const prev = element.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') {
    const pt = prev.textContent.trim();
    if (pt) return pt;
  }

  // 5b. Lever: question copy in .application-label
  const leverCard = element.closest('.application-question, .application-field');
  if (leverCard) {
    const appLab = leverCard.querySelector('.application-label');
    if (appLab) {
      const t = appLab.textContent.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }

  // 6. Nearest label in parent container
  const container = element.closest('.field, .form-group, .form-field, .question, .application-question, [class*="field"], [class*="group"]');
  if (container) {
    const label = container.querySelector('label, .label, legend, [class*="label"]');
    if (label) {
      const t = label.textContent.trim();
      if (t) return t;
    }
  }

  // 7. Placeholder as last resort
  return element.placeholder || '';
}

function classifyFieldType(type, element) {
  if (type === 'file') return 'file';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (element.tagName === 'SELECT') return 'select';
  if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  return 'text';
}

function normalizeFieldText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bdon't\b/g, 'do not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyFieldPurpose(label, options = [], fieldType = null) {
  const l = normalizeFieldText(label);
  const optionsText = normalizeFieldText(Array.isArray(options) ? options.join(' ') : '');
  const bareLabel = l.replace(/\*+$/g, '').trim();

  // File uploads: label often says "Attach" / "Upload" (Greenhouse) — not "Resume".
  if (fieldType === 'file') {
    if (/\bcover\s*letter\b/.test(l)) return 'coverLetter';
    // Ashby: "Optional Upload" + cover-letter copy; must run before generic /\bupload\b/ → resumeFile
    if (/\boptional\b/.test(l) && /\bupload\b/.test(l)) return 'coverLetter';
    if (/\badditional\b|\bsupplemental\b/.test(l) && /\b(upload|file|document)\b/.test(l) && !/\bresume\b|\bcv\b/.test(l)) {
      return 'coverLetter';
    }
    if (/\bresume\b|\bcv\b|\bcurriculum vitae\b|\bcurriculum\b/.test(l)) return 'resumeFile';
    if (/\battach\b|\bupload\b|\bchoose\s+file\b|\bbrowse\b/.test(l)) return 'resumeFile';
    if (/^(attach|upload|browse|choose file|file)$/.test(bareLabel)) return 'resumeFile';
  }

  // Direct profile fields
  if (/\b(first\s*name|given\s*name)\b/.test(l)) return 'firstName';
  if (/\b(last\s*name|surname|family\s*name)\b/.test(l)) return 'lastName';
  if (/\b(full\s*name|your\s*name)\b/.test(l) && !/company|business/.test(l)) return 'fullName';
  if (/^name[*\s]*$/.test(l)) return 'fullName'; // bare "Name" field
  if (/\bemail\b/.test(l) && !/company|work|employer/.test(l)) return 'email';
  if (/\b(phone|mobile|cell|telephone)\b/.test(l)) return 'phone';

  // Address
  if (/\b(street|address\s*(line)?\s*1?)\b/.test(l) && !/email/.test(l)) return 'address.street';
  if (/\bcity\b/.test(l)) return 'address.city';
  if (/\b(state|province)\b/.test(l)) return 'address.state';
  if (/\b(zip|postal)\s*(code)?\b/.test(l)) return 'address.zip';
  if (/\bcountry\b/.test(l)) return 'address.country';

  // For choice fields, option text is often more reliable than a mislabeled container.
  if (optionsText) {
    if (/\b(she\/her|he\/him|they\/them|prefer not to answer)\b/.test(optionsText)) return 'pronouns';
    if (/\b(i acknowledge|privacy policy)\b/.test(optionsText)) return 'acknowledgement';
    if (/\b(can work for any employer|can work for current employer|seeking work authorization)\b/.test(optionsText)) return 'workAuthorizationStatus';
    if (/\bi am local to the location hub\b/.test(optionsText)) return 'relocation';
    if (/\bi'd like to discuss this further\b/.test(optionsText)) return 'officeAttendance';
    if (/\bprotected veteran\b/.test(optionsText)) return 'veteranStatus';
    if (/\bhave a disability\b/.test(optionsText)) return 'disabilityStatus';
    if (/\b(man|woman|male|female|non binary|decline to self identify)\b/.test(optionsText)) return 'gender';
    if (/\b(hispanic|latino|asian|african|caucasian|pacific islander|alaska native)\b/.test(optionsText)) return 'ethnicity';
    if (/\byes\b/.test(optionsText) && /\bno\b/.test(optionsText) &&
        (/\bvisa\b/.test(l) || /\bsponsorship\b/.test(l))) return 'sponsorship';
  }

  // Links
  if (/\blinkedin\b/.test(l)) return 'linkedinUrl';
  if (/\bgithub\b/.test(l)) return 'githubUrl';
  if (/\b(portfolio|website|personal\s*site)\b/.test(l)) return 'portfolioUrl';

  // Standard questions
  if (/\bpronouns?\b/.test(l) || /\b(she\/her|he\/him|they\/them|prefer not to answer)\b/.test(optionsText)) return 'pronouns';
  if (/\b(acknowledge|acknowledgement|acknowledgments|applicant privacy policy|privacy policy)\b/.test(l)) return 'acknowledgement';
  // Lever essay under a "Work authorization status" heading — must win over the header keyword.
  if (/\bwill you\b.*\brequire\b.*\bsponsorship\b/.test(l)) return 'sponsorship';
  if ((/\bwork authorization status\b/.test(l) && !/\brequire\b.*\bsponsorship\b/.test(l)) ||
      /\b(can work for any employer|can work for current employer|seeking work authorization)\b/.test(optionsText)) {
    return 'workAuthorizationStatus';
  }
  if (/\brelocat/.test(l) || /\bi am local to the location hub\b/.test(optionsText)) return 'relocation';
  if (/\b(hybrid work model|work from our office|monday, tuesday, and thursday)\b/.test(l) ||
      /\bi'd like to discuss this further\b/.test(optionsText)) {
    return 'officeAttendance';
  }
  // Ashby: section title "Work Authorization" with long employer/sponsorship choices — not simple visa sponsorship.
  if (/\bwork\s+authorization\b/.test(l)) return 'workAuthorizationStatus';
  if (/\bvisa\b.*\bsponsorship\b|\bsponsorship\b.*\bvisa\b/.test(l) || /\bsponsorship\b/.test(l)) return 'sponsorship';
  if (/\bauthoriz/.test(l) && !/status|seeking|type|branch/.test(l) &&
      !/\blegally\s+authorized\b/.test(l) && !/\bauthorized\s+to\s+work\b/.test(l) &&
      !/\bwork\s+authorization\b/.test(l)) return 'sponsorship';
  if ((/\bveteran\b/.test(l) && !/branch|service/.test(l)) || /\bprotected veteran\b/.test(optionsText)) return 'veteranStatus';
  if (/\bdisabilit/.test(l) || /\bhave a disability\b/.test(optionsText)) return 'disabilityStatus';
  if (/identification\s+of\s+disability/i.test(l)) return 'disabilityStatus';
  if (/\bgender\b/.test(l) || /\b(man|woman|male|female|non binary|decline to self identify)\b/.test(optionsText)) return 'gender';
  if (/\bmost\s+closely\s+identify\b/.test(l) && /\b(racial|ethnic)\b/.test(l)) return 'ethnicity';
  if (/\brace\b/.test(l) && !/brace|trace/.test(l)) return 'ethnicity';
  if (/\b(ethnicity)\b/.test(l) || /\b(hispanic|latino|asian|african|caucasian|pacific islander|alaska native)\b/.test(optionsText)) return 'ethnicity';
  if (/\b(salary|compensation|pay)\b/.test(l)) return 'desiredSalary';
  if (/\b(start\s*date|available|earliest)\b/.test(l)) return 'earliestStartDate';
  if (/\b(years?\s*(of)?\s*experience)\b/.test(l)) return 'yearsOfExperience';

  // File fields (non-file elements with resume-like labels)
  if (/\bresume\b|\bcv\b|\bcurriculum/.test(l)) return 'resumeFile';
  if (/\bcover\s*letter\b/.test(l)) return 'coverLetter';
  if (/\banything else you want to share\b/.test(l) || /\badd a cover letter\b/.test(l)) return 'coverLetter';

  // Anything else needs AI
  return 'ai';
}

// Get nested value from profile object
function getProfileValue(profile, path) {
  if (!profile) return undefined;

  switch (path) {
    case 'acknowledgement':
      return profile.acknowledgement || profile.acknowledgements || 'I acknowledge';
    case 'workAuthorizationStatus':
      if (profile.workAuthorizationStatus) return profile.workAuthorizationStatus;
      if (normalizeFieldText(profile.sponsorship) === 'no') {
        return 'I am authorized to work for any employer';
      }
      return undefined;
    case 'sponsorship': {
      const s = normalizeFieldText(profile.sponsorship || '');
      if (s === 'yes') {
        return 'Yes';
      }
      if (s === 'no') {
        return 'No';
      }
      return profile.sponsorship;
    }
    case 'pronouns':
    case 'relocation':
    case 'officeAttendance':
      return profile[path];
    default:
      return path.split('.').reduce((obj, key) => obj?.[key], profile);
  }
}
