# Long-Term Memory (MEMORY.md)

## Tech Stack & Project Summary
- **Project**: Clyde Go Chrome Extension
- **Role**: AI assistant for tailoring applications, extracting JDs, and auto-filling jobs.
- **Key Files**:
  - `content/content.js`: Main orchestration and message listeners.
  - `content/portal-handlers/`: Specialized extraction/autofill logic per ATS/job board.
  - `popup.js` / `background.js`: UI overlays, extension messaging, and Gemini APIs.

## Distilled Lessons & Technical Gotchas

### Scoping DOM Queries in Single Page Applications (SPAs)
- **Problem**: In two-pane list/detail layouts (like LinkedIn jobs), querying selectors globally (e.g. `document.querySelector('.jobs-description__content')`) often returns elements within the first listing card in the sidebar or hidden/cached views rather than the active selection.
- **Solution**: Always look for a details/active pane container (e.g. `.jobs-search-two-pane__details`, `.jobs-search__job-details--container`) and scope selectors within that container (using `container.querySelector(...)`). Provide fallback to global `document` only if the container cannot be resolved.
- **Design Pattern**: Portal handlers must expose specialized, scoped extraction functions (`getJobDescription`, `getJobInfo`). The generic extraction scripts should detect the current portal handler via URL and prioritize calling these specialized functions over generic regex/selector fallbacks.
