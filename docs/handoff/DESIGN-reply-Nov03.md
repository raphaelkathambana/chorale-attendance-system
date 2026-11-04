# Backend update of 3 Nov: reply from Claude Design

**From:** Claude Design · **Date:** 3 Nov 2026
**Baseline:** `Page.html` from main (`DARK_READY = true`) is now `port/Page.html`; the new `Code.gs` is canonical at the root and in `port/`.
**Files in this drop:** `port/Page.html`, `port/Scripts.html`.

## DARK_READY

`var DARK_READY = true;` (line 13) is unchanged in this drop.

## Optional fix: done

`.bbtn--accent:hover { filter: brightness(0.94); }` (was 1.06). Hover now darkens the fill, so white text on `#1D9E75` stays above its 4.52:1 base.

## 1. Communiqué templates

- **Where:** `Scripts.html` §12e, right after the drafts code; styles at the end of `Page.html`.
- **LOGIC:** pasted verbatim, with one change. The failure handler in `saveCommuniqueTemplateNow()` is:
  ```js
  }).withFailureHandler(function (e) { if (!commTemplateRefused(e)) showToast(serverError(e), "error"); }).saveCommuniqueTemplate(p);
  ```
  Without it, a refused update can only show a toast, and the prompt asks for the Save-as-new panel. Everything else in the block is unchanged.
- **`composerTemplate = null;`** is set in `newCommuniqueMessage()`, `openCommuniqueDraft()`'s success handler, `saveCommuniqueDraftNow()`'s success handler, and the send and schedule success handlers.
- **Templates list:** a sub-tab between Drafts and Scheduled, A–Z. Each row shows the name, subject, preview, owner ("By you" for your own), recipients and attachment count, with **Use**, plus **Edit** and **Delete** when `canEdit`.
- **Save as template:** beside Save draft. It opens a small dialog with the name prefilled from the subject. It warns if a template with that name already exists, and says a scheduled send time isn't kept.
- **Strip:** "TEMPLATE · From '<name>'. Sending or saving a draft leaves the template unchanged." When editing, it reads "Editing template '<name>'" with **Save as new template** and **Update template**. Update is disabled until something changes, and both buttons lock while a save is running.
- **Refused update:** the backend message appears under the strip with **Reopen latest** and **Save as new template**, as drafts do.
- **Super Admin:** sees no communiqué screens, as before.

## 2. Chorale year: Start while the rollover runs

- After Start is pressed, the button stays disabled ("Starting 2026/27…") and a panel shows the spinner with "Starting 2026/27, this takes a few minutes. Keep this page open." The Approve/Reject buttons in the preview are disabled while it runs.
- The "already being started" answer shows as an info notice, not an error, and Start stays disabled.
- The confirm hint now says "It takes a few minutes" instead of "a minute or two".

## Checked

Both features in light and dark, desktop and mobile. Canvas: **Backend update · 3 Nov 2026** in `Chorale Design.html` and `Chorale Design · Dark Mode.html`. Mock toggles: `PREVIEW_TEMPLATE_CONFLICT`, `PREVIEW_ROLLOVER_SLOW`, `PREVIEW_ROLLOVER_RUNNING`.
