# Chrome Add-on Plan: LinkedIn Messaging Copilot with Queued Drafts

## 1. Goal

Build a Chrome extension that helps the user:

- choose specific LinkedIn recipients
- define reusable message templates
- queue messages for later
- open the correct LinkedIn page when a message is due
- prefill the message composer with the queued draft
- require manual human review and manual click on **Send**

This plan is intentionally for a **manual-send copilot**, not an auto-sender.

## 2. Product Scope

### In scope for v1
- Add a recipient manually from the current LinkedIn page
- Save recipient records locally
- Create and edit message templates
- Create queued message jobs with a scheduled date and time
- At the scheduled time:
  - open the recipient's LinkedIn conversation or profile
  - insert the queued message into the composer
  - mark the job as ready/drafted
- Show job status in the extension UI
- Prevent duplicate drafting for the same queued job

### Out of scope for v1
- Automatic clicking of Send
- Bulk scraping of LinkedIn contacts
- Fully automated campaigns
- Multi-step automated follow-up sequences
- Cloud sync across browsers
- CRM integrations
- AI-generated personalization
- Analytics dashboard beyond basic job status

## 3. Constraints and Risk Posture

This extension should minimize platform risk by:

- avoiding unattended sending
- avoiding bulk automation
- avoiding mass scraping
- keeping the user in the loop for every actual send

Even with this approach, LinkedIn UI automation remains a maintenance and policy-risk area. The product should be framed and implemented as a **drafting assistant**.

## 4. User Stories

### Recipient management
- As a user, I can save a LinkedIn person while viewing their profile or message thread.
- As a user, I can edit the display name, profile URL, and notes for that person.

### Template management
- As a user, I can create message templates with placeholders.
- As a user, I can preview the rendered message before queueing it.

### Queueing
- As a user, I can schedule a message for a specific person at a chosen date and time.
- As a user, I can see pending, drafted, completed, failed, and cancelled jobs.

### Scheduled drafting
- As a user, when the scheduled time arrives, the extension opens the right LinkedIn page.
- As a user, the extension fills the message box with the queued draft.
- As a user, I review and manually click Send.

## 5. High-Level Architecture

## Components

### A. Chrome Extension UI
Use either:
- popup for quick actions
- side panel for richer workflow management

Recommended:
- popup for quick add / quick status
- side panel for templates, recipients, and queue management

### B. Background Service Worker
Responsibilities:
- maintain alarms
- wake on scheduled jobs
- open relevant tabs
- coordinate job state changes
- recover pending jobs on browser restart

### C. Content Scripts
Injected on relevant LinkedIn pages to:
- detect profile/message context
- read minimal page metadata needed for matching
- locate the composer
- insert drafted text
- report success/failure back to background

### D. Storage Layer
Local-first storage:
- `chrome.storage.local` for simple durable state
- optionally IndexedDB later if the queue becomes richer

### E. Optional Rendering Utilities
Shared TypeScript utilities for:
- template interpolation
- validation
- job state transitions
- LinkedIn DOM selectors

## 6. Recommended Tech Stack

- **Manifest Version**: MV3
- **Language**: TypeScript
- **UI**: React for popup + side panel
- **Build tool**: Vite
- **State**: Zustand or simple React state for UI
- **Persistence**: `chrome.storage.local`
- **Scheduling**: `chrome.alarms`
- **Date handling**: date-fns
- **Validation**: Zod
- **Testing**:
  - Vitest for unit tests
  - Playwright for browser-level smoke tests where possible

## 7. Core Data Model

## Recipient
```ts
type Recipient = {
  id: string;
  fullName: string;
  linkedinProfileUrl: string;
  linkedinMessageUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
```

## Template
```ts
type Template = {
  id: string;
  name: string;
  body: string;
  placeholders: string[]; // e.g. ["firstName", "company"]
  createdAt: string;
  updatedAt: string;
};
```

## Queued Job
```ts
type JobStatus =
  | "pending"
  | "opening"
  | "ready_to_draft"
  | "drafted"
  | "sent_manually"
  | "failed"
  | "cancelled";

type QueuedJob = {
  id: string;
  recipientId: string;
  templateId?: string;
  finalMessageBody: string;
  scheduledFor: string;
  status: JobStatus;
  lastError?: string;
  openedTabId?: number;
  draftedAt?: string;
  sentManuallyAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

## Local Settings
```ts
type Settings = {
  linkedinHostPatterns: string[];
  autoOpenTabOnDue: boolean;
  showDraftReminderBadge: boolean;
  timezone: string;
};
```

## 8. Folder Structure

```text
linkedin-copilot-extension/
  README.md
  package.json
  tsconfig.json
  vite.config.ts
  public/
    manifest.json
    icons/
  src/
    background/
      index.ts
      alarms.ts
      jobs.ts
      tabs.ts
    content/
      profile.ts
      messaging.ts
      selectors.ts
      draft.ts
    popup/
      main.tsx
      App.tsx
    sidepanel/
      main.tsx
      App.tsx
      pages/
        Dashboard.tsx
        Recipients.tsx
        Templates.tsx
        Queue.tsx
    shared/
      types.ts
      storage.ts
      templates.ts
      validation.ts
      dates.ts
      events.ts
    tests/
      unit/
      e2e/
```

## 9. Functional Flows

## Flow A: Save recipient from current page
1. User opens a LinkedIn profile or message thread.
2. Content script extracts:
   - name
   - profile URL
   - messaging URL if available
3. User clicks “Save Recipient” in popup or side panel.
4. Extension stores recipient in local storage.

## Flow B: Create template
1. User opens Templates page.
2. User adds template name and body.
3. User optionally inserts placeholders.
4. Validation runs.
5. Template is stored.

## Flow C: Queue a message
1. User chooses recipient.
2. User chooses a template or writes a custom message.
3. User selects scheduled time.
4. Extension renders final message body.
5. Job is stored as `pending`.
6. Background worker creates or refreshes `chrome.alarms`.

## Flow D: Scheduled draft
1. Alarm fires for a due job.
2. Background worker loads job details.
3. Job status becomes `opening`.
4. Worker opens recipient message URL, or profile URL if no message URL is saved.
5. Content script loads and checks whether the composer is available.
6. Job status becomes `ready_to_draft`.
7. Content script inserts message text into composer.
8. Job status becomes `drafted`.
9. User sees visual cue that the draft is ready and clicks Send manually.

## Flow E: Manual completion
1. User clicks Send.
2. The extension cannot always reliably detect this without more invasive page logic.
3. For v1, provide a “Mark Sent” action in the extension UI.
4. Optional later enhancement: observe DOM mutations to detect send confirmation.

## 10. LinkedIn Page Strategy

Support these page types first:
- message thread pages
- profile pages with accessible message action

Prefer drafting inside existing message threads if the URL is known.

Fallback order:
1. use saved `linkedinMessageUrl`
2. open profile URL and require user to open the message composer if needed
3. then inject draft once composer appears

This reduces brittle automation.

## 11. DOM Strategy

Create a dedicated selector layer:
- one file for message composer selectors
- one file for buttons / layout detection
- one file for robust wait/retry helpers

Guidelines:
- never scatter selectors across the codebase
- use retries with timeouts
- treat all selector failures as recoverable
- log exact failure reason into the job record

Pseudo-approach:
```ts
async function waitForComposer(timeoutMs: number): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector('[contenteditable="true"]');
    if (el instanceof HTMLElement) return el;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
```

## 12. Template System

Support simple placeholders in v1:
- `{{firstName}}`
- `{{fullName}}`

Optional later:
- `{{company}}`
- `{{notes}}`

Rendering rules:
- unknown placeholders render as empty string or trigger a validation warning
- user can preview final rendered message before queueing
- store the final rendered message in the job to avoid later surprises if the template changes

## 13. Scheduling Strategy

Use `chrome.alarms`:
- create one alarm per nearest job or a periodic sweep alarm
- recommended v1: periodic sweep every 1 minute
- on wake, find all due `pending` jobs
- process them one at a time

Reason:
- simpler recovery logic
- easier handling if multiple jobs are due
- less alarm churn

Job lock strategy:
- before processing, set a lightweight in-memory or persisted lock
- prevent the same job from drafting twice if multiple events fire

## 14. Error Handling

Common failure cases:
- LinkedIn tab not loading
- user logged out
- messaging composer not found
- recipient URL invalid
- tab closed before draft completes
- draft inserted twice
- storage write failure

Each failure should:
- set job status to `failed`
- capture a machine-readable error code
- capture a human-readable message
- allow retry from UI

Suggested error codes:
- `ERR_TAB_OPEN`
- `ERR_NOT_LOGGED_IN`
- `ERR_COMPOSER_NOT_FOUND`
- `ERR_DRAFT_INSERT`
- `ERR_DUPLICATE_JOB`
- `ERR_STORAGE`

## 15. Security and Privacy

- Keep all recipient/template/job data local in v1
- Do not send LinkedIn data to a backend by default
- Avoid collecting unnecessary profile details
- Provide a one-click “Delete all local data” action
- Make exported data explicit if export is added later

## 16. UX Notes

### Popup
Best for:
- save current recipient
- quick queue action
- view next due jobs

### Side panel
Best for:
- recipient list
- templates
- queue calendar/list
- retry/cancel/mark sent actions

### Useful UX details
- badge count for due drafted jobs
- status chips: Pending, Drafted, Failed
- confirm dialog before cancelling a job
- preview screen before scheduling

## 17. Testing Plan

## Unit tests
Cover:
- template interpolation
- job state transitions
- schedule due logic
- dedupe logic
- validation

## Integration / smoke tests
Cover:
- saving recipient from a mocked page
- queue creation
- alarm processing path
- draft insertion helper against a simulated DOM

## Manual QA checklist
- user logged into LinkedIn
- message thread drafting
- profile-page fallback
- browser restart recovery
- multiple jobs due at same time
- retry after failure
- timezone correctness

## 18. Delivery Phases

## Phase 0: Project bootstrap
- scaffold MV3 extension
- configure TypeScript + Vite
- add popup
- add service worker
- set up content script injection
- define shared types

Deliverable:
- extension loads in Chrome dev mode

## Phase 1: Recipients + templates
- save recipient from current page
- list/edit/delete recipients
- create/edit/delete templates
- add preview rendering

Deliverable:
- user can save contacts and templates locally

## Phase 2: Queue and scheduling
- create queued jobs
- list queue
- implement alarm sweep
- open due jobs in tabs
- persist job status

Deliverable:
- jobs become due and open the right page

## Phase 3: Composer drafting
- detect composer
- insert draft text
- mark job as drafted
- add retry and failure handling

Deliverable:
- extension can open LinkedIn and prefill drafts

## Phase 4: Polish
- side panel UI cleanup
- badge counts
- export/import local data
- browser restart recovery improvements
- stronger selector resilience

Deliverable:
- usable daily-driver private tool

## 19. Estimated Complexity

### Low complexity
- local CRUD for recipients/templates
- queue storage
- template rendering
- basic popup UI

### Medium complexity
- alarm handling
- tab lifecycle coordination
- job status consistency
- side panel UX

### Highest complexity
- resilient LinkedIn DOM interaction
- detecting correct composer state
- preventing duplicate drafts
- maintenance after LinkedIn UI changes

## 20. Suggested MVP Definition

The MVP should do exactly this:

1. User saves 1 or more recipients manually.
2. User defines a few templates.
3. User schedules a message for one recipient.
4. At the chosen time, the extension opens the LinkedIn conversation.
5. The extension fills the draft.
6. The user reviews it and manually sends it.
7. The job is manually marked complete.

If this works reliably, the product is already useful.

## 21. Nice-to-Have Later

- placeholder variables beyond name
- CSV import of recipient list
- export/import of local extension data
- duplicate-recipient detection
- optional “snooze job” action
- optional AI rewrite helper for draft text
- send confirmation detection via DOM observation
- support for multiple LinkedIn message modes

## 22. Development Notes for Implementation

- Build the selector layer early.
- Do not build bulk workflows first.
- Store the rendered final message in the queued job.
- Make retry explicit and user-visible.
- Treat every LinkedIn interaction as brittle and versioned.
- Add debug logs that can be turned on from settings.

## 23. Acceptance Criteria

A release candidate is ready when:

- recipient can be saved from a LinkedIn page
- templates can be created and previewed
- queued jobs can be scheduled and persisted
- due jobs open the intended tab
- the composer can be found on supported pages
- the queued text is inserted once
- failures are visible and retryable
- no actual send occurs without human action

## 24. Open Questions

- Should the extension support only message-thread URLs in v1?
- Should sent confirmation be manual only in v1?
- Should the queue process one due job at a time, always?
- Should recipient identity be keyed by profile URL only?

## 25. Recommended Next Step

Implement a narrow prototype with:
- one popup
- local recipient save
- one template editor
- one queued job list
- one content script that drafts into an already-open message thread

That is the fastest path to learning whether the LinkedIn DOM interaction is stable enough for further investment.
