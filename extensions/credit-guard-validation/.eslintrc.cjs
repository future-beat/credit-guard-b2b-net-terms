/**
 * Extension-workspace lint overrides, cascading onto the repo-root .eslintrc.cjs.
 *
 * `generated/api.ts` is committed (see this directory's .gitignore) so that a
 * fresh clone typechecks without the Shopify CLI. It is machine-written by
 * `shopify app function typegen`, which maps every custom GraphQL scalar
 * (Decimal, JSON, Handle, Void...) to `any` — that is codegen's output shape,
 * not a style choice anyone here can make differently. Linting a regenerated
 * artifact for hand-written-code rules only produces noise that cannot be fixed
 * without editing a file the next typegen overwrites.
 *
 * Hand-written extension source is NOT exempted: src/ is linted normally.
 */
module.exports = {
  overrides: [
    {
      files: ["generated/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
