/**
 * clyde-client.js — API client for communicating with Clyde Desktop App
 * via its local HTTP API server on port 4593.
 *
 * Used by the Clyde Go Chrome Extension to sync job descriptions,
 * tailored documents, and active cockpit context.
 */

const CLYDE_DEFAULT_HOST = '127.0.0.1';
const CLYDE_DEFAULT_PORT = 4593;
const CLYDE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBaseUrl(host, port, secure) {
  const proto = secure ? 'https' : 'http';
  return `${proto}://${host || CLYDE_DEFAULT_HOST}:${port || CLYDE_DEFAULT_PORT}/api`;
}

async function request(method, path, body = null, options = {}) {
  const baseUrl = getBaseUrl(options.host, options.port, options.secure);
  const url = `${baseUrl}${path}`;

  let pairingToken = options.pairingToken;
  if (!pairingToken && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const stored = await chrome.storage.local.get('clydePairingToken');
    pairingToken = stored.clydePairingToken;
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  if (pairingToken) {
    headers['Authorization'] = `Bearer ${pairingToken}`;
  }

  const fetchOptions = {
    method,
    headers,
    signal: AbortSignal.timeout(options.timeout || CLYDE_TIMEOUT_MS)
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (response.status === 401) {
    throw new Error('Unauthorized: Invalid or missing pairing code. Please update it in Clyde Go settings.');
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if Clyde's local API server is reachable.
 * @param {object} [options] - { host?, port?, secure? }
 * @returns {Promise<{ available: boolean, version?: string }>}
 */
async function isAvailable(options = {}) {
  try {
    const data = await request('GET', '/status', null, options);
    return {
      available: true,
      version: data.version,
      status: data.status
    };
  } catch (_) {
    return { available: false };
  }
}

/**
 * Get Clyde's current settings (safe subset).
 * @param {object} [options]
 * @returns {Promise<object>} settings object
 */
async function getSettings(options = {}) {
  const data = await request('GET', '/settings', null, options);
  return data.settings;
}

/**
 * Update Clyde's settings.
 * @param {object} settings - Partial settings object to update
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function updateSettings(settings, options = {}) {
  return request('POST', '/settings', settings, options);
}

/**
 * Sync a clipped job description to Clyde.
 * @param {string} company - Company name
 * @param {string} jdText - Job description text
 * @param {string} [role] - Job role/title
 * @param {object} [options]
 * @param {object} [analysis] - Optional match analysis { score, topStrength, mainGap, mitigation }
 * @returns {Promise<object>}
 */
async function syncJobToClyde(company, jdText, role = '', options = {}, analysis = {}) {
  const body = {
    company,
    role,
    jdText,
    matchScore: analysis.score !== undefined ? analysis.score : undefined,
    topStrength: analysis.topStrength || '',
    mainGap: analysis.mainGap || '',
    mitigation: analysis.mitigation || ''
  };
  return request('POST', '/jobs', body, options);
}

/**
 * Save a tailored document (resume, cover letter, STAR+R) to Clyde's knowledge base.
 * @param {object} params
 * @param {string} params.company - Company name
 * @param {string} params.content - Document content
 * @param {string} [params.role] - Job role
 * @param {string} [params.filename] - Display filename
 * @param {string} [params.type='other'] - Document type (resume, cover-letter, star-r, question-bank, other)
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function saveTailoredDocToClyde({ company, content, role, filename, type = 'other' }, options = {}) {
  return request('POST', '/documents', { company, role, filename, content, type }, options);
}

/**
 * Set the active cockpit context in Clyde (switches focal view).
 * @param {object} params
 * @param {string} params.jobDescription - Full job description text
 * @param {string} params.companyName - Company name
 * @param {string} [params.roleName] - Job role
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function syncActiveCockpit({ jobDescription, companyName, roleName }, options = {}) {
  return request('POST', '/cockpit/active', { jobDescription, companyName, roleName }, options);
}

/**
 * Sync a job's tracker status back to Clyde.
 * @param {string} company - Company name
 * @param {string} status - Tracker status (Applied, Interviewing, Rejected)
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function syncJobStatusToClyde(company, status, options = {}) {
  return request('POST', '/jobs/status', { company, status }, options);
}

// Export as a module — available in both options.js and popup.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAvailable,
    getSettings,
    updateSettings,
    syncJobToClyde,
    saveTailoredDocToClyde,
    syncActiveCockpit,
    syncJobStatusToClyde
  };
} else {
  // Expose globally for Chrome Extension CSP compliance (no eval/new Function)
  const globalObj = typeof window !== 'undefined' ? window : self;
  globalObj.ClydeClient = {
    isAvailable,
    getSettings,
    updateSettings,
    syncJobToClyde,
    saveTailoredDocToClyde,
    syncActiveCockpit,
    syncJobStatusToClyde
  };
}
