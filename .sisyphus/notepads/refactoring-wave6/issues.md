2026-03-07: Existing `useUploadJobPolling` implementation diverged from the inlined polling behavior (retry criteria, intervals, progress updates), so it needed alignment before safe composition.
2026-03-07: `useDiffPreview` did not expose a setter for externally supplied diff results from completed upload jobs; adding `setDiffSummary` was required to keep `useUploadExcelFlow` output parity.
