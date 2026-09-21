/**
 * grep-guard — `opencode.ignore` gilt fuer das grep-Tool.
 *
 * Filtert die Trefferliste nach Ausfuehrung. `opencode.ignore` wird mit
 * voller gitignore-Semantik ausgewertet, Negationen inklusive.
 *
 * Das Ausgabeformat stammt aus dem V2-Plugin `opencode.tool.grep`:
 * der menschenlesbare Text steht in `result.content`, die strukturierten
 * Treffer in `result.output` ({ entry: { path }, line, offset, text, ... }).
 * Beide werden gefiltert. Zeilen/Treffer, die nicht dazu passen, fuehren zum
 * Abbruch statt zum Durchreichen.
 *
 * Installation: npm-Paket "opencode-grepguard" in der plugins-Liste der
 * opencode.json eintragen — opencode installiert es samt Abhaengigkeiten.
 * Lokal alternativ: Ablage unter .opencode/plugins/grep-guard.ts plus
 * { "dependencies": { "ignore": "^7.0.6", "@opencode/plugin": "^2.0.12" } }
 * in .opencode/package.json.
 */

import { Plugin } from "@opencode/plugin"
import ignore from "ignore"
import fs from "node:fs"
import path from "node:path"

const IGNORE_FILE = "opencode.ignore"

const HEADER = /^(\S.*):$/
const MATCH_LINE = /^ {2}Line \d+: /
const STATUS = [/^Found \d+ matches$/, /^No matches found$/]
const TRUNCATED = /^\(Results are truncated:/

export default Plugin.define({
  id: "grep-guard",
  async setup(ctx) {
    // Repository-Wurzel: kanonischer Projekt-Checkout, sonst die Location.
    const root = ctx.location.project?.canonical || ctx.location.directory || process.cwd()

    let raw = ""
    try {
      raw = fs.readFileSync(path.join(root, IGNORE_FILE), "utf8")
    } catch {
      /* keine Datei = keine Einschraenkung */
    }
    if (raw.startsWith("\uFEFF")) raw = raw.slice(1)
    if (!raw.trim()) return

    const matcher = ignore().add(raw)

    // grep gibt Pfade relativ zur Projektwurzel aus; Negationen inklusive.
    const isBlocked = (printed: string): boolean => {
      const relative = printed.split("\\").join("/")
      if (!relative || relative === ".") return false
      if (relative.startsWith("..") || path.isAbsolute(relative)) return true
      return matcher.ignores(relative)
    }

    const fail = (result: Record<string, unknown>): never => {
      const message = "grep-guard: Ausgabeformat unbekannt, Aufruf abgebrochen"
      result.content = message
      if (result.metadata && typeof result.metadata === "object") {
        ;(result.metadata as Record<string, unknown>).matches = 0
      }
      throw new Error(message)
    }

    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "grep") return
      if (event.status !== "completed") return

      const result = event.result as any
      if (typeof result?.content !== "string") return fail(result)
      if (!result.content) return

      const blocks: { header: string; lines: string[] }[] = []
      let truncated = ""
      let current: { header: string; lines: string[] } | undefined

      for (const line of result.content.split("\n")) {
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

      // Strukturierte Treffer mit derselben Semantik filtern. Unbekannte
      // Eintraege brechen ab, damit nichts unbemerkt durchrutscht.
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

      result.content = rendered.join("\n")
      if (result.metadata && typeof result.metadata === "object") {
        ;(result.metadata as Record<string, unknown>).matches = total
      }
    })
  },
})
