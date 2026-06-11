/**
 * escapeHtml — sanitize untrusted strings for safe innerHTML interpolation.
 *
 * ⚠ Always use this helper when assigning dynamic content to innerHTML,
 * template literals in HTML strings, or title/content attribute values.
 *
 * Usage (content script / popup / options — loaded as a plain script tag):
 *   element.innerHTML = '<div>' + escapeHtml(userName) + '</div>';
 *
 * Usage (service worker — loaded via importScripts):
 *   const html = '<div>' + escapeHtml(userName) + '</div>';
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Node.js / test environment export guard
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
