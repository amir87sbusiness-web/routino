# Pre-trial activation implementation plan

**Goal:** Send a resolved new account through starter-habit activation before the server-owned seven-day trial starts.

**Architecture:** Add a pure access-state classifier, reuse the existing habit draft/form model through a small preset helper, and keep pending activation selection in vault-local browser storage. The activation route starts the trial only after a valid selection, then uses the existing AppProvider mutation path for entitlement and habit persistence/sync.

## Tasks

1. Add failing access-state and shared preset/category tests; implement the pure helpers and update AppShell routing.
2. Add failing activation-route tests for selection, server failure, success, reuse, and notification denial; implement the standalone `/activation` route and vault-local selection store.
3. Update the Persian frontend/API guides; run targeted tests, typechecks, web/mobile builds, and verify generated routing without hand-editing generated files.
