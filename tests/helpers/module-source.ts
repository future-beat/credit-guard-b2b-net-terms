import { readFileSync } from "node:fs";

/**
 * Remove every comment from a TS/TSX/JS source string, returning CODE only.
 *
 * This is a small single-pass tokenizer rather than a regex pair, because the
 * regex approach had a latent defect: it removed block comments BEFORE line
 * comments, so a `/*`-like sequence inside a `//` comment (the glob `/app/*`
 * in app/routes/app.tsx, for instance) opened a phantom block comment that
 * swallowed code until the next `*\/` — 38 lines in that case — and every
 * guard on that file passed against an empty string. Found by the 06-04
 * executor.
 *
 * The tokenizer tracks, and refuses to open or close a comment inside:
 *   - single- and double-quoted string literals (with `\` escapes)
 *   - template literals, including `${ ... }` substitutions (nested to any
 *     depth, each of which may itself contain strings, templates, comments)
 *   - regex literals, detected heuristically from the preceding significant
 *     character (`/` after an operand is division, otherwise a regex)
 *   - line comments (so `/*` inside `// ...` is inert)
 *   - block comments (so `//` inside `/* ... *\/` is inert, and block comments
 *     do not nest)
 *
 * Known limitation: bare JSX text (`<p>see https://x</p>`) is not a string
 * token, so a `//` there is treated as a line comment. URLs in JSX text in
 * this codebase live in attributes or expressions, which ARE handled.
 *
 * Removed comments are replaced by a single space (block) or nothing (line,
 * keeping its newline) so that character offsets stay monotonic and the
 * surrounding tokens do not fuse.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  // Template-literal nesting: each `${` pushes a brace depth counter so we
  // know when a `}` returns us to the template's string part.
  const templateStack: number[] = [];
  let braceDepth = 0;

  // Last significant (non-whitespace, non-comment) character emitted, used
  // to decide whether a `/` starts a regex literal or is a division operator.
  let lastSig = "";

  const regexMayStart = (): boolean => {
    if (lastSig === "") return true;
    if ("(,=:[!&|?{};+-*%<>~^".includes(lastSig)) return true;
    // `return /re/`, `typeof /re/`, `case /re/` etc. — look at the last word.
    const tail = /([A-Za-z_$][\w$]*)\s*$/.exec(out);
    if (tail) {
      return [
        "return", "typeof", "instanceof", "in", "of", "new", "delete",
        "void", "throw", "case", "do", "else", "yield", "await",
      ].includes(tail[1]);
    }
    return false;
  };

  const emit = (ch: string) => {
    out += ch;
    if (!/\s/.test(ch)) lastSig = ch;
  };

  // Copy a quoted string (', ") verbatim, honoring backslash escapes.
  const copyQuoted = (quote: string) => {
    emit(source[i++]);
    while (i < n) {
      const ch = source[i];
      if (ch === "\\" && i + 1 < n) {
        emit(ch);
        emit(source[i + 1]);
        i += 2;
        continue;
      }
      emit(ch);
      i++;
      if (ch === quote || ch === "\n") return;
    }
  };

  // Copy a regex literal verbatim, honoring escapes and character classes.
  const copyRegex = () => {
    emit(source[i++]); // opening /
    let inClass = false;
    while (i < n) {
      const ch = source[i];
      if (ch === "\\" && i + 1 < n) {
        emit(ch);
        emit(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === "\n") return; // malformed; bail without eating the line
      emit(ch);
      i++;
      if (inClass) {
        if (ch === "]") inClass = false;
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "/") {
        // flags
        while (i < n && /[a-z]/i.test(source[i])) emit(source[i++]);
        return;
      }
    }
  };

  // Copy the string part of a template literal until its closing backtick or
  // a `${` substitution (which returns control to the code scanner).
  const copyTemplateString = () => {
    while (i < n) {
      const ch = source[i];
      if (ch === "\\" && i + 1 < n) {
        emit(ch);
        emit(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === "`") {
        emit(ch);
        i++;
        templateStack.pop();
        return;
      }
      if (ch === "$" && source[i + 1] === "{") {
        emit("$");
        emit("{");
        i += 2;
        templateStack[templateStack.length - 1] = braceDepth;
        braceDepth++;
        return;
      }
      emit(ch);
      i++;
    }
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      // Line comment: drop to end of line, keep the newline.
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      // Block comment: drop through the first `*/`; no nesting.
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      copyQuoted(ch);
      continue;
    }
    if (ch === "`") {
      emit(ch);
      i++;
      templateStack.push(-1);
      copyTemplateString();
      continue;
    }
    if (ch === "/" && regexMayStart()) {
      copyRegex();
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      emit(ch);
      i++;
      continue;
    }
    if (ch === "}") {
      const top = templateStack[templateStack.length - 1];
      if (templateStack.length > 0 && top === braceDepth - 1) {
        // Closing a `${ ... }` substitution — back into the template string.
        braceDepth--;
        emit(ch);
        i++;
        copyTemplateString();
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      emit(ch);
      i++;
      continue;
    }
    emit(ch);
    i++;
  }

  return out;
}

/**
 * Read a module's source with comments removed, so a structural guard reacts
 * to CODE only.
 *
 * Shared because the guards that need it live in several suites
 * (tests/scheduler.test.ts's CF-3 enumerator guard,
 * tests/graphql-error-surfacing.test.ts's T-02-27 document guard, the
 * reminders and settings guards) and a second copy is a second definition of
 * "what counts as a comment" — the kind of drift that quietly turns a guard
 * green.
 *
 * Callers MUST pair this with a non-triviality assertion (an anchor string
 * known to exist in the file, or a length floor) so that a stripper defect
 * can never again turn a guard green by handing it an empty string.
 *
 * `relativePath` is relative to the REPOSITORY ROOT (e.g.
 * "app/services/scheduler.server.ts"), not to the calling test file.
 */
export function sourceWithoutComments(relativePath: string): string {
  return stripComments(moduleSource(relativePath));
}

/** The same file, verbatim — for guards that must see comments too. */
export function moduleSource(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}
