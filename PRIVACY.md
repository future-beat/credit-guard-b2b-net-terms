# Privacy Policy — Credit Guard: B2B Net Terms

**Last updated:** 20 August 2026
**Application:** Credit Guard: B2B Net Terms ("Credit Guard", "the app")
**Provider:** Hesam Labs ("we", "us")
**Contact:** support@creditguardhq.com

Credit Guard is a Shopify app that helps merchants control credit risk on B2B
net-terms sales. It tracks how much each of a merchant's business customers
(a "company") currently owes, flags overdue balances, can block new net-terms
checkouts for companies that are over their credit limit or overdue, and can ask
Shopify to send payment reminders for unpaid invoices.

This policy explains what data the app accesses, what it stores, why, for how
long, and who else is involved. It applies to merchants who install Credit
Guard and to the data the app processes on their behalf.

---

## 1. Our role

For data obtained from a merchant's Shopify store, the **merchant is the data
controller** and **Credit Guard is a data processor**. We process that data only
to provide the app's functionality to that merchant, on their instructions, and
for no other purpose.

---

## 2. What Credit Guard accesses

Credit Guard requests seven Shopify API scopes — four read scopes and three
write scopes. Each write scope exists for one specific job, described below;
none of them is used to create, edit or delete a merchant's orders, products or
customers.

| Scope | Read/Write | Why it is needed |
|---|---|---|
| `read_orders` | Read | Read order totals, outstanding balances and financial status to calculate what each company owes |
| `read_all_orders` | Read | Removes Shopify's default 60-day order window so that older unpaid net-terms orders are not silently excluded from a company's balance |
| `read_payment_terms` | Read | Read payment terms and payment schedules to determine due dates and identify overdue balances |
| `read_companies` | Read | Identify which company an order belongs to, so balances are attributed correctly |
| `write_companies` | Write | Publish the app's own credit-state record (a metafield it owns) onto the company, so Shopify's checkout can read the current credit decision. It writes only that app-owned field — never a company's name, addresses, contacts or other details |
| `write_validations` | Write | Create and maintain the app's own checkout rule, which is what allows an over-limit or overdue net-terms checkout to be stopped. It affects only the rule the app created |
| `write_orders` | Write | Ask Shopify to send **its own** payment-reminder email for an unpaid invoice (see below). The app does not create, edit, cancel or refund orders |

We deliberately do **not** request `read_customers`. Credit Guard works at the
company level and does not need customer contact details, so it does not ask
for them.

### Payment reminders — Shopify sends them, not us

When the app decides that an invoice should be chased, it does **not** compose
or send an email. It calls a single Shopify API instruction that identifies
**which invoice** to remind about. Shopify then:

- decides who the recipient is (the company's main contact on the merchant's
  store);
- renders the merchant's own "Payment reminder" notification template,
  including the merchant's branding and Shopify's pay-now link;
- sends the email from the merchant's own authenticated sending identity, so
  replies go to the merchant.

Consequently **Credit Guard never receives, stores or transmits a customer's
email address, name or any other contact detail** in order to send reminders.
The only value the app supplies is Shopify's identifier for the unpaid payment
schedule. Merchants control the wording of the email in their Shopify admin
(Settings → Notifications), and control whether reminders are sent at all — the
feature is off until the merchant turns it on.

---

## 3. What Credit Guard stores

Credit Guard keeps a minimal cache of financial information needed to calculate
credit exposure. Specifically:

**Company records** — the Shopify company identifier, the company name, the
current outstanding balance, whether the company is overdue, and the earliest
upcoming due date.

**Order records** — the Shopify order identifier and order name, the associated
company identifier, whether the order uses payment terms, its financial status,
its outstanding balance and currency, and timestamps used to keep the data in
sync.

**Payment schedule records** — the schedule identifier, due date, completion
date, and balance due.

**Reminder records** — for each payment reminder the app asks Shopify to send:
the payment schedule, order and company identifiers, which reminder moment it
was (approaching due date, due date, or overdue), its status, the number of
attempts, and timestamps. These records exist so that a customer is never
reminded twice for the same moment, and so the merchant can see what was sent.
They contain **no personal data** and no email content — the app does not have
the recipient's address and never sees the message Shopify sends.

**Store and operational records** — the store's `myshopify.com` domain, install
and uninstall timestamps, identifiers of webhooks already processed (used to
avoid double-processing), synchronisation cursors, and records that Shopify's
privacy webhooks were received.

**Authentication records** — the access token Shopify issues for the store, plus
any staff account details Shopify includes with that token (such as a name and
email address for the staff member who installed the app). These belong to the
Shopify session and are used solely to authenticate the app's API calls.

### What Credit Guard does not store

Credit Guard does **not** store any personal data about a merchant's customers
or their business contacts: no customer names, email addresses, phone numbers,
shipping or billing addresses, or payment card details. Card and payment
processing are handled entirely by Shopify; the app never sees payment
instruments. This remains true of the reminder feature: because Shopify
resolves the recipient and sends the message, no customer email address ever
reaches the app.

---

## 4. Why we process this data

Solely to provide the app's stated functionality:

- calculate each company's outstanding balance and identify overdue balances;
- allow the merchant to set a credit limit per company;
- block or allow net-terms checkout according to the merchant's configured
  limits;
- ask Shopify to send payment reminders for unpaid invoices at the moments the
  merchant has enabled, and keep a record so the same reminder is not sent
  twice;
- show the merchant an accounts-receivable summary of their own business data.

We do **not** use this data for advertising, marketing, profiling, resale, model
training, or any purpose unrelated to the app's function.

---

## 5. Automated decisions

Credit Guard can automatically prevent a company from completing a checkout on
net terms when that company is over the credit limit **the merchant set** or has
an overdue balance.

These decisions are made about a **business (a company account)** using that
company's financial data — outstanding balances and due dates. They are not
based on personal data about an individual, and involve no profiling or scoring
of people. The merchant defines the credit limit, and can exempt any company at
any time using a per-company bypass control, so a human always retains override.

---

## 6. Data sharing

We do not sell, rent, or share merchant or customer data with third parties for
their own purposes. Data is disclosed only to the service providers below, each
acting on our instructions:

| Provider | Purpose | Data involved |
|---|---|---|
| **Railway** (application hosting and PostgreSQL database, United States) | Runs the app and stores the records in section 3 | All stored data |
| **Sentry** (error monitoring) | Diagnose application errors | Technical error data only. Request bodies, cookies, and headers are stripped, and authentication tokens and signatures are redacted before events are sent |

We may disclose data where legally required, or to protect our rights or the
safety of others.

---

## 7. Retention and deletion

- **While installed:** data is retained so balances remain accurate.
- **On uninstall:** the app immediately stops processing for the store,
  deactivates it, and stops all scheduled jobs. Data is retained briefly so that
  a merchant who reinstalls does not lose their credit limits and settings.
- **On Shopify's `shop/redact` request** (sent by Shopify approximately 48 hours
  after uninstall): all data for that store is permanently deleted — companies,
  orders, payment schedules, reminder records, sessions and access tokens,
  webhook and privacy request records, and synchronisation state. Nothing for
  that store is retained.

We also respond to Shopify's `customers/data_request` and `customers/redact`
webhooks. Because Credit Guard stores no personal data about a merchant's
customers, there is no customer personal data to return or erase; we record that
the request was received and confirm this.

---

## 8. Security

- All data is transmitted over encrypted connections (TLS/HTTPS).
- Data is encrypted at rest by our hosting provider.
- The application communicates with its database over a private network.
- Every webhook is verified using Shopify's HMAC signature; requests that fail
  verification are rejected without being processed.
- Credentials are held as environment secrets and are never committed to source
  control.
- Error reports are scrubbed of session tokens, request bodies, cookies and
  headers before leaving our systems.

No system can be guaranteed completely secure, but we take these measures to
protect the data we hold.

---

## 9. International transfers

Our infrastructure is hosted in the United States. If you or your customers are
located elsewhere, data may be transferred to and processed there. Where
required, we rely on appropriate safeguards for such transfers.

---

## 10. Your rights

Depending on your location, you may have rights to access, correct, delete, or
restrict the processing of personal data, or to object to it or request its
portability.

If you are a **merchant**, contact us at support@creditguardhq.com. Uninstalling
the app triggers the deletion process described in section 7.

If you are a **customer of a merchant**, that merchant is the data controller;
please contact them directly. We will assist them in responding to your request.

---

## 11. Children

Credit Guard is a business tool and is not directed at children. We do not
knowingly collect data from children.

---

## 12. Changes to this policy

We may update this policy as the app changes. The "Last updated" date above will
change, and material changes will be communicated to merchants.

---

## 13. Contact

Questions or requests: **support@creditguardhq.com**
Hesam Labs
