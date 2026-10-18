---
phase: 1
slug: foundation-compliance
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-17
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (template-compatible; installed in Wave 0) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Populated 2026-08-17 (planner revision pass) from plans 01-01..01-04 — 11 tasks. "File Exists" reflects plan time: the repo is empty until 01-01-T2 scaffolds it, so every verify target is created by the task (or an earlier task in the same phase) that first invokes it.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 1 | FOUND-01 | T-01-SC | Human approves the five [SUS] npm installs before any install runs; no [SLOP] permitted | manual (blocking-human checkpoint) | — (checkpoint task; no `<verify>` block by type) | n/a (no files) | ⬜ pending |
| 01-01-T2 | 01-01 | 1 | FOUND-01 | T-01-01, T-01-03 | .env gitignored, no secrets committed; template lockfile majors respected (no hand-upgrade); zero custom OAuth | build + migration status + config grep | `npm run build && npx prisma migrate status && grep -q 'api_version = "2026-07"' shopify.app.toml && ! grep -q '2025-' shopify.app.toml` | ❌ → scaffold created by this task | ⬜ pending |
| 01-01-T3 | 01-01 | 1 | FOUND-01 | T-01-05 | /healthz has zero app-server-auth imports; no deprecated Polaris React imports anywhere under app/ | build + copy/negative grep | `npm run build && grep -q "Credit Guard is installed" app/routes/app._index.tsx && grep -q "Reload page" app/routes/app.tsx && test -f app/routes/healthz.tsx && ! grep -rqE "from ['\"]@shopify/polaris['\"]" app/ && ! grep -qE "shopify\.server" app/routes/healthz.tsx` | ❌ → routes created by this task | ⬜ pending |
| 01-02-T1 | 01-02 | 2 | FOUND-01 | T-01-07 | Default-PII option never enabled; no request/webhook payload bodies attached to Sentry events (negative gate) | build + wiring/negative grep | `npm run build && grep -q "instrument.server.mjs" package.json && grep -q "NODE_OPTIONS" package.json && ! grep -rqE 'sendDefaultPii[[:space:]]*:[[:space:]]*true' instrument.server.mjs app/entry.client.tsx` | ❌ → Sentry wiring created by this task | ⬜ pending |
| 01-02-T2 | 01-02 | 2 | FOUND-01 | T-01-06, T-01-08 | Secrets live only in Railway service variables + gitignored .env; valid TLS on the custom domain (no `-k`) | deployed smoke (curl) | `test "$(curl -s -o /dev/null -w '%{http_code}' "https://app.$CUSTOM_DOMAIN/healthz")" = "200"` | ❌ → README + Railway service created by this task | ⬜ pending |
| 01-02-T3 | 01-02 | 2 | FOUND-01 | T-01-09 | Temporary debug error route sits behind authenticate.admin and is deleted in-task (file-absence gate) | config grep + file-absence + deployed smoke | `grep -q "application_url = \"https://app." shopify.app.toml && test ! -f app/routes/debug.sentry-check.tsx && test "$(curl -s -o /dev/null -w '%{http_code}' "https://app.$CUSTOM_DOMAIN/healthz")" = "200"` | ❌ → route created and deleted within this task | ⬜ pending |
| 01-03-T1 | 01-03 | 3 | FOUND-02, FOUND-03 | T-01-12, T-01-SC (vitest: accepted, seam-verified OK) | ComplianceRequest stores receipt metadata only — no payload/body column; tests isolated to creditguard_test DB | Wave 0 infra: unit (HMAC helper self-test) + migration status + build | `npm test -- --run && npx prisma migrate status && npm run build` | ❌ → vitest.config.ts + tests/helpers/webhook-hmac.ts created by this task (Wave 0) | ⬜ pending |
| 01-03-T2 | 01-03 | 3 | FOUND-03 | T-01-11 | Uninstall deactivates and RETAINS (D-06); all lifecycle ops idempotent under redelivery; keyed on shop domain, never session state | integration (vitest, TDD red-first) + build | `npx vitest run tests/shop-lifecycle.test.ts && npm run build` | ❌ → tests/shop-lifecycle.test.ts created by this task (red first) | ⬜ pending |
| 01-03-T3 | 01-03 | 3 | FOUND-02 | T-01-10, T-01-14 | Invalid HMAC → 401 with zero side effects (library rejects pre-handler); shop/redact hard-deletes idempotently | integration (vitest, TDD red-first) + config grep + build | `npx vitest run tests/webhooks.compliance.test.ts && grep -q 'compliance_topics' shopify.app.toml && grep -q 'webhooks/compliance' shopify.app.toml && npm run build` | ❌ → tests/webhooks.compliance.test.ts created by this task (red first) | ⬜ pending |
| 01-04-T1 | 01-04 | 4 | FOUND-02 | T-01-15, T-01-16 | Deployed endpoint 401s forged posts; SHOPIFY_API_SECRET read from env only — never in argv, script text, or output (grep-asserted) | deployed smoke (scripts: healthz 200, bad-HMAC 401, signed 200) | `bash scripts/smoke-deployed.sh "app.$CUSTOM_DOMAIN" && test "$(bash scripts/send-signed-webhook.sh "app.$CUSTOM_DOMAIN" customers/data_request "$DEV_STORE_DOMAIN")" = "200"` | ❌ → both scripts created by this task | ⬜ pending |
| 01-04-T2 | 01-04 | 4 | FOUND-01, FOUND-02, FOUND-03 | T-01-17, T-01-18 | Production redact leaves zero rows for the shop (idempotent on repeat); prod DATABASE_URL only ever injected via `railway run`; evidence recorded in SUMMARY | deployed E2E (signed redact + production DB query) | `test "$(bash scripts/send-signed-webhook.sh "app.$CUSTOM_DOMAIN" shop/redact "$DEV_STORE_DOMAIN")" = "200" && railway run bash -c "psql \"\$DATABASE_URL\" -tAc \"SELECT count(*) FROM \\\"Shop\\\" WHERE domain = '$DEV_STORE_DOMAIN'\"" \| grep -qx 0` | ❌ → uses scripts created by 01-04-T1 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test framework install (vitest) — template does not ship one *(delivered by 01-03-T1; checked off at execution — `wave_0_complete` tracks this)*
- [ ] Webhook HMAC test stubs for FOUND-02 (valid HMAC → 200, invalid → 401) *(delivered by 01-03-T1 signed-request helper + 01-03-T3 tests)*
- [ ] Uninstall/reinstall lifecycle test stubs for FOUND-03 *(delivered by 01-03-T2 behavior-list tests)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Install → OAuth → embedded admin loads on dev store | FOUND-01 | Requires live Shopify OAuth + admin iframe | Install on B2B dev store, confirm Polaris shell renders without console errors |
| Deployed app reachable via custom domain with TLS | FOUND-01 | Requires live Railway deploy + DNS | Open app URL over HTTPS; install from deployed URL |
| Partner dashboard automated compliance checks | FOUND-02 | Shopify-side checker post-deploy | Run automated checks from Partner dashboard after first deploy |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 10 of 11 tasks carry an `<automated>` command; the sole exception is 01-01-T1, a `checkpoint:human-verify` gate that has no `<verify>` block by task type
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — maximum gap is 1 (the 01-01-T1 checkpoint); every auto/tracer/tdd task verifies
- [x] Wave 0 covers all MISSING references — no `<automated>MISSING` entries exist in any plan; every test/script file is created by the same task (or an earlier task in the same plan) that first invokes it (01-03-T1 infra + helper, 01-03-T2/T3 red-first tests, 01-04-T1 scripts)
- [x] No watch-mode flags — all vitest invocations use `run` mode (`npm test -- --run`, `npx vitest run`)
- [x] Feedback latency < 60s — quick run estimated ~30s; per-task commands are single suite files or greps
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off (revision pass), 2026-08-17 — execution status columns remain ⬜ pending until tasks run
