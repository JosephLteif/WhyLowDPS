# Data File State Filters

## Scope

Improve the existing Game Data File States dialog without changing the data API or file actions.

## Interface

- Add a status filter: All, Missing, Available. Missing includes required files that do not exist and optional files that have not been downloaded.
- Add a requirement filter: All, Required, Optional.
- Apply both filters together with the existing text search.
- Keep Download All Missing as the primary action. Group Refresh List and Open Data Dir as secondary actions beside it; keep search and filters together on the following responsive row.
- Show section summaries based on visible files. If no file matches, show an empty state that reflects the active filters or search.

## Behavior and Validation

- Filtering is client-side and must not change download, refresh, preview, or directory-opening behavior.
- Test the modal filtering behavior for missing optional files, required-only filtering, and combined search/filter empty states before implementation.
