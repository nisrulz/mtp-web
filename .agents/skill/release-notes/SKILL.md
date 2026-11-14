---
name: release-notes
license: MIT
description: Write mtp-web release notes and changelog entries by following the structure and voice of changelog/release_0_1_0.md. Use when preparing a release, drafting notes for a new version, updating the changelog, or summarizing changes between two tags.
metadata:
  author: Nishant Srivastava
  version: '1.0.0'
---

# Release Notes

Create one file per release at `changelog/release_<major>_<minor>_<patch>.md`.
Use `changelog/release_0_1_0.md` as the canonical example.

## Gather inputs

1. Read the current version from `package.json`.
2. Find the previous tag:

   ```bash
   git describe --tags --abbrev=0
   ```

3. List the changes since that tag:

   ```bash
   git log <previous-tag>..HEAD --oneline
   git diff --stat <previous-tag>..HEAD
   ```

4. Read the changed guides under `docs/`, the README, and `package.json`.
5. Note the commands that actually ran and their results. Do not claim a device
   result that you did not run.

## Group the changes

Use these sections in this order. Omit a section with no entries.

1. `## Breaking changes` — list the change and the migration action. Put this
   first.
2. `## Library` — public API, protocol behavior, transport and dependencies.
3. `## Browser demo` — demo UI, theme, upload and navigation.
4. `## Tooling and documentation` — tests, CI, Make targets and guides.
5. `## Security` — only for security fixes or hardening that users must know.
6. `## License` — only when the license or NOTICE changes.
7. `## Install` — keep the standard install block.

## Template

````markdown
# mtp-web vX.Y.Z

<One sentence: what this release adds or changes.>

## Breaking changes

- <Change>. Migrate by <action>.

## Library

- <User-visible change.>
- <New API, protocol fix, dependency upgrade or hardening.>

## Browser demo

- <Demo change.>

## Tooling and documentation

- <Tooling, test, CI or docs change.>

## Install

```bash
npm install mtp-web
```
````

## Style

- Use past tense for completed work: "Added", "Fixed", "Upgraded".
- Write one user-visible outcome per bullet.
- Name public APIs and files in backticks: `getDeviceInfo()`, `src/node.js`.
- Include specific versions and limits when they matter: `usb` 3.3.0, 64 KiB.
- Keep the title as `# mtp-web vX.Y.Z`.
- Keep the intro to one sentence.
- Prefer short bullets. Split a long bullet into two.
- Use ASD-STE100 Simplified Technical English: short sentences, active voice,
  present or past tense, no contractions.
- Mention verification only when it ran. Add a `## Verification` section when
  the release notes must state what was tested. State unverified hardware
  behavior separately.

## Workflow

1. Draft the file from the template.
2. Check each bullet against the diff or a test.
3. Remove internal churn that users cannot see.
4. Run the formatter:

   ```bash
   npx prettier --write changelog/release_<version>.md
   ```

5. Use the file body as the GitHub release body for the tag.

## Do not

- Do not copy commit subjects or include commit hashes.
- Do not list every file that changed.
- Do not claim a physical-device test that did not run.
- Do not add a section for a category with no changes.
- Do not change the License section unless the license or NOTICE changed.
