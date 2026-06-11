# Clyde Go

**Clyde Go** is an AI-powered Chrome Extension built to act as a centralized, high-efficiency command center for tracking, analyzing, and applying to tech jobs. It eliminates the need for manual spreadsheets and repetitive data entry by leveraging Google's Gemini 2.5 Flash model and robust DOM-traversing automation.

## 🌟 Core Features

### 1. Automated Job Sourcing & Analysis Pipeline
- **Context Menu Clipping**: Highlight any job description on any webpage, right-click, and select "Save to Clyde Go" to instantly extract the job details.
- **AI Metadata Generation**: Automatically extracts Job Title, Company, Location, Archetype, and Compensation.
- **Match Score & Gap Analysis**: Evaluates the job against your Master Resume to generate a precise 5.0 scale Match Score, identifying your Top Strength, Main Gap, and a Mitigation Strategy for interviews.

### 2. Generative Document Engine
- **Tailored CV Generation**: Generates beautifully styled HTML-PDF resumes, rewriting your professional summary and bullet points to mirror the job description's exact vocabulary.
- **Cover Letter Generation**: Drafts punchy, metric-driven cover letters focusing on your strengths without corporate fluff.
- **Interview Prep (STAR+R)**: Generates a custom cheat-sheet of STAR+R (Situation, Task, Action, Result, Reflection) stories mapping your experience to the job's core requirements.
- **Outreach Drafter**: Creates a 300-character, highly personalized connection request message to a hiring manager, copied instantly to your clipboard.

### 3. DOM Automation & Auto-Apply
- **"AI Apply"**: Click to traverse the DOM and auto-fill complex ATS portals (Workday, Greenhouse, Ashby, Lever).
- **Dynamic Q&A**: Intelligently answers open-ended application questions directly in the form using your active resume and the job description context.
- **Dynamic ATS PDF Generation**: Converts your freshly tailored resume text into a raw, ATS-friendly PDF and attaches it to "Resume Upload" fields automatically.

### 4. Tracking & Management
- **The Hub**: Manage clipped jobs, saved jobs, and tracked applications all from the extension popup.
- **Master Resume Pipeline**: Upload your master PDF, parse it into text, and run an AI Audit to get an ATS score and actionable feedback.
- **Settings & Overrides**: Configure demographic defaults and custom Q&A rules to override AI answers for specific application questions.

## 🚀 Installation (Developer Mode)

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** and select the root directory of this project (`jd-extractor`).
5. Pin the **Clyde Go** extension to your Chrome toolbar for easy access.
6. Open the extension options, upload your Master Resume (PDF), and configure your settings.

## 💡 Workflow

1. **Setup**: Upload your master resume and let the AI audit it. Configure your demographics and custom Q&A in the settings page.
2. **Clip**: Find a job description (e.g., on LinkedIn), highlight it, right-click -> "Save to Clyde Go".
3. **Analyze**: Open the extension popup to see your match score and gap analysis.
4. **Generate**: Click `Both` to generate a custom CV and Cover Letter. Click `Prep` to prepare for the interview.
5. **Apply**: Navigate to the application form (Greenhouse, Lever, Workday) and click the green `AI Apply` button in the popup to auto-fill the form and attach your generated resume.
6. **Track**: Toggle the tracking switch to move the job to your Tracker tab and update its status as you progress.

## 🛠 Tech Stack
- **Extension Framework**: Chrome Extension Manifest V3
- **AI/LLM**: Google Gemini API (`generativelanguage.googleapis.com`)
- **DOM Parsing**: Custom DOM traversal scripts for major ATS platforms.
- **PDF Processing**: `pdf.js` for resume parsing and lightweight native JS PDF generation.

## 🔒 Privacy & Permissions
- **ActiveTab & Scripting**: Used to read highlighted text and inject the auto-fill scripts into job application portals.
- **Storage**: Securely stores your Master Resume text, custom settings, and tracked jobs locally on your device.
- **ContextMenus**: Adds the "Save to Clyde Go" right-click functionality.
- **Offscreen**: Used to quietly parse PDF uploads in the background.

---
*Stop tracking spreadsheets. Start choosing your next role.*