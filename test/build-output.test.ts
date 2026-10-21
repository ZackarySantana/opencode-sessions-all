import { expect, test } from "bun:test"
import { resolve } from "node:path"

test("published TUI uses the reactive OpenTUI Solid transform", async () => {
  const output = await Bun.file("dist/tui.js").text()
  expect(output).toContain('from "@opentui/solid"')
  expect(output).toContain("() => rows().slice(")
  expect(output).toContain("return index === selected()")
  expect(output).not.toContain('from "@opentui/solid/jsx-runtime"')
})

test("published package exposes V2 server and TUI definitions", async () => {
  const pkg = await Bun.file("package.json").json()
  const server = (await import(resolve(pkg.exports["."].import))).default
  const tui = (await import(resolve(pkg.exports["./tui"].import))).default
  expect(server.id).toBe("opencode-sessions-all")
  expect(tui.id).toBe("opencode-sessions-all")
  expect(typeof server.setup).toBe("function")
  expect(typeof tui.setup).toBe("function")
  expect(server.server).toBeUndefined()
  expect(tui.tui).toBeUndefined()
})
