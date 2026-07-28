# opencode-grepguard

An [opencode](https://opencode.ai) plugin that post-filters the output of the
built-in `grep` tool using an `opencode.ignore` file evaluated with full
gitignore semantics (negations included).

Filtering runs **after** the `grep` tool executes. Any output line that does not
match the expected grep format causes the call to be **aborted rather than
passed through** — the guard is fail-closed by design, so a change in grep's
output format can never silently bypass it.

## How it works

1. On plugin load, `opencode.ignore` is read from the project root
   (`worktree || directory || process.cwd()`).
2. If the file is missing or empty, the plugin registers no hooks — it is a
   complete no-op with zero overhead.
3. Otherwise a `tool.execute.after` hook is registered that:
   - Parses `grep`'s output (`Found N matches`, `<file>:`, `  Line N: ...`,
     `(Results truncated...)`) into per-file blocks.
   - Drops blocks whose file path matches `opencode.ignore`.
   - Re-renders the surviving blocks in the original format and updates
     `output.metadata.matches` to the filtered count.
4. If the output does not conform to the expected grammar, the hook overwrites
   the output with an error message and throws, aborting the tool call.

Paths are normalized from Windows backslashes to forward slashes, so the same
ignore file works cross-platform. The project root itself is never blocked.
Results whose path falls outside the project root are filtered out, since the
ignore file cannot vet them.

## Installation

Copy the plugin into your opencode configuration:

```
.opencode/plugins/grep-guard.ts
```

Add the runtime dependency in `.opencode/package.json`:

```json
{
  "dependencies": {
    "ignore": "^5.3.2"
  }
}
```

Then create an `opencode.ignore` file in your project root using gitignore
syntax:

```gitignore
secrets/
*.env
!important.env
```

## Dependencies

- [`ignore`](https://www.npmjs.com/package/ignore) `^5.3.2` — gitignore-style
  pattern matching, including negation rules.
- opencode plugin API: `@opencode-ai/plugin`.

## License

MIT
