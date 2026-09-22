/**
 * Render sample markdown through the patched theme and print it, so the frame
 * can be inspected without launching a session.
 *
 *   bun scripts/preview.ts [width] [theme-name]
 */
import { getMarkdownTheme, initTheme, Markdown } from "@oh-my-pi/pi-coding-agent";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import ompCodeblocks from "../src/index";

const width = Number(process.argv[2] ?? 76);
const themeName = process.argv[3] ?? "dark-sunset-custom";

await initTheme(false, "nerd", false, themeName, themeName);

// Drive the extension's registration path, then its session wiring, with a
// context stub exposing only what the handlers touch.
const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
const pi = {
	setLabel() {},
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
		handlers.set(event, handler);
	},
	registerCommand() {},
};
ompCodeblocks(pi as never);
await handlers.get("session_start")?.({}, { setInterval: () => 0 });

const sample = `Here is prose before the block.

\`\`\`typescript
export function greet(name: string): string {
  // A comment, to check the comment color
  const greeting = \`Hello, \${name}!\`;
  return greeting.repeat(2);
}
\`\`\`

Prose between blocks.

\`\`\`bash
rsync -az --delete ./dist/ /var/www/app/
\`\`\`

\`\`\`
plain fence with no language
and a second line
\`\`\`

Trailing prose.`;

// Same construction the assistant-message surface uses: paddingX 1, no code indent.
const markdown = new Markdown(sample, 1, 0, getMarkdownTheme(), undefined, 0);
const rows = markdown.render(width);
for (const line of rows) process.stdout.write(`${line}\n`);

const overflowing = rows.filter(line => visibleWidth(line) > width);
process.stdout.write(
	overflowing.length === 0
		? `\nAll ${rows.length} rows fit within ${width} cells.\n`
		: `\n${overflowing.length}/${rows.length} rows EXCEED ${width} cells: ${overflowing
				.map(line => visibleWidth(line))
				.join(", ")}\n`,
);
