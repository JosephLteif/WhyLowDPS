# Data File State Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users narrow Game Data File States by availability and requirement while retaining text search and clear action hierarchy.

**Architecture:** Keep filtering local to `DataFileStateModal` with two small string state values. Derive visible entries by applying search, status, and requirement predicates together; render existing groups and actions from that derived data.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Do not change file-state APIs or download, refresh, preview, and directory-opening behavior.
- Missing means every file whose `exists` value is false, including optional files that have not been downloaded.
- Use the existing modal and styling patterns; do not add dependencies or abstractions.

---

### Task 1: Cover combined modal filtering behavior

**Files:**

- Modify: `frontend/src/app/settings/components/DataFileStateModal.test.tsx`

**Interfaces:**

- Consumes: `DataFileStateModal` props and its rendered status/requirement filter controls.
- Produces: regression coverage for availability, requirement, and text-search filtering.

- [ ] **Step 1: Write the failing test**

```tsx
import userEvent from '@testing-library/user-event';

it('filters optional missing files by status and requirement', async () => {
  const user = userEvent.setup();
  render(<DataFileStateModal {...propsWithRequiredAvailableAndOptionalMissing} />);

  await user.click(screen.getByRole('button', { name: 'Missing' }));
  await user.click(screen.getByRole('button', { name: 'Optional' }));

  expect(screen.getByText('Temp Enchants')).toBeInTheDocument();
  expect(screen.queryByText('Potions')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/settings/components/DataFileStateModal.test.tsx`

Expected: FAIL because the Missing and Optional filter buttons do not exist.

- [ ] **Step 3: Write the failing combined-search test**

```tsx
it('shows a filtered empty state when search and filters have no overlap', async () => {
  const user = userEvent.setup();
  render(<DataFileStateModal {...propsWithRequiredAvailableAndOptionalMissing} />);

  await user.click(screen.getByRole('button', { name: 'Missing' }));
  await user.type(screen.getByPlaceholderText('Search files...'), 'potions');

  expect(screen.getByText('No files match the active filters or search.')).toBeInTheDocument();
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- src/app/settings/components/DataFileStateModal.test.tsx`

Expected: FAIL because status filtering and the new empty-state copy are absent.

### Task 2: Implement filter controls and responsive action layout

**Files:**

- Modify: `frontend/src/app/settings/components/DataFileStateModal.tsx`
- Test: `frontend/src/app/settings/components/DataFileStateModal.test.tsx`

**Interfaces:**

- Consumes: `DataFileState.exists`, `DataFileState.required`, `searchQuery`, and existing action callbacks.
- Produces: `filteredGroupedDataFiles` that contains only files matching all active filters.

- [ ] **Step 1: Add minimal local filter state and predicates**

```tsx
const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'missing' | 'available'>('all');
const [requirementFilter, setRequirementFilter] = useState<'all' | 'required' | 'optional'>('all');

const matchesFilters = (file: DataFileState) =>
  (availabilityFilter === 'all' ||
    (availabilityFilter === 'missing' ? !file.exists : file.exists)) &&
  (requirementFilter === 'all' ||
    (requirementFilter === 'required' ? file.required : !file.required));
```

Apply `matchesFilters(file)` together with the existing search predicate inside `filteredGroupedDataFiles`.

- [ ] **Step 2: Add toggle controls and move layout into two rows**

```tsx
<div className="mb-3 space-y-2">
  <div className="flex flex-wrap items-center gap-2">{/* primary and secondary actions */}</div>
  <div className="flex flex-wrap items-center gap-2">{/* filters and search */}</div>
</div>
```

Use the existing button styling, with the selected filter distinguished by the gold treatment. Provide buttons named All, Missing, Available, Required, and Optional; use `aria-pressed` to expose selection state.

- [ ] **Step 3: Make section summaries represent visible files**

```tsx
const visibleDownloaded = files.filter((file) => file.exists).length;
const visibleBytes = files.reduce((total, file) => total + (file.exists ? file.size_bytes : 0), 0);
```

Render `visibleDownloaded/files.length` and `visibleBytes` in the section header instead of the full unfiltered summary.

- [ ] **Step 4: Replace the empty-state copy**

```tsx
No files match the active filters or search.
```

- [ ] **Step 5: Run the focused test suite to verify it passes**

Run: `npm test -- src/app/settings/components/DataFileStateModal.test.tsx`

Expected: PASS with the existing required/optional test and both new filtering tests.

- [ ] **Step 6: Run the focused type check and commit**

Run: `npm run typecheck -- --pretty false`

Expected: exit code 0.

```bash
git add frontend/src/app/settings/components/DataFileStateModal.tsx frontend/src/app/settings/components/DataFileStateModal.test.tsx
git commit -m "feat: filter game data file states"
```
