---
description: Wire claude-statusline into ~/.claude/settings.json so Claude Code renders it
---

You're going to patch the user's global Claude Code settings to point `statusLine` at this plugin's `statusline.cjs`.

Steps:

1. **Find the absolute path to this plugin's `statusline.cjs`.** This `setup.md` file lives at `<plugin-root>/commands/setup.md`, so the script is at `<plugin-root>/statusline.cjs`. Resolve `<plugin-root>` from the slash command's location — do not hard-code paths. On Windows the path will use backslashes; on macOS/Linux, forward slashes. Either works for Node, but keep what the OS uses natively.

2. **Read `~/.claude/settings.json`.** (`$env:USERPROFILE` on Windows, `$HOME` elsewhere.) If the file doesn't exist, treat it as `{}`. If it exists but already has a `statusLine` entry, **stop and ask the user** whether to overwrite — show them the existing entry first.

3. **Set the `statusLine` field** to:
   ```json
   {
     "type": "command",
     "command": "node \"<absolute-path-to-statusline.cjs>\""
   }
   ```
   Preserve every other key in the file. Use 2-space indentation. Keep trailing newline.

4. **Write the file back.**

5. **Confirm** in one line: "Wired statusline → `<path>`. Restart Claude Code (or open a new session) to see the new statusline."

6. **(Optional)** Mention that the banner text is controlled by `$STATUSLINE_LABEL` (default: `COGX`). If the user wants to customize it, suggest:
   - PowerShell (persistent): `[Environment]::SetEnvironmentVariable("STATUSLINE_LABEL","MYLABEL","User")`
   - bash/zsh: add `export STATUSLINE_LABEL=MYLABEL` to their shell profile.

Do **not** modify project-level `.claude/settings.json` files — this command is for the user's global config only.
