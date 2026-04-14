const RESUME = `
Stephen Skalamera
+1 (443) 624-1226 | skalamera@gmail.com | New York, NY, USA | linkedin.com/in/skalamera

PROFESSIONAL SUMMARY
Technical Support & Operations leader with 10+ years in high-growth SaaS, building and managing hybrid Technical Support Engineering teams that support developer- and product-facing platforms. Expert in APIs, integrations, and AI support tooling, with a track record of designing systems and workflows that reduce resolution times, improve CSAT, and scale support for complex customer implementations. Proven incident manager and cross-functional partner to Engineering, Product, and Customer Success, with a strong operational mindset and passion for data-driven, customer-first support.

PROFESSIONAL EXPERIENCE

Sigma | September 2025 – Present | Technical Support Engineering Manager | New York, NY
- Lead the New York–based Technical Support Engineering team, managing hiring, onboarding, coaching, and performance for hybrid TSEs and sustaining a 4.84/5 CSAT across a high-volume enterprise customer base.
- Provide hands-on support on complex technical issues and integrations via live chat, email, Slack, and screen-share, owning escalations for strategic accounts and driving a 23-second average live-chat first response time.
- Own workforce management for the Support org, building headcount and capacity models and developing a Python-based ML forecasting app that accurately predicted ticket/chat volume and enabled proactive staffing amid rapid customer growth.
- Own real-time queue health and staffing strategy, building live operational dashboards and playbooks that stabilize backlog, protect SLAs, and deliver an average time to resolve of ~1.1 hours.
- Act as escalation lead for SEV-0/SEV-1 incidents, coordinating with Engineering, Product, and Customer Success to triage issues quickly and deliver clear, timely updates and post-incident summaries to stakeholders.
- Design and iterate support processes, runbooks, and AI-/data-powered tooling to reduce manual work, increase TSE productivity, and scale consistent best practices across regions.

Benchmark Education Company | March 2022 – September 2025 | Lead, Customer Technical Support & Support Operations | New Rochelle, NY
- Led a hybrid team of 15 support agents plus a 5-person offshore vendor team, consistently exceeding KPIs and SLAs while reporting to the Director of Technology.
- Automated workflows and API integrations (Freshdesk, Zendesk, RingCentral, etc.), reducing resolution time by 38% and improving first response time by 45% and average handling time by 32%, while maintaining CSAT above 98% annually.
- Drove the design and launch of an in-house ticketing application and AI-powered performance review platform, achieving department-wide adoption and meaningful cost savings.
- Built a Power BI Support Operations Hub with Python integrations and real-time call queue monitoring (RingCentral API + Freshdesk) to centralize metrics and support data-driven decisions.
- Led cross-functional customer journey mapping and backlog prioritization, translating support insights into product improvements and better alignment across Product, Engineering, and Customer Success.

BuildingLink | October 2019 – March 2022 | Technical Support & Training | New York, NY
- Hosted on-site and remote training sessions on our platform to property management companies across the country.
- Translated user feedback and insights into actionable bug reports and feature requests for development teams.
- Managed a team in adopting a new support ticketing system (Freshdesk).
- Assisted with the redesign of the company's help site for enhanced user-friendliness, modernity, and robustness.

1010data | April 2016 – August 2019 | Customer Experience/Technical Support Lead | New York, NY
- Monitored, reviewed, and delivered Customer Experience staff's KPIs weekly to upper management, including spot checking support tickets.
- Managed the interviewing, hiring, training, and expansion of the Customer Experience Team as one of the initial team members and a team leader.
- Managed all customer inquiries, and interactions on platform, excelling in conflict resolution to ensure positive customer outcomes.
- Constructed the Knowledge Base from the ground up within Confluence, creating a comprehensive resource for customer support.

Lytx | July 2014 – April 2016 | Senior Technical Support Engineer – Tier 3 | San Diego, CA
- Elevated and managed Tech Support incidents as the main point of escalation for the Tier 3 Tech Support team, ensuring prompt resolution for customers.
- Confirmed and documented technical issues, delivering rapid and effective technical solutions.
- Utilized basic SQL query language to troubleshoot and query large databases.
- Interfaced with infrastructure, databases, QA, and development teams as required to address customer issues.

PROJECTS
Jedana – Support Analytics Platform | Founder & Developer
- A suite of AI-powered tools for support operations, focusing on support analytics, agent/team performance, and customer health.
- Automates ticket quality assurance for better agent coaching. AI analyzes interactions, provides detailed insights, and offers skill assessments with customizable AI-suggested ratings.
- Real-time sentiment analysis and KPIs to track customer satisfaction, with AI-generated recommendations for CX improvement.
- Custom weighted metrics to analyze, normalize, and rank agent performance across channels, providing detailed AI-generated performance reviews.

SKILLS
Technical & Tools: REST APIs, Freshdesk, Zendesk, RingCentral, Intercom, Jira, Sigma, Salesforce, NetSuite, Confluence, Power BI, Tableau, BigQuery, Redshift, Azure, Snowflake, Claude Code, Cursor, Glean, Excel, Python, HTML/CSS, JavaScript, SQL, Agentic AI Implementation, Process Automation Design, Codex
Support & Operations: Technical Support Engineering, Customer Experience Analytics, Customer Journey Mapping, Escalation Management, Incident Management, Performance Management, Process Improvement, Knowledge Management
Leadership: Team Leadership, Hybrid/Remote Team Management, Global Support Operations, Cross-Functional Collaboration, Coaching & Mentoring, Conflict Resolution, Stakeholder Management

CERTIFICATIONS
CS50x – Computer Science for Artificial Intelligence | Harvard University | Sept 2025
Career Essentials in Generative AI | Microsoft | July 2023
Career Essentials in Data Analysis | Microsoft | July 2023
Freshdesk Product Expert | Freshworks | July 2023
Customer Service Professional Certificate | Zendesk | July 2023
Career Essentials in Project Management | Microsoft and LinkedIn | July 2023

EDUCATION
University of Maryland – Baltimore County | Bachelor's, Economics | Sept 2005 – May 2010

AWARDS
Gold Stevie® Award Winner in 2025 American Business Awards®
`.trim();

// ── Context menus ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-selection",
    title: "Save to Text Clipper",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "ai-answer",
    title: "Answer with AI (Gemini)",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "generate-docs",
    title: "Generate Cover Letter and Resume",
    contexts: ["page", "selection"]
  });
});

// ── Context menu click handler ─────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText?.trim();
  const url = info.pageUrl || tab?.url;

  if (info.menuItemId === "save-selection") {
    if (!selectedText) return;
    chrome.storage.local.get({ clips: [] }, (data) => {
      const clips = data.clips;
      clips.push({ text: selectedText, url, savedAt: new Date().toISOString() });
      // Newest clip becomes the active job description by default
      const activeClipIdx = clips.length - 1;
      chrome.storage.local.set({ clips, activeClipIdx }, () => {
        showToast(tab.id, "Saved to Text Clipper ✓", "#1a1a2e");
      });
    });
    return;
  }

  if (info.menuItemId === "ai-answer") {
    if (!selectedText) return;
    handleAiAnswer(selectedText, tab);
  }

  if (info.menuItemId === "generate-docs") {
    handleGenerateDocs(tab);
  }
});

// ── Message handler (popup-initiated generation) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "generate") {
    handlePopupGenerate(msg.type, msg.clipIdx)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

async function handlePopupGenerate(type, clipIdx) {
  const data = await new Promise(r =>
    chrome.storage.local.get({ geminiApiKey: "", clips: [] }, r)
  );
  const apiKey = data.geminiApiKey?.trim();
  if (!apiKey) throw new Error("No Gemini API key. Open Settings.");

  const clip = data.clips[clipIdx];
  if (!clip) throw new Error("Clip not found");

  const docs = [];
  const promises = [];

  if (type === "cv" || type === "both") {
    promises.push(generateCvJson(apiKey, clip.text).then(d => {
      docs.push({ html: buildCvHtml(d), order: 0 });
    }));
  }

  if (type === "cover" || type === "both") {
    promises.push(generateCoverJson(apiKey, clip.text).then(d => {
      docs.push({ html: buildCoverHtml(d), order: 1 });
    }));
  }

  await Promise.all(promises);
  docs.sort((a, b) => a.order - b.order);

  for (let i = 0; i < docs.length; i++) {
    const key = `_tc_${Date.now()}_${i}`;
    await new Promise(r => chrome.storage.local.set({ [key]: docs[i].html }, r));
    await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?key=${encodeURIComponent(key)}`) });
    if (i < docs.length - 1) await new Promise(r => setTimeout(r, 400));
  }

  return { success: true, count: docs.length };
}

// ── AI answer flow ─────────────────────────────────────────────────────────────

async function handleAiAnswer(question, tab) {
  chrome.storage.local.get({ geminiApiKey: "", clips: [], activeClipIdx: null }, async (data) => {
    const apiKey = data.geminiApiKey.trim();

    if (!apiKey) {
      showToast(tab.id, "⚠ No Gemini API key set — open extension options to add it.", "#b45309", 5000);
      return;
    }

    // Resolve active job description clip
    const { clips, activeClipIdx } = data;
    const activeClip = (activeClipIdx != null && clips[activeClipIdx])
      ? clips[activeClipIdx]
      : null;

    const toastId = `ai-toast-${Date.now()}`;
    const contextNote = activeClip ? " (with JD)" : " (no JD selected)";
    showPersistentToast(tab.id, toastId, `Thinking${contextNote}…`, "#4f46e5");

    try {
      const answer = await callGemini(apiKey, question, activeClip?.text ?? null);
      await copyToClipboard(tab.id, answer);
      replacePersistentToast(tab.id, toastId, "✓ Answer copied to clipboard", "#16a34a");
    } catch (err) {
      replacePersistentToast(tab.id, toastId, `✗ Gemini error: ${err.message}`, "#dc2626", 6000);
    }
  });
}

async function callGemini(apiKey, question, jobDescription) {
  const systemInstruction = `You are Stephen Skalamera filling out a job application. Answer in first person using only facts from the supplied resume and job description. Output only the answer text, ready to paste. No preamble, no labels, no quotation marks, no markdown headings.

GROUNDING RULES
- Every concrete claim must come from the supplied resume. Prefer one quantified proof over vague strengths.
- Tie the answer to something specific from the job description when one is provided (tooling, domain, team shape, metric they care about).
- Stephen has options; he is choosing this role for concrete reasons, not asking to be considered.
- Confident, not arrogant. Selective, not superior: intentional about fit and impact from day one.
- Proof over claims: do not say "I'm great at X"; say what was built or done and what it changed, using only supplied facts.

STYLE RULES (strict)
- Never use an em dash. Use commas, colons, semicolons, or split into separate sentences.
- No corporate filler: do not use "I'm passionate about", "I would love the opportunity to", "synergy", or "leverage" as empty glue words.
- Short sentences, active voice. Default 2 to 4 sentences unless the question clearly calls for a longer paragraph; then stay tight and structured.
- Mirror the language of the question and job description.

QUESTION-TYPE PLAYBOOK
- Why this role or interest: map one specific element from the job description to one specific experience from the resume (scope, stack, problem type).
- Why this company: something concrete about the company or product from the job description, not generic praise.
- Relevant project or achievement: one story with outcome; use metrics only if present in the resume.
- Why a good fit or what do you bring: intersection framing, for example "I sit at the intersection of [A] and [B], which matches [how the role is framed in the job description]." Use A and B from real background.
- How did you hear: honest and low drama (careers site, job board); do not fabricate details.
- Leadership and builder questions: when the question allows, show both people and systems leadership alongside building (tools, workflows, automation) from real experience only.`;

  const jdSection = jobDescription
    ? `\n\nHere is the job description for the role being applied to:\n\n${jobDescription}\n`
    : "";

  const userPrompt = `Here is Stephen's resume:\n\n${RESUME}${jdSection}\n---\n\nJob application question:\n${question}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }]
      })
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text.trim();
}

// ── Clipboard (must run in tab context) ───────────────────────────────────────

async function copyToClipboard(tabId, text) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (txt) => navigator.clipboard.writeText(txt),
    args: [text]
  });
}

// ── Toast helpers ──────────────────────────────────────────────────────────────

function showToast(tabId, message, bg, duration = 2500) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, background, ms) => {
      const el = document.createElement("div");
      el.textContent = msg;
      Object.assign(el.style, {
        position: "fixed", bottom: "24px", right: "24px",
        background, color: "#fff", padding: "10px 16px",
        borderRadius: "8px", fontSize: "14px", zIndex: "2147483647",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        transition: "opacity 0.4s ease", fontFamily: "sans-serif"
      });
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; }, ms - 400);
      setTimeout(() => { el.remove(); }, ms);
    },
    args: [message, bg, duration]
  }).catch(() => {});
}

function showPersistentToast(tabId, id, message, bg) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, background, toastId) => {
      const el = document.createElement("div");
      el.id = toastId;
      el.textContent = msg;
      Object.assign(el.style, {
        position: "fixed", bottom: "24px", right: "24px",
        background, color: "#fff", padding: "10px 16px",
        borderRadius: "8px", fontSize: "14px", zIndex: "2147483647",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontFamily: "sans-serif"
      });
      document.body.appendChild(el);
    },
    args: [message, bg, id]
  }).catch(() => {});
}

function replacePersistentToast(tabId, id, message, bg, duration = 3500) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (toastId, msg, background, ms) => {
      const el = document.getElementById(toastId);
      if (el) {
        el.textContent = msg;
        el.style.background = background;
        el.style.transition = "opacity 0.4s ease";
        setTimeout(() => { el.style.opacity = "0"; }, ms - 400);
        setTimeout(() => { el.remove(); }, ms);
      }
    },
    args: [id, message, bg, duration]
  }).catch(() => {});
}

// ── Document generation flow ─────────────────────────────────────────────────

async function handleGenerateDocs(tab) {
  const data = await new Promise(resolve =>
    chrome.storage.local.get({ geminiApiKey: "", clips: [], activeClipIdx: null }, resolve)
  );
  const apiKey = data.geminiApiKey?.trim();

  if (!apiKey) {
    showToast(tab.id, "\u26a0 No Gemini API key \u2014 open extension options", "#b45309", 5000);
    return;
  }

  const { clips, activeClipIdx } = data;
  const activeClip = (activeClipIdx != null && clips[activeClipIdx]) ? clips[activeClipIdx] : null;

  if (!activeClip) {
    showToast(tab.id, "\u26a0 No active JD selected \u2014 save a JD clip first", "#b45309", 5000);
    return;
  }

  const toastId = `gen-toast-${Date.now()}`;
  showPersistentToast(tab.id, toastId, "Generating CV and cover letter\u2026", "#4f46e5");

  try {
    const [cvData, coverData] = await Promise.all([
      generateCvJson(apiKey, activeClip.text),
      generateCoverJson(apiKey, activeClip.text)
    ]);

    const cvHtml = buildCvHtml(cvData);
    const coverHtml = buildCoverHtml(coverData);

    const lastName = cvData.name.split(" ").pop().toLowerCase();
    const company = (coverData.company || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    const date = new Date().toISOString().slice(0, 10);

    const cvKey = `_tc_${Date.now()}_cv`;
    const coverKey = `_tc_${Date.now() + 1}_cover`;
    await new Promise(r => chrome.storage.local.set({ [cvKey]: cvHtml, [coverKey]: coverHtml }, r));
    await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?key=${encodeURIComponent(cvKey)}`) });
    await new Promise(r => setTimeout(r, 400));
    await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?key=${encodeURIComponent(coverKey)}`) });

    replacePersistentToast(tab.id, toastId, "\u2713 2 tabs opened \u2014 save each as PDF", "#16a34a");
  } catch (err) {
    replacePersistentToast(tab.id, toastId, `\u2717 Error: ${err.message}`, "#dc2626", 6000);
  }
}

// ── Gemini JSON calls ────────────────────────────────────────────────────────

async function callGeminiJson(apiKey, systemInstruction, userPrompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");
  return JSON.parse(text);
}

async function generateCvJson(apiKey, jobDescription) {
  const systemInstruction = `You generate ATS-optimized, tailored CVs. Given a resume and job description, return a JSON object with the CV content customized for the specific role.

TAILORING RULES:
- Rewrite the Professional Summary (2-4 sentences) to align with the JD's key requirements and vocabulary.
- Select 6-8 Core Competencies that map directly to JD keywords.
- Reword bullet points to mirror JD language while keeping all facts true to the resume. Never fabricate experience, metrics, or companies.
- Never use bold or strong formatting in bullet text or summary.
- Never use em dashes. Use commas, colons, semicolons, or separate sentences.
- Experience order MUST be: Sigma, Benchmark Education Company, BuildingLink, 1010data, Lytx. Include ALL companies.
- Major roles (Sigma, Benchmark) get 4-5 bullets. Minor roles (BuildingLink, 1010data, Lytx) get 1-2 bullets.
- Include Jedana as a project. Tailor its description to show relevance to the target JD.
- Include all education, certifications, and skills from the resume. Reorder skills categories to prioritize JD-relevant ones first.

Return ONLY valid JSON matching this structure:
{
  "name": "string",
  "email": "string",
  "linkedin_url": "string",
  "linkedin_display": "string",
  "location": "string",
  "summary": "string",
  "competencies": ["string"],
  "experience": [{"company":"string","period":"string","role":"string","location":"string","bullets":["string"]}],
  "projects": [{"title":"string","badge":"string","description":"string"}],
  "education": [{"org":"string","year":"string","desc":"string"}],
  "certifications": [{"title":"string","org":"string","year":"string"}],
  "skills": [{"category":"string","items":"string"}]
}`;

  return callGeminiJson(apiKey, systemInstruction,
    `Resume:\n\n${RESUME}\n\nJob Description:\n\n${jobDescription}`);
}

async function generateCoverJson(apiKey, jobDescription) {
  const systemInstruction = `You generate tailored cover letters. Given a resume and job description, return a JSON object with cover letter content.

WRITING RULES:
- 3-4 paragraphs, each 2-4 sentences.
- Open with something specific and compelling about the company or role from the JD, not generic praise.
- Every claim must be grounded in the resume. Use metrics from the resume when available.
- Confident and selective tone: the candidate is choosing this role for concrete reasons, not asking to be considered.
- Never use em dashes. Use commas, colons, semicolons, or separate sentences.
- No corporate filler: never use "passionate about", "excited to leverage", "synergy", "I would love the opportunity."
- Short sentences, active voice.
- Final paragraph: brief, forward-looking, express interest in a conversation.

Return ONLY valid JSON matching this structure:
{
  "company": "string (company name)",
  "role": "string (job title)",
  "paragraphs": ["string", "string", "string"]
}`;

  return callGeminiJson(apiKey, systemInstruction,
    `Resume:\n\n${RESUME}\n\nJob Description:\n\n${jobDescription}`);
}

// ── HTML template builders ───────────────────────────────────────────────────

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCvHtml(d) {
  const competencies = d.competencies.map(c =>
    `      <span class="competency-tag">${esc(c)}</span>`
  ).join("\n");

  const experience = d.experience.map(job => {
    const bullets = job.bullets.map(b => `        <li>${esc(b)}</li>`).join("\n");
    return `    <div class="job avoid-break">
      <div class="job-header">
        <span class="job-company">${esc(job.company)}</span>
        <span class="job-period">${esc(job.period)}</span>
      </div>
      <div class="job-role">${esc(job.role)} &mdash; ${esc(job.location)}</div>
      <ul>
${bullets}
      </ul>
    </div>`;
  }).join("\n\n");

  const projects = d.projects.map(p =>
    `    <div class="project">
      <div class="project-title">${esc(p.title)} <span class="project-badge">${esc(p.badge)}</span></div>
      <div class="project-desc">${esc(p.description)}</div>
    </div>`
  ).join("\n");

  const education = d.education.map(e =>
    `    <div class="edu-item">
      <div class="edu-header">
        <span class="edu-title"><span class="edu-org">${esc(e.org)}</span></span>
        <span class="edu-year">${esc(e.year)}</span>
      </div>
      <div class="edu-desc">${esc(e.desc)}</div>
    </div>`
  ).join("\n");

  const certifications = d.certifications.map(c =>
    `    <div class="cert-item">
      <span class="cert-title">${esc(c.title)} &nbsp;<span class="cert-org">${esc(c.org)}</span></span>
      <span class="cert-year">${esc(c.year)}</span>
    </div>`
  ).join("\n");

  const skills = d.skills.map(s =>
    `    <div class="skills-block"><span class="skill-category">${esc(s.category)}:</span> ${esc(s.items)}</div>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(d.name)} \u2014 CV</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@100..1000&family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', sans-serif; font-size: 11px; line-height: 1.5; color: #1a1a2e; background: #fff; }
  .page { width: 100%; max-width: 8.5in; margin: 0 auto; }
  .header { margin-bottom: 16px; }
  .header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.02em; margin-bottom: 4px; }
  .header-gradient { height: 2px; background: linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%)); border-radius: 1px; margin-bottom: 8px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 10px; color: #555; }
  .contact-row a { color: #555; text-decoration: none; white-space: nowrap; }
  .contact-row .separator { color: #ccc; }
  .section { margin-bottom: 14px; }
  .section-title { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: hsl(187,74%,32%); border-bottom: 1px solid #e5e5e5; padding-bottom: 3px; margin-bottom: 8px; }
  .summary-text { font-size: 11px; line-height: 1.6; color: #333; }
  a { white-space: nowrap; }
  .competencies-grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .competency-tag { font-family: 'DM Sans', sans-serif; font-size: 10px; font-weight: 500; color: hsl(187,74%,28%); background: hsl(187,40%,95%); padding: 3px 10px; border-radius: 3px; border: 1px solid hsl(187,40%,88%); }
  .job { margin-bottom: 12px; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
  .job-company { font-family: 'Space Grotesk', sans-serif; font-size: 12px; font-weight: 600; color: hsl(270,70%,45%); }
  .job-period { font-size: 10px; color: #777; white-space: nowrap; }
  .job-role { font-size: 11px; font-weight: 500; color: #444; margin-bottom: 4px; }
  .job ul { padding-left: 16px; margin-top: 4px; }
  .job li { font-size: 10.5px; line-height: 1.5; color: #333; margin-bottom: 2px; }
  .project { margin-bottom: 10px; }
  .project-title { font-family: 'Space Grotesk', sans-serif; font-size: 11px; font-weight: 600; color: hsl(270,70%,45%); }
  .project-badge { font-size: 9px; font-weight: 500; color: hsl(187,74%,32%); background: hsl(187,40%,95%); padding: 1px 6px; border-radius: 2px; margin-left: 6px; }
  .project-desc { font-size: 10.5px; color: #444; margin-top: 2px; }
  .edu-item { margin-bottom: 6px; }
  .edu-header { display: flex; justify-content: space-between; align-items: baseline; }
  .edu-title { font-weight: 600; font-size: 11px; color: #333; }
  .edu-org { color: hsl(270,70%,45%); font-weight: 500; }
  .edu-year { font-size: 10px; color: #777; }
  .edu-desc { font-size: 10px; color: #666; }
  .cert-item { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .cert-title { font-size: 10.5px; font-weight: 500; color: #333; }
  .cert-org { color: hsl(270,70%,45%); }
  .cert-year { font-size: 10px; color: #777; }
  .skills-block { margin-bottom: 4px; font-size: 10.5px; color: #444; }
  .skill-category { font-weight: 600; color: #333; }
  @page { size: letter portrait; margin: 0.5in 0.6in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .avoid-break { break-inside: avoid; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>${esc(d.name)}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">
      <span>${esc(d.email)}</span>
      <span class="separator">|</span>
      <a href="${esc(d.linkedin_url)}">${esc(d.linkedin_display)}</a>
      <span class="separator">|</span>
      <span>${esc(d.location)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${esc(d.summary)}</div>
  </div>

  <div class="section">
    <div class="section-title">Core Competencies</div>
    <div class="competencies-grid">
${competencies}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Work Experience</div>
${experience}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Projects</div>
${projects}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Education</div>
${education}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Certifications &amp; Awards</div>
${certifications}
  </div>

  <div class="section avoid-break">
    <div class="section-title">Skills</div>
${skills}
  </div>

</div>
</body>
</html>`;
}

function buildCoverHtml(d) {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const paragraphs = d.paragraphs.map(p => `      <p>${esc(p)}</p>`).join("\n\n");

  // Extract name and contact from RESUME (first two lines)
  const resumeLines = RESUME.split("\n");
  const name = resumeLines[0].trim();
  const contactParts = resumeLines[1].trim().split("|").map(s => s.trim());
  const email = contactParts.find(s => s.includes("@")) || "";
  const linkedin = contactParts.find(s => s.includes("linkedin")) || "";
  const location = contactParts.find(s => s.includes("NY") || s.includes("USA")) || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(name)} \u2014 Cover Letter \u2014 ${esc(d.company)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@100..1000&family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'DM Sans', sans-serif; font-size: 11.5px; line-height: 1.65; color: #1a1a2e; background: #fff; }
  .page { width: 100%; max-width: 8.5in; margin: 0 auto; }
  .header { margin-bottom: 20px; }
  .header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.02em; margin-bottom: 4px; }
  .header-gradient { height: 2px; background: linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%)); border-radius: 1px; margin-bottom: 8px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 10px; color: #555; }
  .contact-row a { color: #555; text-decoration: none; white-space: nowrap; }
  .contact-row .separator { color: #ccc; }
  .letter { margin-top: 28px; }
  .date-line { font-size: 10.5px; color: #777; margin-bottom: 20px; }
  .salutation { font-size: 11.5px; font-weight: 500; color: #1a1a2e; margin-bottom: 16px; }
  .body p { font-size: 11.5px; line-height: 1.7; color: #333; margin-bottom: 14px; }
  .closing { margin-top: 24px; font-size: 11.5px; color: #333; line-height: 1.7; }
  .signature { margin-top: 16px; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; color: #1a1a2e; }
  a { white-space: nowrap; color: hsl(187,74%,28%); }
  @page { size: letter portrait; margin: 0.5in 0.6in; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>${esc(name)}</h1>
    <div class="header-gradient"></div>
    <div class="contact-row">
      <span>${esc(email)}</span>
      <span class="separator">|</span>
      <a href="https://${esc(linkedin)}">${esc(linkedin)}</a>
      <span class="separator">|</span>
      <span>${esc(location)}</span>
    </div>
  </div>

  <div class="letter">
    <div class="date-line">${dateStr}</div>
    <div class="salutation">${esc(d.company)} Hiring Team \u2014 ${esc(d.role)}</div>

    <div class="body">

${paragraphs}

    </div>

    <div class="closing">
      Sincerely,
      <div class="signature">${esc(name)}</div>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── File download via tab context ────────────────────────────────────────────

async function downloadInTab(tabId, filename, content) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (fname, html) => {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    args: [filename, content]
  });
}
