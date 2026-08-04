import { expect, test } from "bun:test"

test("published TUI uses the reactive OpenTUI Solid transform", async () => {
  const output = await Bun.file("dist/tui.js").text()
  expect(output).toContain('from "@opentui/solid"')
  expect(output).toContain("() => rows().slice(")
  expect(output).toContain("return index === selected()")
  expect(output).not.toContain('from "@opentui/solid/jsx-runtime"')
})
