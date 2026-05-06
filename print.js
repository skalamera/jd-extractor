const params = new URLSearchParams(location.search);
const key = params.get("key");
const pdfCanary = globalThis.PdfAdversarialCanary;
const pdfCanaryKey = pdfCanary ? pdfCanary.STORAGE_KEY : "enableAdversarialPdfCanary";

if (!key) {
  document.body.textContent = "No content key provided.";
} else {
  chrome.storage.local.get({ [key]: null, [pdfCanaryKey]: false }, (data) => {
    const html = data[key];
    chrome.storage.local.remove(key);

    if (!html) {
      document.body.textContent = "Content not found — it may have already been loaded.";
      return;
    }

    // Parse the generated CV/cover HTML without executing any scripts
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Remove the loading spinner styles from the extension page
    const loadingStyle = document.getElementById("_loading_style");
    if (loadingStyle) loadingStyle.remove();

    // Move <style> and Google Fonts <link> elements into our <head>
    doc.querySelectorAll("style, link[rel='stylesheet']").forEach(el => {
      document.head.appendChild(document.adoptNode(el));
    });

    // Replace body with CV/cover content
    document.body.innerHTML = doc.body.innerHTML;

    if (pdfCanary && pdfCanary.shouldInclude(data)) {
      pdfCanary.appendToDocument(document);
    }

    // Update page title
    document.title = doc.title || "Document";

    // Add "Save as PDF" button via DOM API — no inline handler, CSP-compliant
    const btn = document.createElement("button");
    btn.id = "_tc_btn";
    btn.textContent = "Save as PDF \u2193";
    btn.addEventListener("click", () => window.print());
    document.body.appendChild(btn);

    // Button + print-suppression styles added programmatically (no inline)
    const uiStyle = document.createElement("style");
    uiStyle.textContent =
      "@media print { #_tc_btn { display: none !important; } }" +
      "#_tc_btn {" +
      "  position: fixed; bottom: 24px; right: 24px; z-index: 99999;" +
      "  background: linear-gradient(135deg, hsl(187, 74%, 32%), hsl(270, 70%, 45%));" +
      "  color: #ffffff; border: none; padding: 12px 22px;" +
      "  border-radius: 8px; font: 600 13px/1 system-ui, sans-serif;" +
      "  cursor: pointer; box-shadow: 0 4px 16px rgba(139,92,246,.4);" +
      "  letter-spacing: 0.02em; transition: opacity 0.15s;" +
      "}" +
      "#_tc_btn:hover { opacity: 0.88; }";
    document.head.appendChild(uiStyle);

    // Auto-trigger print after Google Fonts finish loading
    document.fonts.ready.then(() => setTimeout(() => window.print(), 450));
  });
}
