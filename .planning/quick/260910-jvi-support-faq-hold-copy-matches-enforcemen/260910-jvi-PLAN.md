---
quick_id: 260910-jvi
type: quick
wave: 1
autonomous: true
requirements: [ENFC-01, LNCH-03]
files_modified:
  - app/routes/support.tsx
  - .gitignore
  - tests/support-route.test.ts
---

# Quick task 260910-jvi — support FAQ hold copy matches enforcement scope; git-ignore marketing/

## Why

WINDOWS #29 (closed 2026-09-05) established that the validation Function holds
**every** checkout of an enforced purchasing company — its input carries no
payment method or terms information, so "terms-only" is not something it can
express. The public support page's first FAQ answer still opens "Credit Guard
holds an order on payment terms only when…", which is narrower than the code.
The App Store listing sentence was corrected by the developer on 2026-09-10; the
support page is the last public surface carrying the narrow wording.

Separately, the marketing thread keeps working files (lead lists, outreach
logs) in `marketing/` inside the repo. They contain store names and must never
be committed.

## Tasks

### Task 1 — support.tsx copy (auto)

**Files:** `app/routes/support.tsx`, `tests/support-route.test.ts`

**Action:** In `app/routes/support.tsx` line ~125 replace the opening clause
`Credit Guard holds an order on payment terms only when all of these are true:`
with `Credit Guard holds a company's new orders only when all of these are true:`.
Leave the rest of the paragraph and every other string untouched. If any
assertion in `tests/support-route.test.ts` pins the old clause, update it to the
new one; add no new assertions beyond that.

**Verify:** `grep -c "holds a company's new orders only when" app/routes/support.tsx`
prints 1; `grep -c "holds an order on payment terms" app/routes/support.tsx tests/support-route.test.ts`
prints 0 for both; `npx vitest run tests/support-route.test.ts tests/landing-route.test.ts tests/privacy-route.test.ts` green.

**Done:** the support page's first FAQ answer states the hold applies to the
company's new orders, not to "an order on payment terms".

### Task 2 — ignore marketing/ (auto)

**Files:** `.gitignore`

**Action:** Append a block to `.gitignore`:

```
# Marketing-thread working files (lead lists, outreach logs) — never committed
marketing/
```

**Verify:** `git status --porcelain | grep -c "marketing/"` prints 0;
`git check-ignore -q marketing/ && echo ignored` prints `ignored`;
`git ls-files marketing | wc -l` prints 0.

**Done:** the folder is invisible to git and nothing under it is tracked.

### Task 3 — gates and single commit (auto)

**Action:** `export PATH="$HOME/.npm-global/bin:$PATH"`; `TEST_DATABASE_URL`
must contain `creditguard_test`. Run `npm test`, `npm run graphql-codegen`,
`npm run typecheck`, `npm run lint`, `npm run build` — all exit 0. Confirm
`git diff --stat -- shopify.app.toml extensions/ prisma/ app/services/` is empty
and both `api_version = "2026-07"` pins are byte-identical. Write
`260910-jvi-SUMMARY.md` (frontmatter `status: complete`) in this directory.
Then ONE commit, message exactly:
`fix(support): hold copy matches enforcement scope; ignore marketing/ working files`
carrying `app/routes/support.tsx`, `.gitignore`, any test edit, and this
directory's PLAN.md + SUMMARY.md. No push, no deploy.

**Verify:** `git status --porcelain` empty; `git log -1 --format=%s` equals the
subject above; `git show --stat HEAD` lists no path under marketing/.
