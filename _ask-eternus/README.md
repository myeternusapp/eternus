# Ask Eternus — Knowledge Base and function

Ask Eternus answers visitors' questions on the Support page. It answers **only** from the
Knowledge Base (KB) in this folder: the function sends every KB section to the model with each
question and rejects answers that cite anything else.

This folder is not published by GitHub Pages: Jekyll skips folders whose names start with `_`.
Treat everything in it as potentially public anyway.

## How the KB reaches production

```
canonical DOCs (Google Drive)
        │  manual: a person reads them and rewrites the relevant sections
        ▼
kb/*.md + manifest.json + eval/questions.jsonl      ← committed, reviewed in a PR
        │  npm run build-kb  (runs checks/check-kb.mjs, fails on any error)
        ▼
functions/generated/kb.json                         ← git-ignored, content-hashed
        │  firebase deploy (predeploy runs build-kb again)
        ▼
askEternus function (loads kb.json once at start-up)
```

There is **no automatic link to Google Drive**, and there should not be one. The KB is a reviewed,
public-safe rewrite of the internal DOCs, not a copy of them. A DOC change reaches Ask Eternus only
when the KB is updated, merged and the function is deployed again.

## Sources of authority

`manifest.json` → `authority.canonical_documents` lists the eight canonical DOCs and the DOC
version (its "updated" date) that the KB reflects. Each section lists the DOC sections it is based
on in `sources` (for example `"02 §10.1"`). Those two fields are how you find out what a DOC change
affects.

## Updating the KB after a DOC changes

1. **Find what changed.** Compare the DOC's current text with the version recorded in
   `canonical_documents`. Note what changed and whether it is current, partial, planned or still
   being prepared for release.
2. **Find the affected sections.** Search `sources` in `manifest.json` for the DOC number (for
   example `"04 §`), and search `kb/` for the topic. Decide whether to edit existing sections or
   add new ones.
3. **Write for the public.** Each section is a Markdown file with front matter that must match its
   manifest entry. Rules:
   - State only what the DOC establishes. Never present a feature that isn't released as available.
     If something is being prepared or is planned, say so plainly, and give no date unless the DOC
     gives one for that feature.
   - No internal details: branches, commits, PRs, test results, database, storage or function
     names, rules, keys, infrastructure, personal data or tester names.
   - Use the canonical product names (Moment, Circle, Legacy, Digital Tree, Talk, Messenger…).
   - Cross-reference other sections with `(see *Exact section title*)`.
4. **Update `manifest.json`.** Bump `kb_version` (minor for new or changed content) and
   `last_reviewed`, update the DOC dates in `canonical_documents`, and add any new section with its
   `sources`, `related`, `applies_to` and `status`. Record any non-obvious editorial decision in
   `decisions` and anything to re-check before release in `pre_beta_review`. The `sha256` and
   `words` values must match the files: recompute them after the text is final.
5. **Update the evaluation set.** Add questions to `eval/questions.jsonl` for the new content:
   what it is, how to use it, its limits, what it must not claim, at least one non-English question
   and an `account_specific` case. Update `eval.count` in the manifest.
6. **Update `checks/forbidden-terms.txt`** if the DOC introduces internal names that must never
   appear, or if a term now has to be allowed in one specific section (`| allowed_in: section.id`).
7. **Validate locally** (from `functions/`):
   ```
   npm ci
   npm run check-kb
   npm test          # builds kb.json, then runs the unit tests
   ```
   The unit tests pin the KB version, the number of sections and questions, and the size of the
   system instruction; update them on purpose when the KB grows.
8. **Open a PR** with the KB changes only. The reviewer checks the text against the DOCs.
9. **After approval:** run the staging evaluation (`eval/run-eval.mjs`; it calls the model and has
   a cost, so it needs explicit approval), check the results, then merge and deploy the function.
   Deploying the function is the only step that changes what Ask Eternus answers.

## Features that aren't released yet

When a DOC describes a feature that is still being prepared (for example Messenger in KB 1.3.0),
every section about it opens with a sentence saying it may not be available yet. Remove or change
that sentence only after the release is approved and production behaviour is verified, and list it
in `pre_beta_review` so it is checked.

## Other files

- `eval/run-eval.mjs`, `eval/staging-gates.mjs`: staging checks; they need credentials from the
  environment and call the deployed function.
- `firebase.json`, `firestore.rules`: deployment configuration. A KB update doesn't change them.
- The runtime on/off switch and limits live in the Firestore document `config/askEternus`, not in
  this repository.
