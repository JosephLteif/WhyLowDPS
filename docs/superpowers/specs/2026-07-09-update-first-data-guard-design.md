# Update-first startup prompts

## Goal

An available app update takes precedence over missing required game data. The user must address or dismiss the update prompt before the missing-data recovery dialog can appear.

## Approach

`UpdatePrompt` publishes its lifecycle through the existing `whylowdps-updater-status` browser event. `DataGuard` initially waits for the update check to resolve, then suppresses its missing-files modal while the updater status is `available`, `downloading`, or `downloaded`.

The update close action publishes a non-pending status. When the updater reports no update, errors, or the user dismisses the prompt, `DataGuard` resumes its normal missing-file detection and may show the recovery dialog.

## Scope

- Keep the current updater UI and install flow unchanged.
- Keep missing-file detection and repair unchanged.
- Change only the presentation priority between these two existing prompts.

## Testing

Add a focused component test proving that required missing files do not render the data-repair dialog while an update is available, and that the dialog becomes eligible after the update prompt is dismissed.
