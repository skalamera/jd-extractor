# Clyde Go Feature Outline

**Clyde Go** is an AI-powered Chrome Extension built to act as a centralized, high-efficiency command center for tracking, analyzing, and applying to tech jobs. It eliminates the need for manual spreadsheets and repetitive data entry by leveraging Google's Gemini 2.5 Flash model and robust DOM-traversing automation.

---

## 1. Automated Job Sourcing & Analysis Pipeline

### 1.1 Context Menu Clipping
*   **"Save to Clyde Go"**: Users highlight any text on any webpage (typically a job description) and right-click to select "Save to Clyde Go."
*   **Silent Background Extraction**: The extension instantly grabs the highlighted text and the current URL.
*   **AI Metadata Generation**: In the background, it securely passes the JD and the user's uploaded master resume to Gemini to silently calculate and extract:
    *   **Job Title**
    *   **Company Name**
    *   **Location** (including Hybrid/Remote status)
    *   **Archetype** (classifying the role type into support/ops categories)
    *   **Salary/Compensation** (hunting for explicitly listed bands)
    *   **Match Score** (A rigorous 10-dimension evaluation returning a score out of 5.0)
    *   **Gap Analysis** (Top Strength, Main Gap, and Mitigation Strategy)

### 1.2 Popup Workflow (The Hub)
The extension popup is divided into three primary workflow tabs, each with dynamic inline counters:

*   **Clips Tab (`[X]`)**: The inbox for newly clipped JDs. 
    *   **Pinned Active JD**: The active JD (the one used for right-click AI answers) is permanently pinned to the top of this tab for high visibility.
    *   **Routing Tools**: Users can click the "Heart" button to route the clip to the Saved tab, or toggle the "Track" switch to route it to the Tracker tab.
*   **Saved Tab (`[X]`)**: A holding pen for JDs the user is interested in but hasn't applied to yet.
*   **Tracker Tab (`[X]`)**: Replaces external spreadsheet trackers.
    *   **Chronological Grouping**: Cards are automatically sorted and grouped visually by the date they were tracked/applied.
    *   **Date Filter**: A sticky date-picker allows users to filter the pipeline to see exactly what they applied to on a specific day.
    *   **Status Dropdown**: The toggle switch is replaced by a color-coded status dropdown (`Applied` [Blue], `Interviewing` [Yellow], `Rejected` [Red], `Accepted` [Green]).

### 1.3 JD Card Anatomy
Every job card in the popup is highly structured:
*   **Linked Title**: The Job Title is hyperlinked to the original URL.
*   **Meta String**: Displays Company, Location, Archetype, and Compensation.
*   **Match Score Badge**: A color-coded badge (Green for >4.5, Yellow >3.5, Orange >2.5, Red <2.4) displaying the precise AI Match Score.
    *   *Interactive*: Clicking the badge expands a mini-panel revealing the Gap Analysis (Top Strength, Main Gap, Mitigation Strategy).
*   **Text Preview**: A faded, scrollable preview of the raw JD text.
*   **Action Bar**: Contains action buttons for document generation, networking, and auto-applying.

---

## 2. Generative Document Engine

Clyde Go utilizes a dual-engine approach to document generation. It can generate beautiful, HTML-styled PDFs for human recruiters, or lightweight, raw text PDFs optimized for ATS systems.

### 2.1 Tailored CV Generation
*   Clicking **"Resume"** (or **"Both"**) on a clip triggers Gemini.
*   **Implicit First-Person**: The AI rewrites the Professional Summary and tweaks bullets specifically to mirror the JD's exact vocabulary. It strictly writes in implied first-person (no "he/she" pronouns).
*   **Styling**: Generates a beautiful HTML layout using `Space Grotesk` and `DM Sans` fonts, accented with Golden Yellow gradients.
*   **Smart Naming**: The file dynamically derives its name via the `<title>` tag formatting as `[Job Title] - [Company Name] - CV.pdf`.
*   **Auto-Attachment Sync**: *Crucially*, whenever a tailored CV is generated from the popup, the extension simultaneously generates a flat-text version of it and saves it securely to local storage as the new `activeResumeText`. This ensures the auto-fill feature always uses the most recently tailored resume.

### 2.2 Tailored Cover Letter Generation
*   Clicking **"Cover Letter"** (or **"Both"**) triggers Gemini.
*   **Strict Tone Guidelines**: The AI is instructed to avoid corporate fluff ("passionate about", "synergy"). It writes 3-4 punchy paragraphs focusing on metric-driven proof points explicitly connecting the candidate's resume to the JD.
*   **Automated Header Extraction**: The system natively extracts the user's Name, Email, LinkedIn, and Location from the master resume to automatically format the Cover Letter header.

### 2.3 Interview Preparation (STAR+R)
*   Clicking **"Prep"** triggers the Interview Coach module.
*   The AI extracts the 5 most critical requirements from the JD and maps them to quantified proof points in the user's resume.
*   It generates 5 highly-tailored **STAR+R** stories (Situation, Task, Action, Result, *Reflection*). The "Reflection" element is forced to demonstrate seniority by explaining what the candidate learned.
*   Outputs a styled HTML printable prep-sheet.

### 2.4 Outreach Drafter
*   Clicking **"Network"** triggers the networking module.
*   The AI drafts a punchy, 300-character maximum (LinkedIn limit) connection request message to a hiring manager, utilizing an "I'm choosing you" confidence framework.
*   It bypasses HTML generation and silently copies the output directly to the user's clipboard for instant pasting.

---

## 3. DOM Automation & Auto-Apply (`form-filler`)

Clyde Go includes a massive, deeply integrated DOM traversal script capable of interacting with complex Single Page Application (SPA) ATS portals like Workday, Greenhouse, Ashby, and Lever.

### 3.1 "AI Apply" Trigger
*   Clicking the green **"AI Apply"** button on a JD card locks that specific JD into memory as the "Active" JD and fires a message directly into the active browser tab.
*   It bypasses any passive scraping the content script may have done and forces the application to evaluate against the highly accurate, actively clipped JD.

### 3.2 Form Detection & Filling
*   **Profile Injection**: It traverses the DOM, pulling exact mapping values from the user's Options configuration (Name, Address, Links, Demographic dropdowns).
*   **Dynamic Q&A**: For open-ended questions, it checks the user's "Custom Q&A" rules first. If no manual override exists, it packages the question, the JD, and the Active Resume, and queries Gemini.
*   **Tone Alignment**: The AI filling the questions uses the strict "I'm choosing you" tone parameters, ensuring first-person perspective, active voice, and no corporate fluff.

### 3.3 Dynamic ATS PDF Generation
*   When the DOM script encounters a "Resume Upload" field, it checks the extension storage.
*   If the user recently generated a tailored CV, it intercepts the raw `activeResumeText`.
*   It utilizes a native, lightweight JavaScript PDF builder to convert that flat text into an uncompressed `Helvetica` PDF blob on the fly.
*   It packages it as a `File` object and triggers the native browser `DataTransfer` events, successfully attaching the tailored PDF without opening any windows or prompting downloads.

---

## 4. Settings & Data Management (`options.page`)

The sleek Golden Yellow/Charcoal settings dashboard manages the core state of the extension.

### 4.1 Master Resume Pipeline
*   **PDF Upload & Parse**: Users upload their standard Master Resume. An offscreen document silently parses the PDF into raw text using `pdf.js` and securely stores it in local memory.
*   **AI Audit**: Clicking the **"Audit Master Resume"** button sends the raw text to Gemini for a strict ATS evaluation. It returns a score out of 100, lists the top 3 weaknesses (passive verbs, missing metrics), and provides actionable improvement steps inline in the UI.
*   **Active Resume Viewer**: A read-only text box displays the currently active tailored resume (if one was generated), allowing the user to verify what the Auto-Fill script is currently utilizing. A "Replace" button in the popup allows instant uploading of newly styled PDFs to override this.

### 4.2 Application Logic Overrides
*   Users configure demographic answers (Sponsorship, Veteran Status, Gender, Relocation limits) using standard dropdowns.
*   **Custom Q&A**: A dynamic list builder where users can map specific question keywords (e.g. "why this role") to exact manual answers, permanently overriding the AI's generation for those specific inputs.

### 4.3 Data Management
*   **Export**: Compiles all JD clips, statuses, and scores into a cleanly formatted `clyde-export-YYYY-MM-DD.txt` file for local backup.
*   **Clear All**: Nukes the local storage state to reset the pipeline.

---

## 5. Right-Click Context Tools
*   **"Save to Clyde Go"**: Initializes the primary sourcing pipeline (detailed in 1.1).
*   **"Answer with AI"**: Allows users to highlight any custom application question on the fly and right-click to instantly generate an answer. It silently evaluates the question against the Active JD and Active Resume using the strict `career-ops` tone rules, and replaces the highlight with a toast notification once the answer is copied to the clipboard.