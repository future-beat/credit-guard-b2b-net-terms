/**
 * The block-message contract — shared by the server and the admin UI.
 *
 * WHY THIS IS NOT A `.server` MODULE: the Settings page needs the cap and the
 * message shape in code that ships to the browser (the character counter, the
 * field's `maxLength`, the error copy). React Router strips `loader`/`action`
 * from a route's client bundle but keeps everything else, so importing these
 * from `enforcement.server.ts` fails the client build outright — correctly, and
 * loudly, rather than leaking Prisma and the Admin client into a browser
 * bundle.
 *
 * So the PURE half lives here — no database, no transport, no secrets — and
 * `enforcement.server.ts` re-exports it, which keeps every existing import path
 * (and the plan 04-03 tests that use them) working unchanged.
 */

/**
 * The message cap (P4-L3), in UTF-16 CODE UNITS.
 *
 * `.length`, deliberately — NOT `[...message].length`. The Function's own
 * `usableMessage` guard measures `candidate.length`, and if this side accepted
 * a string the wasm side then rejected, the merchant would save copy the app
 * confirmed while the buyer still saw the default text. Both sides must use the
 * SAME measure, so an emoji that costs two units there costs two here.
 *
 * The cap is a mitigation, not a nicety (T-04-13): this text renders on a
 * stranger's checkout, and an unbounded field is an unbounded payload on a page
 * the merchant does not control.
 */
export const MAX_MESSAGE_LENGTH = 250;

/**
 * Control characters have no place in a checkout error string.
 *
 * Tab and line feed pass — the merchant edits in a textarea and may lay copy
 * out over two lines. Carriage return is accepted defensively even though
 * `validateMessage` normalizes it away first, so a future caller that skips
 * that step cannot be tripped by a transport's CRLF framing. Everything else
 * in C0/C1 — NULs, escape
 * sequences, bidi control smuggling — is REJECTED rather than silently
 * stripped, because quietly rewriting what a merchant typed is its own kind of
 * lie.
 *
 * Written as a scan rather than a regex literal so the source file itself
 * contains no control characters to be mangled by a copy-paste or a linter.
 *
 * HTML is deliberately NOT filtered: `errors[].message` renders as plain text
 * at `$.cart` (there is no markup path), and blocking `<` would reject
 * legitimate copy like "email us <ar@acme.com>". The cap plus this scan is the
 * entire plain-text policy.
 */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Tab (9), LF (10), CR (13) are the permitted whitespace controls.
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 0x20) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

export type MessageRejection = "not-a-string" | "empty" | "too-long" | "control";

export type MessageValidation =
  | { ok: true; value: string }
  | { ok: false; reason: MessageRejection };

/**
 * THE server-side gate. A `maxLength` attribute on the textarea is decoration
 * that a merchant's devtools (or a scripted POST) walks straight past; this
 * function is the only thing between arbitrary input and every blocked buyer's
 * screen.
 *
 * Order matters, and each step earns its place:
 *
 * 1. NORMALIZE LINE ENDINGS. Multipart form encoding rewrites every `\n` the
 *    merchant typed as `\r\n` on the wire — so a two-line message that read
 *    250 characters in the browser's counter arrives here at 255 and would be
 *    rejected for a character the merchant never typed. Collapsing back to
 *    `\n` is the ONE rewrite this function performs, and it exists so the cap
 *    counts the merchant's text rather than the transport's framing. It also
 *    keeps save -> reload -> save stable instead of growing a CR per round.
 * 2. TRIM. Trailing whitespace is not content, so 250 characters plus a stray
 *    newline is accepted at its real length.
 * 3. MEASURE, then scan for controls.
 */
export function validateMessage(candidate: unknown): MessageValidation {
  if (typeof candidate !== "string") return { ok: false, reason: "not-a-string" };

  const value = candidate.replace(/\r\n?/g, "\n").trim();
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (value.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: "too-long" };
  if (hasControlCharacters(value)) return { ok: false, reason: "control" };

  return { ok: true, value };
}

/** The two strings a blocked buyer can be shown (P4-L4). */
export interface ValidationMessages {
  overLimit: string;
  overdue: string;
}
