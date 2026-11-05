# Changelog

## [0.10.1] - 2026-11-05

### Fixed

- Lifecycle revision requests retain previously supplied feedback for omitted
  fields. Plan-only recovery no longer restarts Define, and later phases receive
  the retained specification and planning decisions.

## [0.10.0] - 2026-11-05

### Added

- Exhaustive tasks can distinguish unique findings from every occurrence.
  Occurrence searches continue when new locations of known findings are found.

### Changed

- Exhaustive-task preparation selects coverage from the goal and prefers search
  mode for semantic discovery, such as identifying UI components in a design.
- Batch sizes use defaults without a separate question. Read-only discovery does
  not ask about file batches or limit the number of findings.

### Fixed

- Duplicate locations no longer inflate recorded occurrence counts.

Existing ledgers and direct workflow calls retain unique-findings behavior by
default. Use a new ledger with `coverage: "occurrences"` to track every instance.
