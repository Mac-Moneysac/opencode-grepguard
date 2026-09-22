# opencode-grepguard

An [opencode](https://opencode.ai) **V2** plugin that post-filters the output of
the built-in `grep` tool using an `opencode.ignore` file evaluated with full
gitignore semantics (negations included).

Filtering runs **after** the `grep` tool executes. Any output line that does not
match the expected grep format causes the call to be **aborted rather than
passed through** — the guard is fail-closed by design, so a change in grep's
output format can never silently bypass it.

This plugin targets the V2 plugin API (`@opencode/plugin`); it does not run on
OpenCode V1.

## How it works

1. On plugin load, `opencode.ignore` is read from the repository root
   (`ctx.location.project.canonical`, falling back to `ctx.location.directory`).
2. If the file is missing or empty, the plugin registers no hooks — it is a
   complete no-op with zero overhead.
3. Otherwise an `execute.after` tool hook is registered that:
    - Parses the model-visible text (`result.content` — either a plain string
      or an array of `{ type: "text", text }` parts: `Found N matches`,
      `<file>:`, `  Line N: ...`, `(Results are truncated...)`) into per-file
      blocks. Non-text content parts abort the call (fail-closed).
    - Drops blocks whose file path matches `opencode.ignore`.
    - Re-renders the surviving blocks in the original format and updates
      `result.metadata.matches` to the filtered count.
    - Filters the structured matches (`result.output`, `entry.path`) with the
      same rule, so paths cannot leak through structured/Code Mode results.
4. If the output does not conform to the expected grammar, the hook overwrites
   the output with an error message and throws, aborting the tool call. The
   model-visible message stays generic so no paths leak; the full diagnostic
   (message plus the inspected result) is appended to
   `os.tmpdir()/opencode-grepguard.log` instead.

Paths are normalized from Windows backslashes to forward slashes, so the same
ignore file works cross-platform. The project root itself is never blocked.
Results whose path falls outside the project root are filtered out, since the
ignore file cannot vet them.

## Installation

The plugin is [published on npm](https://www.npmjs.com/package/opencode-grepguard).
Add it to the `plugins` array in `opencode.json` (project) or
`~/.config/opencode/opencode.json` (global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-grepguard"]
}
```

opencode installs the package and its dependencies automatically with Bun at
startup (cached in `~/.cache/opencode/node_modules/`) — no manual setup needed.

Then create an `opencode.ignore` file in your project root using gitignore
syntax:

```gitignore
secrets/
*.env
!important.env
```

### Local installation (without npm)

Copy `index.ts` into your plugin directory — `.opencode/plugins/grep-guard.ts`
(project) or `~/.config/opencode/plugins/grep-guard.ts` (global) — and declare
the runtime dependencies in `.opencode/package.json`:

```json
{
  "dependencies": {
    "ignore": "^7.0.6"
  }
}
```

## Dependencies

- [`ignore`](https://www.npmjs.com/package/ignore) `^7.0.6` — gitignore-style
  pattern matching, including negation rules. Declared as a regular npm
  dependency, so it is installed automatically together with the plugin.

## License

MIT
