# claude-statusline

A minimal single-line statusline for [Claude Code](https://claude.com/claude-code).

```
▊ COGX Sebastien  │  ⏇ main +2~1?3 ↑1  │  Opus 4.7 (1M context)  │  ⏱ 3m15s  │  ● 42% ctx  │  $0.37
```

## What it shows

| Segment | Source |
|---|---|
| Banner (`▊ COGX`) | `$STATUSLINE_LABEL` env var (default `COGX`) |
| User | `git config user.name` |
| Branch + status | `git branch --show-current`, `git status --porcelain`, `git rev-list ... @{upstream}` |
| Model name | Claude Code's session payload on stdin (live) |
| Session duration | `data.cost.total_duration_ms` from Claude Code |
| Context % | `data.context_window.used_percentage` |
| Cost | `data.cost.total_cost_usd` |

Status indicators: `+N` staged, `~N` modified, `?N` untracked, `↑N` ahead of upstream, `↓N` behind.

## Install

Claude Code installs plugins through marketplaces. A single-plugin repo (like this one) acts as an implicit one-plugin marketplace, so the flow is:

1. **Add the repo as a marketplace** in Claude Code:

   ```
   /plugin marketplace add https://github.com/cogx-sol/claude-statusline.git
   ```

2. **Install the plugin from it:**

   ```
   /plugin install claude-statusline@claude-statusline
   ```

   (`<plugin-name>@<marketplace-name>` — both are `claude-statusline` here because the marketplace name is derived from the repo name.)

3. **Wire it into your settings** by running the bundled setup command:

   ```
   /claude-statusline:setup
   ```

   This patches `~/.claude/settings.json` with the right `statusLine` entry. Restart Claude Code (or open a new session) to see it.

If you'd rather wire it manually, append this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<absolute-path-to>/claude-statusline/statusline.cjs\""
  }
}
```

## Customize the banner

The `▊ COGX` label is whatever `$STATUSLINE_LABEL` is set to at the time Claude Code spawns the script.

**Persistent (Windows, PowerShell):**

```powershell
[Environment]::SetEnvironmentVariable("STATUSLINE_LABEL", "MYLABEL", "User")
```

Open a new shell for it to take effect.

**Persistent (bash/zsh):**

```bash
echo 'export STATUSLINE_LABEL=MYLABEL' >> ~/.zshrc   # or ~/.bashrc
```

**Per-session test:**

```powershell
$env:STATUSLINE_LABEL = "MYLABEL"; node /path/to/statusline.cjs
```

## Extend it — add your own segment

The statusline is built from an array of **segments** in `statusline.cjs`. Each
segment is a function that returns its rendered string, or `''` to be omitted.
Segments are joined left-to-right by the `│` divider, so a hidden one never
leaves a dangling separator.

To add a status, append a function to the array in `buildSegments(...)` (look for
the `── add new statuses here ──` marker). Array order is display order.

**Example — show the current directory:**

```js
function buildSegments({ git, modelName, ctxInfo, costInfo, duration }) {
  return [
    // ...existing segments...
    () => costInfo && costInfo.costUsd > 0
        ? c.brightYellow + '$' + costInfo.costUsd.toFixed(2) + c.reset : '',
    // ── add new statuses here ──
    () => c.dim + '⊙ ' + path.basename(CWD) + c.reset,   // ← new segment
  ];
}
```

That's it — `path`, `CWD`, and the `c` color table are already in scope.

**If your segment needs new data**, write a small collector and thread it
through the object passed to `buildSegments`. For example, a clock:

```js
// 1. add to generateStatusline(), alongside the other collectors:
const now = new Date().toTimeString().slice(0, 5);   // "14:32"

// 2. pass it in:
buildSegments({ git, modelName, ctxInfo, costInfo, duration, now })

// 3. consume it in buildSegments({ ..., now }):
() => c.cyan + '🕑 ' + now + c.reset,
```

Available colors live in the `c` object near the top of the file (`c.red`,
`c.brightGreen`, `c.dim`, …); always close a colored span with `c.reset`.

## Run it standalone

```bash
node statusline.cjs              # renders the line
node statusline.cjs --json       # structured output
node statusline.cjs --compact    # JSON, one line
```

With a simulated Claude Code payload:

```bash
echo '{"model":{"display_name":"Opus 4.7"},"context_window":{"used_percentage":42},"cost":{"total_cost_usd":0.37,"total_duration_ms":195000}}' | node statusline.cjs
```

## How dynamic values reach the script

Claude Code pipes a JSON payload to the statusline command's stdin on every render. The script reads that synchronously via `fs.readSync(0, ...)`, skipping the read when stdin is a TTY (so manual runs don't hang). When the payload is absent or doesn't carry a field, the script falls back to file-based detection (`~/.claude.json` `lastModelUsage`) or sensible defaults.

## Cross-platform notes

- Git lookups use `execFileSync('git', ...)` with no shell — works on Windows `cmd.exe`/PowerShell, macOS, Linux without quoting gymnastics.
- ANSI escapes are used directly; Windows Terminal, PowerShell 7, iTerm2, and most Linux terminals render them fine. Legacy `conhost` may not.

## License

MIT.
