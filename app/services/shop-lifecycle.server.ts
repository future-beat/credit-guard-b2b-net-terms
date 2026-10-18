import db from "../db.server";

/**
 * Shop lifecycle service — the D-06 two-stage uninstall contract (FOUND-03).
 *
 *   app/uninstalled  ->  deactivateShop  : stop serving the shop, RETAIN its data
 *   shop/redact      ->  redactShop      : hard-delete everything (arrives T+48h)
 *   authenticated load -> ensureShopActive: re-install restores the shop intact
 *
 * Two rules hold for every function here:
 *
 * 1. The shop DOMAIN string is the only key. Webhooks fire after uninstall, when
 *    `session` is undefined (research Pitfall 3), so nothing may read session
 *    state.
 * 2. Everything is idempotent. Shopify delivers at-least-once and out of order;
 *    a redelivered uninstall or redact must never corrupt or fail.
 *
 * SCHEDULER CONTRACT (Phase 2+): every scheduled job — credit recompute,
 * reminder emails, metafield publishing — MUST filter `Shop.active = true`.
 * A deactivated shop still has all of its rows on purpose; `active` is the only
 * signal that says "stop doing work for this merchant".
 *
 * This is no longer a comment you have to remember. `forEachActiveShop()` in
 * `app/services/scheduler.server.ts` applies the filter and is the ONLY shop
 * enumerator any sweep may use; a source-guard test in tests/scheduler.test.ts
 * fails the build if a second enumerator appears in the scheduler or
 * reconciliation modules (carry-forward CF-3). A new sweep gets the gate by
 * construction — write it as `forEachActiveShop(async (shop) => ...)` and there
 * is nothing left to forget.
 *
 * REDACTION CONTRACT: every shop-keyed model added to schema.prisma needs a
 * `deleteMany` line in `redactShop` below AND a counter in `countsFor` in
 * tests/shop-lifecycle.test.ts. A model present in one but not the other is a
 * GDPR hole nothing else would catch. `EnforcementEvent` was the model that
 * slipped through (#32, fixed in 1.0.1) — the counter in `countsFor` is what
 * would have caught it, and now does.
 */

/**
 * Mark a shop uninstalled. Deactivation only — never deletion (D-06).
 * Upserts, because an uninstall can arrive for a shop we have no row for.
 */
export async function deactivateShop(domain: string): Promise<void> {
  const uninstalledAt = new Date();

  await db.shop.upsert({
    where: { domain },
    update: { active: false, uninstalledAt },
    create: { domain, active: false, uninstalledAt },
  });
}

/**
 * Hard-delete every row belonging to a shop. Driven exclusively by the
 * `shop/redact` webhook, ~48h after uninstall — never by a self-scheduled timer.
 * Deletes are scoped by domain and tolerate an already-redacted shop.
 */
export async function redactShop(domain: string): Promise<void> {
  await db.$transaction([
    db.session.deleteMany({ where: { shop: domain } }),
    db.complianceRequest.deleteMany({ where: { shop: domain } }),
    // The Phase 2 AR ledger. Children before parents: schedules reference
    // orders, orders reference companies. SweepLease is deliberately absent —
    // it is scheduler leadership, global rather than shop-keyed, and holds no
    // merchant data.
    // The two snapshot trails: the Phase 5 dunning log (which company was
    // chased, for which order, when) and the Phase 4 enforcement log (which
    // company was held, at what exposure). Both are merchant data about a real
    // buyer relationship, so they go with everything else. Both are deleted
    // BEFORE the ledger rows they name by GID, keeping the
    // children-before-parents reading order intact even though neither carries
    // a foreign key of its own.
    db.reminderLog.deleteMany({ where: { shop: domain } }),
    db.enforcementEvent.deleteMany({ where: { shop: domain } }),
    db.ledgerSchedule.deleteMany({ where: { shop: domain } }),
    db.ledgerOrder.deleteMany({ where: { shop: domain } }),
    db.company.deleteMany({ where: { shop: domain } }),
    db.webhookReceipt.deleteMany({ where: { shop: domain } }),
    db.syncCursor.deleteMany({ where: { shop: domain } }),
    // deleteMany (not delete) so a redelivery for an absent shop is a no-op
    // instead of a P2025 throw.
    db.shop.deleteMany({ where: { domain } }),
  ]);
}

/**
 * Called on every authenticated admin load. Creates the shop on first install
 * and, crucially, reactivates it after a re-install inside the grace window —
 * which is what makes the merchant's settings reappear untouched (D-06).
 */
export async function ensureShopActive(domain: string): Promise<void> {
  await db.shop.upsert({
    where: { domain },
    update: { active: true, uninstalledAt: null },
    create: { domain },
  });
}

/**
 * Append a GDPR compliance receipt. Metadata only — the caller must never pass
 * the webhook payload, because storing request bodies would turn this audit
 * trail into retained customer PII (threat T-01-12).
 *
 * Rows accumulate rather than upsert: the 30-day "we actioned it" evidence
 * needs one entry per delivery (threat T-01-13).
 */
export async function logComplianceRequest(
  shop: string,
  topic: string,
): Promise<void> {
  await db.complianceRequest.create({ data: { shop, topic } });
}
