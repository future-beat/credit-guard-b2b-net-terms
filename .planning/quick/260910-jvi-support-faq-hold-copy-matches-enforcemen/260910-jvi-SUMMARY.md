---
quick_id: 260910-jvi
phase: quick-260910-jvi
plan: 01
type: quick
status: complete
subsystem: ui
tags: [support-page, public-route, enforcement-scope, copy, gitignore, windows-29]

requires:
  - phase: quick-260904-ept
    provides: "app/routes/support.tsx — the public support/FAQ page whose first FAQ answer carried the narrow wording"
  - phase: 06-launch
    provides: "WINDOWS #29 — the measured fact that the validation Function holds every checkout of an enforced purchasing company"
provides:
  - "GET /support first FAQ answer now states the hold applies to the company's new orders, matching the Function's actual scope"
  - ".gitignore excludes marketing/ so lead lists and outreach logs can never be committed"
affects: [public support surface, marketing-thread working files]

actuals:
  tokens: 473
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Public-surface copy is corrected at the source of truth (the code) once the platform fact is measured, not paraphrased differently per surface"

key-files:
  created: []
  modified:
    - app/routes/support.tsx
    - .gitignore

key-decisions:
  - "The replacement clause names the subject the Function actually acts on — the company's new orders — rather than 'an order on payment terms'. The Function's input carries no payment method and no terms information, so it cannot express a terms-only hold; the old clause promised a narrowness the code does not implement (WINDOWS #29)."
  - "Only the opening clause changed. The rest of the paragraph — the three conditions, the 'Companies with no credit limit set are never held' sentence, and the lift-a-hold paragraph — was already accurate and is byte-unchanged, so no other public string moved."
  - "No test assertion changed: tests/support-route.test.ts pins the FAQ heading ('Why did a buyer see a credit hold at checkout?') and the factual-copy guards, none of which quoted the old clause. Per the plan, no new assertion was added."
  - "marketing/ is ignored rather than deleted — the marketing thread keeps working in it locally; git simply stops seeing it. Nothing under it was ever tracked (git ls-files marketing = 0), so the ignore introduces no untracking of history."

patterns-established: []

requirements-completed: [ENFC-01, LNCH-03]

coverage:
  - id: D1
    description: "app/routes/support.tsx contains the new clause exactly once and the old clause nowhere"
    requirement: ENFC-01
    verification:
      - kind: command
        ref: "grep -c \"holds a company's new orders only when\" app/routes/support.tsx → 1"
        status: pass
      - kind: command
        ref: "grep -c 'holds an order on payment terms' app/routes/support.tsx tests/support-route.test.ts → 0, 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The three public-route suites stay green after the copy edit"
    requirement: LNCH-03
    verification:
      - kind: unit
        ref: "npx vitest run tests/support-route.test.ts tests/landing-route.test.ts tests/privacy-route.test.ts → 3 files, 55 tests passed"
        status: pass
    human_judgment: false
  - id: D3
    description: "marketing/ is invisible to git and nothing under it is tracked"
    verification:
      - kind: command
        ref: "git status --porcelain | grep -c 'marketing/' → 0; git check-ignore -q marketing/ → ignored; git ls-files marketing | wc -l → 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "No file under the protected paths moved, and both api_version pins are byte-identical"
    verification:
      - kind: command
        ref: "git diff --stat -- shopify.app.toml extensions/ prisma/ app/services/ → empty; both TOMLs carry api_version = \"2026-07\""
        status: pass
    human_judgment: false
  - id: D5
    description: "Every repo gate passes"
    verification:
      - kind: integration
        ref: "npm test → 30 files, 869 tests passed, exit 0"
        status: pass
      - kind: integration
        ref: "npm run graphql-codegen → exit 0 (schemas loaded, outputs generated — not an offline no-op)"
        status: pass
      - kind: integration
        ref: "npm run typecheck → exit 0"
        status: pass
      - kind: integration
        ref: "npm run lint → exit 0"
        status: pass
      - kind: integration
        ref: "npm run build → exit 0 (the only gate that catches a server module in client code)"
        status: pass
    human_judgment: false
---

# Quick task 260910-jvi — support FAQ hold copy matches enforcement scope; git-ignore marketing/

## What changed

**`app/routes/support.tsx` (line 125).** The first FAQ answer's opening clause
`Credit Guard holds an order on payment terms only when all of these are true:`
became `Credit Guard holds a company's new orders only when all of these are
true:`. One line, one clause; the rest of the paragraph is byte-unchanged.

WINDOWS #29 (opened and closed 2026-09-05) established that the validation
Function holds **every** checkout of an enforced purchasing company. Its input
carries no payment method and no payment-terms information, so "an order on
payment terms" is a distinction the Function cannot draw. The old clause
therefore described a narrower product than the one that ships — the same
overclaim that was corrected on the App Store listing sentence on 2026-09-10.
The support page was the last public surface still carrying it.

**`.gitignore`.** Appended a two-line block ignoring `marketing/`. The marketing
thread keeps lead lists, an outreach log and an installs CSV there; they contain
store names and must never enter the repo's history.

## What did not change

- No test edit was needed. `tests/support-route.test.ts` pins the FAQ heading and
  the factual-copy guards, never the old clause — so the suite passed unmodified
  and, per the plan, nothing was added to it.
- No file under `shopify.app.toml`, `extensions/`, `prisma/`, `app/services/`,
  or `listing/` moved. Both `api_version = "2026-07"` pins are byte-identical.
- Nothing under `marketing/` is in the commit.

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` (3 public-route suites) | 3 files, 55 tests passed |
| `npm test` | exit 0 — 30 files, **869 tests passed**, 15.36s |
| `npm run graphql-codegen` | exit 0 — schemas loaded, `admin.types.d.ts` + `admin.generated.d.ts` generated |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 — SSR bundle built, 42 modules |

Neither known flaky test (WINDOWS #25 `tests/reminders.test.ts`, WINDOWS #26
`tests/review-prompt.test.ts`) failed; the full suite was green on the first run,
so no isolation re-run was required.

`TEST_DATABASE_URL` was set explicitly to
`postgresql://$USER@localhost:5432/creditguard_test` — `creditguard_dev` was
never touched.

## Deviations from Plan

None — the plan executed exactly as written. Task 1's conditional test edit did
not trigger because no assertion pinned the old clause.

## Follow-ups

None. `.planning/quick/260904-ept-.../260904-ept-PLAN.md` still quotes the old
clause, but that is a historical planning artifact recording what was built that
day and is correctly left alone.
