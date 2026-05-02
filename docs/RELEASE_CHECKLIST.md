# Release Checklist

Use this checklist for every public release of this repository.

- Confirm the repository About metadata is complete: description reflects the current primary feature (direct Wanderlog write), homepage points to the latest release, and topics are current.
- Confirm the project declares Apache-2.0 in `LICENSE`, `NOTICE`, `package.json`, and README badges/sections.
- Bump the version in `manifest.json` and `package.json` together; verify `npm test` passes (the check script asserts they match).
- Refresh README visuals when the user-facing workflow changes: promotional banner, screenshots, and flow step descriptions.
- Run local validation before commit: `npm test` covers manifest checks, required file checks, permission checks, version alignment, and JavaScript syntax for all extension scripts including `wanderlog-app.js`.
- Keep CI/CD applicable to the repo shape: CI on `main` and PRs, release packaging on version tags.
- Build a release ZIP that contains only extension/runtime files plus useful docs, not local secrets or generated keys. Verify the ZIP loads cleanly via **Load unpacked** before tagging.
- Push the commit, push a semver tag, create the GitHub release, upload the ZIP asset, and verify the release page.
- Update GitHub release notes with user-facing behavior, direct-write API discovery notes, known limitations (internal API dependency), fallback behavior, and install steps.
