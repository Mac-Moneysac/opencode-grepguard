/**
 * grep-guard — `opencode.ignore` gilt fuer das grep-Tool.
 *
 * Filtert die Trefferliste nach Ausfuehrung. `opencode.ignore` wird mit
 * voller gitignore-Semantik ausgewertet, Negationen inklusive.
 *
 * Das Ausgabeformat stammt aus packages/opencode/src/tool/grep.ts.
 * Zeilen, die nicht dazu passen, fuehren zum Abbruch statt zum Durchreichen.
 *
 * Installation: npm-Paket "opencode-grepguard" in der plugin-Liste der
 * opencode.json eintragen — opencode installiert es samt Abhaengigkeiten.
 * Lokal alternativ: Ablage unter .opencode/plugins/grep-guard.ts plus
 * { "dependencies": { "ignore": "^7.0.6" } } in .opencode/package.json.
 */

import type { Plugin } from "@opencode-ai/plugin"
import ignore from "ignore"
import fs from "node:fs"
import path from "node:path"

const IGNORE_FILE = "opencode.ignore"

const HEADER = /^(\S.*):$/
const MATCH_LINE = /^ {2}Line \d+: /
const STATUS = [/^Found \d+ matches( \(more matches available\))?$/, /^No files found$/]
const TRUNCATED = /^\(Results truncated\./

export const GrepGuard: Plugin = async ({ directory, worktree }) => {
  const root = worktree || directory || process.cwd()

  let raw = ""
  try {
    raw = fs.readFileSync(path.join(root, IGNORE_FILE), "utf8")
  } catch {
    /* keine Datei = keine Einschraenkung */
  }
  if (raw.startsWith("\uFEFF")) raw = raw.slice(1)
  if (!raw.trim()) return {}

  const matcher = ignore().add(raw)

  const relativePath = (absolute: string): string =>
      path.relative(root, absolute).split("\\").join("/")

  const isBlocked = (absolute: string): boolean => {
    const relative = relativePath(absolute)
    if (!relative || relative === ".") return false
    if (relative.startsWith("..") || path.isAbsolute(relative)) return true
    return matcher.ignores(relative)
  }

  return {
    "tool.execute.after": async (input: any, output: any) => {
      if (input.tool !== "grep") return
      if (typeof output?.output !== "string") return refuse(output)
      if (!output.output) return

      const blocks: { header: string; lines: string[] }[] = []
      let truncated = ""
      let current: { header: string; lines: string[] } | undefined

      for (const line of output.output.split("\n")) {
        if (line === "") continue
        if (STATUS.some((re) => re.test(line))) continue
        if (TRUNCATED.test(line)) {
          truncated = line
          continue
        }
        if (MATCH_LINE.test(line)) {
          if (!current) return refuse(output)
          current.lines.push(line)
          continue
        }
        const header = line.match(HEADER)
        if (header) {
          current = { header: line, lines: [] }
          blocks.push(current)
          continue
        }
        return refuse(output)
      }

      const kept = blocks.filter((block) => !isBlocked(block.header.slice(0, -1)))
      const total = kept.reduce((sum, block) => sum + block.lines.length, 0)

      const rendered =
          total === 0
              ? ["No files found"]
              : [`Found ${total} matches`, ...kept.flatMap((b, i) => (i ? ["", b.header] : [b.header]).concat(b.lines))]
      if (truncated) rendered.push("", truncated)

      output.output = rendered.join("\n")
      if (output.metadata && typeof output.metadata === "object") output.metadata.matches = total
    },
  }
}

function refuse(output: any): never {
  const message = "grep-guard: Ausgabeformat unbekannt, Aufruf abgebrochen"
  if (output && typeof output === "object") output.output = message
  throw new Error(message)
}

export default GrepGuard
