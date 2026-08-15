# Forge — pending changes

This repo is **not the whole app**. It holds only the files an in-progress change
touches, so the change can be reviewed as a diff before it is applied.

It exists because the assistant working on Forge cannot write to files that
already exist in the project (macOS denies its process access to `~/Documents`),
so patched files are delivered here instead of being edited in place.

- `main` — the eight files exactly as they are in the project today.
- `ops/clients-and-fixes` — the same eight, changed, plus four new files.

Compare the branches to see precisely what changes:
https://github.com/AswathMurugan/giftcard/compare/main...ops/clients-and-fixes

To apply, copy the files from the branch over the same paths in the project.
