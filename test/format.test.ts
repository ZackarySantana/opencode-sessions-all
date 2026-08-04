import { expect, test } from "bun:test"
import { formatCost, formatTokens, relativeTime, shorten } from "../src/format.js"
import { clampSelection, contextPercent, previewWidth, resumeCommand, sessionTokens, showExtendedHints } from "../src/tui.js"

test("formats list values", () => {
  const now = 1_000_000_000
  expect(relativeTime(now - 30_000, now)).toBe("now")
  expect(relativeTime(now - 10 * 60_000, now)).toBe("10m")
  expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2h")
  expect(shorten("a long session title", 10)).toBe("a long ...")
  expect(formatTokens(12_500)).toBe("12.5K")
  expect(formatCost(0.125)).toBe("$0.13")
})

test("summarizes token and context usage", () => {
  const row = { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2 }
  expect(sessionTokens(row as never)).toBe(137)
  expect(contextPercent(25_000, 100_000)).toBe("25%")
  expect(contextPercent(25_000)).toBe("--")
})

test("builds a shell-safe cross-project resume command", () => {
  expect(resumeCommand("/work/my project", "ses_123")).toBe("opencode '/work/my project' --session 'ses_123'")
  expect(resumeCommand("/work/zack's app", "ses_123")).toBe("opencode '/work/zack'\\''s app' --session 'ses_123'")
})

test("keeps the preview stable and compacts hints on narrower terminals", () => {
  expect(previewWidth(100)).toBe(34)
  expect(previewWidth(180)).toBe(61)
  expect(showExtendedHints(109)).toBe(false)
  expect(showExtendedHints(110)).toBe(true)
})

test("clamps keyboard selection", () => {
  expect(clampSelection(-1, 5)).toBe(0)
  expect(clampSelection(9, 5)).toBe(4)
  expect(clampSelection(2, 5)).toBe(2)
  expect(clampSelection(2, 0)).toBe(0)
})
