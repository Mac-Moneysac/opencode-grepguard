/**
 * grep-guard — `opencode.ignore` applies to the grep tool.
 *
 * Filters the match list after execution. `opencode.ignore` is evaluated with
 * full gitignore semantics, negations included.
 *
 * The output format comes from the V2 plugin `opencode.tool.grep`:
 * the human-readable text lives in `result.content` (a string or an array of
 * `{ type: "text", text }` content parts), the structured matches in
 * `result.output` ({ entry: { path }, line, offset, text, ... }).
 * Both are filtered. Lines/matches that do not fit cause the call to be
 * aborted rather than passed through.
 *
 * Installation: add the npm package "opencode-grepguard" to the plugins list
 * in opencode.json — opencode installs it along with its dependencies.
 * Local alternative: place it at .opencode/plugins/grep-guard.ts plus
 * { "dependencies": { "ignore": "^7.0.6", "@opencode/plugin": "^2.0.12" } }
 * in .opencode/package.json.
 */

import { Plugin } from "@opencode/plugin"
import ignore from "ignore"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import util from "node:util"

const IGNORE_FILE = "opencode.ignore"

const HEADER = /^(\S.*):$/
const MATCH_LINE = /^ {2}Line \d+: /
const STATUS = [/^Found \d+ matches$/, /^No matches found$/]
const TRUNCATED = /^\(Results are truncated:/

// `Tool.Result` is deeply readonly and narrowly typed, but the hook hands us a
// plain mutable object. This local shape mirrors the parts we touch, while
// keeping `content`/`output` deliberately `unknown` for manual validation.
type ToolResult = {
  content?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
}

// Diagnostics for aborted calls. The model-visible result stays generic so no
// paths leak; the full result is written to a local temp file instead.
const LOG_FILE = path.join(os.tmpdir(), "opencode-grepguard.log")

const logFail = (message: string, result: ToolResult) => {
  try {
    const line =
      `timestamp=${new Date().toISOString()} plugin=grep-guard message=${message} ` +
      `result=${util.inspect(result, { depth: 4 })}\n`
    fs.appendFileSync(LOG_FILE, line, { mode: 0o600 })
  } catch {
    /* logging must never break the tool */
  }
}

export default Plugin.define({
  id: "grep-guard",
  async setup(ctx) {
    // Repository root: canonical project checkout, otherwise the location.
    const root = ctx.location.project?.canonical || ctx.location.directory || process.cwd()

    let raw = ""
    try {
      raw = fs.readFileSync(path.join(root, IGNORE_FILE), "utf8")
    } catch {
      /* no file = no restriction */
    }
    if (raw.startsWith("\uFEFF")) raw = raw.slice(1)
    if (!raw.trim()) return

    const matcher = ignore().add(raw)

    // grep prints paths relative to the project root; negations included.
    const isBlocked = (printed: string): boolean => {
      const relative = printed.split("\\").join("/")
      if (!relative || relative === ".") return false
      if (relative.startsWith("..") || path.isAbsolute(relative)) return true
      return matcher.ignores(relative)
    }

    const fail = (result: ToolResult): never => {
      const message = "grep-guard: unknown output format, call aborted"
      logFail(message, result)
      result.content = [{ type: "text", text: message }]
      if (result.metadata && typeof result.metadata === "object") {
        result.metadata.matches = 0
      }
      throw new Error(message)
    }

    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "grep") return
      if (event.status !== "completed") return

      const result = event.result as ToolResult
      const content = result.content
      if (content === undefined || content === null || content === "") return

      // `content` is `string | ReadonlyArray<TextContent | FileContent>`.
      // Only text parts can be parsed; anything else fails closed.
      let text: string
      if (typeof content === "string") {
        text = content
      } else if (Array.isArray(content)) {
        const parts: string[] = []
        for (const part of content) {
          if (!part || typeof part !== "object" || part.type !== "text" || typeof part.text !== "string") {
            return fail(result)
          }
          parts.push(part.text)
        }
        text = parts.join("\n")
      } else {
        return fail(result)
      }

      const blocks: { header: string; lines: string[] }[] = []
      let truncated = ""
      let current: { header: string; lines: string[] } | undefined
      for (const line of text.split("\n")) {
        if (line === "") continue
        if (STATUS.some((re) => re.test(line))) continue
        if (TRUNCATED.test(line)) {
          truncated = line
          continue
        }
        if (MATCH_LINE.test(line)) {
          if (!current) return fail(result)
          current.lines.push(line)
          continue
        }
        const header = line.match(HEADER)
        if (header) {
          current = { header: line, lines: [] }
          blocks.push(current)
          continue
        }
        return fail(result)
      }

      // Filter structured matches with the same semantics. Unknown
      // entries abort, so nothing slips through unnoticed.
      if (result.output !== undefined) {
        if (!Array.isArray(result.output)) return fail(result)
        const kept: unknown[] = []
        for (const match of result.output) {
          const printed =
            match && typeof match === "object" ? (match as { entry?: { path?: unknown } }).entry?.path : undefined
          if (typeof printed !== "string") return fail(result)
          if (!isBlocked(printed)) kept.push(match)
        }
        result.output = kept
      }

      const kept = blocks.filter((block) => !isBlocked(block.header.slice(0, -1)))
      const total = kept.reduce((sum, block) => sum + block.lines.length, 0)

      const rendered =
        total === 0
          ? ["No matches found"]
          : [`Found ${total} matches`, ...kept.flatMap((b, i) => (i ? ["", b.header] : [b.header]).concat(b.lines))]
      if (truncated) rendered.push("", truncated)

      result.content = [{ type: "text", text: rendered.join("\n") }]

      if (result.metadata && typeof result.metadata === "object") {
        result.metadata.matches = total
      }
    })
  },
})
