/**
 * The ACCESS-LOG scrubber — keeps session JWTs out of the host's log store.
 *
 * WHY THIS EXISTS (WINDOWS #8). `react-router-serve` hard-wires
 * `app.use(morgan("tiny"))` and exposes no option, flag or environment variable
 * to change it. Every embedded admin document request therefore prints its FULL
 * request URL to stdout — and Shopify appends `id_token`, a LIVE session JWT, to
 * every one of them. Railway retains those lines. That is the same leak class as
 * T-01-07, into a log store instead of an error tracker, and the Sentry scrubber
 * cannot help: morgan writes to the stream directly, never through Sentry.
 *
 * WHY AT THE STREAM. The line cannot be intercepted upstream without replacing
 * `react-router-serve` with a custom server (a much larger surface to own) or
 * adding a logging dependency. Wrapping `process.stdout.write` from the existing
 * `--import` hook costs nothing, needs no dependency, and catches everything the
 * process prints — morgan's line and any error stack that quotes a URL.
 *
 * WHY THIS FILE IS `.mjs` AND NOT `.ts`: identical to `sentry-redact.mjs` —
 * `instrument.server.mjs` is loaded by RAW NODE via `NODE_OPTIONS='--import'`
 * before any bundler or loader exists, and production runs Node 20, which has no
 * TypeScript type-stripping. A `.ts` module here would import fine on a dev
 * machine and crash the production server at boot.
 *
 * WHY REGEX AND NOT `new URL(...)`: an access-log line is NOT a URL. It is a
 * method, a path-with-query, a status and a duration — and a stack trace is even
 * less URL-shaped. Parsing would mean finding the URL inside the line and
 * re-serialising it, which risks mangling text that is otherwise fine. A
 * targeted substitution edits exactly the credential and leaves every other byte
 * alone.
 */

/**
 * ONE list, two consumers (W-2). The Sentry scrubber owns it; adding a name
 * there protects the access log with no second edit, and there is no second copy
 * to drift.
 */
import { CREDENTIAL_QUERY_PARAMS } from "./sentry-redact.mjs";

const MARKER = "[redacted]";

/**
 * `?name=` or `&name=` followed by the value.
 *
 * The name is anchored on the `?`/`&` separator and terminated by `=`, so a
 * parameter that merely CONTAINS a credential word (`id_token_hint`,
 * `token_count`, `x_token`) can never match.
 *
 * The value runs to the first character that cannot be part of one: `&` (next
 * parameter), whitespace (end of the URL inside a log line), a quote (the URL is
 * a value inside a JSON record) or a backslash (a JSON escape). Stopping there
 * is what keeps a structured log line parseable after scrubbing.
 */
const CREDENTIAL_VALUE = new RegExp(
  `([?&](?:${CREDENTIAL_QUERY_PARAMS.join("|")})=)[^&\\s"'\\\\]*`,
  "g",
);

/**
 * Replace the VALUE of every credential-bearing query parameter in one line of
 * log output, leaving every other byte — path, `shop`, `host`, status, timing,
 * stack frames, JSON envelope — exactly as it was.
 *
 * @template T
 * @param {T} line
 * @returns {T | string} the scrubbed line, or the input unchanged when it is not
 *   a string or carries no credential.
 */
export function redactLogLine(line) {
  if (typeof line !== "string") return line;
  return line.replace(CREDENTIAL_VALUE, `$1${MARKER}`);
}

/** Marks a wrapped stream so a second install cannot stack another wrapper. */
const INSTALLED = Symbol.for("creditguard.accessLogRedaction");

/**
 * Wrap a writable's `write` so string chunks are scrubbed on the way out.
 *
 * Non-string chunks (Buffers) are forwarded untouched: Node's console and morgan
 * both write strings, and decoding an arbitrary Buffer here would risk
 * corrupting genuinely binary output for no gain.
 *
 * FAILS SOFT on a stream it cannot wrap. This runs inside the `--import` hook,
 * before the server boots; throwing would take the whole process down at start,
 * which is a far worse outcome than the leak this guards against — and the only
 * way to reach that branch is a caller passing something that is not a stream.
 *
 * @param {{ write?: Function } | null | undefined} stream
 * @returns {void}
 */
export function installAccessLogRedaction(stream) {
  if (!stream || typeof stream.write !== "function") return;
  if (stream[INSTALLED]) return;

  const original = stream.write.bind(stream);

  /**
   * @param {unknown} chunk
   * @param {...unknown} rest encoding and/or completion callback, forwarded
   *   verbatim so the wrapper is invisible to every existing caller.
   */
  stream.write = function write(chunk, ...rest) {
    return original(redactLogLine(chunk), ...rest);
  };

  stream[INSTALLED] = true;
}
