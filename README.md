# omp-codeblocks

Renders markdown code blocks in [omp](https://omp.sh) as framed windows that match omp's own tool blocks — rounded border, language header, line-number gutter — and adds `/copy-block` to copy a block to the clipboard.

Without it, omp draws fenced blocks as literal ` ``` ` marker lines:

```text
```typescript
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```
```

With it:

```text
 ╭─── typescript ────────────────────────────────────────╮
 │  1 export function greet(name: string): string {      │
 │  2   return `Hello, ${name}!`;                        │
 │  3 }                                                  │
 ╰─── #4 ────────────────────────────────────────────────╯
```

Syntax colors, border glyphs, and the header color all come from your active omp theme (`syntax*`, `dim`, `toolTitle`, `boxRound`), so the frame matches whatever theme you run.

## Install

```bash
omp plugin install omp-codeblocks
```

Or clone it anywhere and point omp at the entry file:

```bash
git clone https://github.com/michaelfried-dev/omp-codeblocks.git
omp --extension ./omp-codeblocks/src/index.ts
```

To load it in every session, add it to `~/.omp/agent/config.yml`:

```yaml
extensions:
  - ~/dev/omp-codeblocks/src/index.ts
```

Or drop the directory into `~/.omp/agent/extensions/`, which omp scans automatically (it resolves `package.json` → `omp.extensions`).

## Copying a block

Every frame's footer carries an index — `#4` above. That index is the handle:

| Command | Effect |
|---|---|
| `/copy-block` | Copy the most recently rendered block |
| `/copy-block 4` | Copy block `#4` |

Type `/copy-block ` and the blocks you have rendered are offered as completions, newest first — `#4 · typescript` with its first line as the description and its length as a hint. A digit filters by index, anything else filters by language (`py` narrows to the Python blocks).

You get the raw source: no borders, no line numbers, no trailing newline. The copy goes out over OSC 52 first (so it works over SSH, mosh, and tmux) and then through the platform helper — `pbcopy`, `wl-copy`, `xclip`, `xsel`, or `clip.exe`.

Indices are stable per block content and reset each session. omp's built-in `/copy` still works if you prefer browsing a tree of copy targets.

## How it works, and what that costs you

omp exposes no extension hook for markdown rendering, so this patches the seam that governs fence output. `getMarkdownTheme()` returns a **cached, shared** theme object, and `Markdown` calls its plain function properties for every fenced block:

| Call | Original output | Patched output |
|---|---|---|
| `codeBlockBorder("```lang")` | opening fence row | blank separator row |
| `highlightCode(code, lang)` | styled code lines | header bar + numbered rows + footer bar |
| `codeBlockBorder("```")` | closing fence row | blank separator row |

Two deliberate constraints shaped this:

**The whole frame comes from one callback.** Splitting it — bars from the fence callbacks, body from `highlightCode` — misaligns them, because `Markdown` pads fence rows by its private `paddingX` while emitting code-body rows literally at column 0. That cannot be corrected after the fact: the component caches rendered rows by text and width, so a measured-then-repainted fix is never repainted. Emitting every row from `highlightCode` makes the frame padding-independent.

**`render()` is never post-processed.** Wrapping `Markdown.prototype.render` to rewrite rows would desync the private row counters behind native-scrollback commits (`getNativeScrollbackWidthEpochRows` reads `#cachedLines.length` directly), duplicating or dropping transcript lines while streaming. The prototype is touched only to record the render width, and the returned array is passed through untouched.

Known behavior that follows from the approach:

- **It applies to all markdown surfaces**, not just assistant messages — `read` output, `think`, eval cells, ask dialogs. The theme object is global; it cannot be scoped.
- **Blocks are unframed while streaming.** Mid-stream, omp renders code through a different path that never calls `highlightCode`; the frame appears when the fence closes.
- **`diff`, `patch`, and `udiff` blocks keep native fences.** While streaming, those are highlighted one line per call, which would frame each line individually.
- **A theme switch drops the patch** until it is reinstalled, which happens on the next turn or within five seconds.
- **It depends on unofficial internals.** No extension API covers this; a change to omp's markdown theme shape can break it.

## Development

```bash
bun scripts/preview.ts 76      # render sample markdown and eyeball the frame
bun scripts/check.ts           # assert geometry, wrapping, fallbacks, clipboard
```

`scripts/check.ts` drives real `Markdown` components with the patch installed and asserts on the rows produced: frame rows share one column and width on both padding surfaces, long lines wrap inside the frame, narrow terminals and diff blocks fall back to native fences, and `/copy-block` lands the raw source on the system clipboard.

For local development against your installed omp, link the packages once:

```bash
mkdir -p node_modules/@oh-my-pi
for p in pi-coding-agent pi-tui pi-utils pi-ai pi-natives omptype; do
  ln -sfn ~/.bun/install/global/node_modules/@oh-my-pi/$p node_modules/@oh-my-pi/$p
done
```

## License

MIT
