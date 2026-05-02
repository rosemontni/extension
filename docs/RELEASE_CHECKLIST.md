# Release Checklist

Use this checklist for every public release of this repository.

- Confirm the repository About metadata is complete: description, website/homepage, and topics.
- Confirm the project declares Apache-2.0 in `LICENSE`, `NOTICE`, `package.json`, and README badges/sections.
- Refresh README visuals when the user-facing workflow changes: promotional banner, screenshots, and install instructions.
- Run local validation before commit: `npm test`, manifest JSON parse, JavaScript syntax checks, and whitespace checks.
- Keep CI/CD applicable to the repo shape: CI on `main` and PRs, release packaging on version tags.
- Build a release ZIP that contains only extension/runtime files plus useful docs, not local secrets or generated keys.
- Push the commit, push a semver tag, create the GitHub release, upload the ZIP asset, and verify the release page.
- Update GitHub release notes with user-facing behavior, limitations, validation, and install steps.
