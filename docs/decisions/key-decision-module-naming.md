# Key decision: Module naming

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Module naming — the Document Review workspace is user-facing "Review" (owner rule, B418, 2026-06-23).**
  The canonical **user-facing** name for this module is **"Review"** — the row-2 tab, the loader caption, the
  empty-state heading, and the error-boundary label all say "Review". The **internal id stays `doc-review`**,
  the folder is `src/workspaces/doc-review/`, the route is `/markup`, and the data-model field is `markups` —
  none of those change (renaming them would orphan routes/storage). The module accent token is
  **`--accent-review`** (JS mirror `accentReview`), amber **#EF9F27** (B419). Historical names **"Markup"**
  and **"Document Review"** mean this same Review module — don't treat them as separate features.
  Distinct from this: the Site Planner's **"Markup line/rect"** drawing tools are their own thing — leave
  their labels alone.
  - **⚠ UPDATE (B496, 2026-06-27): "Library" is now its OWN top-level workspace, NOT the Review module.**
    The file browser (`FileBrowser`, was Review's landing screen) was lifted into a dedicated **Library** tab
    (`src/workspaces/library/`, internal id `library`, route `#/library`, teal accent `--accent-library`
    **#0E7490** / JS `accentLibrary`). Review is now purely "open one drawing + mark it up" — with nothing
    open it shows a "No drawing open" empty state with a **Browse the Library** button. Clicking a file in
    Library opens it in Review via the existing Shell `onOpenReviewInDocReview` intent. The file-storage
    **data layer (`reviewStore`/`autofiling`/`fileIndex`) stays in `doc-review/lib`** (project-scoped,
    canvas-independent) and Library imports it cross-workspace — no new backend/tables/keys. So pre-B496
    text below that calls `FileBrowser` "the Document Review landing surface" now means the **Library**
    tab. **(B542 update:)** the Site Planner's old slide-over `ProjectFilesDrawer` + its row-1
    **🗂 Files** button were **removed as redundant** once the Library tab shipped — `ProjectFilesDrawer.jsx`
    is deleted and the Library tab is the one and only file browser now.
