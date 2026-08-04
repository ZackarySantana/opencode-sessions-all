import { homedir } from "node:os"
import { join } from "node:path"

export function opencodeStateDirectory(
  env: { XDG_STATE_HOME?: string } = { XDG_STATE_HOME: process.env.XDG_STATE_HOME },
  home = homedir(),
) {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "opencode")
}
