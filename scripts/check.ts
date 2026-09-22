/**
 * End-to-end checks against the real omp markdown renderer.
 *
 *   bun scripts/check.ts
 *
 * Each case renders through an actual `Markdown` component with the extension's
 * theme patch installed, then asserts on the rows it produced.
 */
import { getMarkdownTheme, initTheme, Markdown } from "@oh-my-pi/pi-coding-agent";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import ompCodeblocks from "../src/index";

await initTheme(false, "nerd", false, "dark-sunset-custom", "dark-sunset-custom");

const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
const completions = new Map<
	string,
	(prefix: string) => { value: string; label: string; description?: string; hint?: string }[] | null
>();
const pi = {
	setLabel() {},
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
		handlers.set(event, handler);
	},
	registerCommand(
		name: string,
		definition: {
			handler: (args: string, ctx: unknown) => Promise<void>;
			getArgumentCompletions?: (prefix: string) => { value: string; label: string; description?: string; hint?: string }[] | null;
		},
	) {
		commands.set(name, definition.handler);
		if (definition.getArgumentCompletions) completions.set(name, definition.getArgumentCompletions);
	},
};
ompCodeblocks(pi as never);
await handlers.get("session_start")?.({}, { setInterval: () => 0 });

const plain = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");
const failures: string[] = [];
function check(name: string, ok: boolean, detail: string): void {
	if (ok) {
		process.stdout.write(`  ok   ${name}\n`);
		return;
	}
	failures.push(name);
	process.stdout.write(`  FAIL ${name}: ${detail}\n`);
}

/** Column of the first box glyph in a row, or -1. */
function frameColumn(row: string): number {
	return plain(row).search(/[\u256d\u2570\u2502]/);
}

function render(text: string, width: number, paddingX: number): readonly string[] {
	return new Markdown(text, paddingX, 0, getMarkdownTheme(), undefined, 0).render(width);
}

// ── Frame geometry, on both markdown surfaces (paddingX 1 and 0) ──
for (const paddingX of [1, 0]) {
	const rows = render("```ts\nconst x = 1;\nfoo(x);\n```", 60, paddingX);
	const framed = rows.filter(row => frameColumn(row) >= 0);
	const columns = new Set(framed.map(frameColumn));
	const widths = new Set(framed.map(row => visibleWidth(row)));
	const at = `paddingX ${paddingX}`;
	check(`frame rows share one left column (${at})`, columns.size === 1, `columns: ${[...columns].join(", ")}`);
	check(`frame rows share one width (${at})`, widths.size === 1, `widths: ${[...widths].join(", ")}`);
	check(`no row exceeds render width (${at})`, rows.every(row => visibleWidth(row) <= 60), "a row overflowed");
	check(`header names the language (${at})`, rows.some(row => plain(row).includes("─ ts ─")), plain(rows[0] ?? ""));
	check(`footer carries the copy index (${at})`, rows.some(row => /─ #\d+ ─/.test(plain(row))), "no footer index");
	check(
		`gutter numbers every source line (${at})`,
		plain(framed.join("\n")).includes(" 1 const x = 1;") && plain(framed.join("\n")).includes(" 2 foo(x);"),
		plain(framed.join("\n")),
	);
}

// ── Framing preserves the native highlighter's colors ──
{
	const rows = render('```ts\n// note\nexport const n = 42;\nconst s = "str";\n```', 70, 1);
	const colorsPerRow = rows.map(row => new Set([...row.matchAll(/\x1b\[38;2;([\d;]+)m/g)].map(m => m[1])));
	const richest = Math.max(...colorsPerRow.map(colors => colors.size));
	check("code rows carry multiple syntax colors", richest >= 4, `most colors on one row: ${richest}`);

	// A wrapped continuation must re-open the active style, not render bare.
	const long = `const message = "${"y".repeat(120)}";`;
	const wrapped = render(`\`\`\`ts\n${long}\n\`\`\``, 70, 1).filter(row => plain(row).includes("│"));
	const continuation = wrapped[1] ?? "";
	check(
		"wrapped continuation keeps the string color",
		/\x1b\[38;2;[\d;]+m/.test(continuation.replace(/^[^\u2502]*\u2502/, "")),
		JSON.stringify(continuation.slice(0, 60)),
	);
}

// ── Long lines wrap inside the frame instead of overflowing it ──
{
	const long = `const message = "${"x".repeat(200)}";`;
	const rows = render(`\`\`\`ts\n${long}\n\`\`\``, 60, 1);
	const body = rows.filter(row => plain(row).trimStart().startsWith("│"));
	check("long line wraps to multiple rows", body.length > 1, `body rows: ${body.length}`);
	check("wrapped rows stay within width", body.every(row => visibleWidth(row) <= 60), "a wrapped row overflowed");
	check(
		"only the first wrapped row is numbered",
		/^\s*│\s+1\s/.test(plain(body[0] ?? "")) && !/^\s*│\s+\d+\s/.test(plain(body[1] ?? "")),
		`${plain(body[0] ?? "")} / ${plain(body[1] ?? "")}`,
	);
}

// ── Diff-family blocks stay on native fences (they stream line-by-line) ──
{
	const rows = render("```diff\n-old\n+new\n```", 60, 1);
	check(
		"diff blocks keep native fences",
		rows.some(row => plain(row).includes("```diff")) && !rows.some(row => frameColumn(row) >= 0),
		plain(rows.join("\n")),
	);
}

// ── A terminal too narrow for a frame falls back to native fences ──
{
	const rows = render("```ts\nx\n```", 16, 1);
	check("narrow width falls back", rows.some(row => plain(row).includes("```")), plain(rows.join("\n")));
}

// ── /copy-block puts the raw source on the clipboard ──
{
	const rows = render("```ts\nconst answer = 42;\n```", 60, 1);
	const index = /─ #(\d+) ─/.exec(plain(rows.join("\n")))?.[1] ?? "";
	const notifications: string[] = [];
	const ctx = { ui: { notify: (message: string) => notifications.push(message) } };

	await commands.get("copy-block")?.(index, ctx);
	const byIndex = await new Response(Bun.spawn(["pbpaste"], { stdout: "pipe" }).stdout).text();
	check(`/copy-block ${index} copies the raw source`, byIndex === "const answer = 42;", JSON.stringify(byIndex));
	check("/copy-block reports what it copied", notifications.some(n => n.includes(`#${index}`)), notifications.join(" | "));

	// A bare /copy-block targets the most recently rendered block and names
	// the rest of the session's blocks inline so one can be picked up next.
	await Bun.spawn(["pbcopy"], { stdin: new TextEncoder().encode("stale") }).exited;
	await commands.get("copy-block")?.("", ctx);
	const latest = await new Response(Bun.spawn(["pbpaste"], { stdout: "pipe" }).stdout).text();
	check("bare /copy-block copies the latest block", latest === "const answer = 42;", JSON.stringify(latest));
	check(
		"bare /copy-block lists the other blocks inline",
		notifications.some(message => message.includes("(latest)") && message.includes("1, 2, 3, 4")),
		JSON.stringify(notifications),
	);

	notifications.length = 0;
	await commands.get("copy-block")?.("9999", ctx);
	check("/copy-block rejects an unknown index", notifications.some(n => n.includes("No block")), notifications.join(" | "));
}

// ── /copy-block suggests rendered blocks for argument autocomplete ──
{
	const fn = completions.get("copy-block");
	check("copy-block registers argument completions", fn !== undefined);
	if (fn) {
		// Re-render the known block so its index is stable, then read the list.
		const rows = render("```ts\nconst answer = 42;\n```", 60, 1);
		const index = /─ #(\d+) ─/.exec(plain(rows.join("\n")))?.[1] ?? "";
		const all = fn("") ?? [];
		check(
			"completions: empty prefix lists blocks in descending index order",
			all.length > 0 &&
				all.every(item => /^\d+$/.test(item.value)) &&
				new Set(all.map(item => item.value)).size === all.length &&
				Number(all[0].value) === Math.max(...all.map(item => Number(item.value))) &&
				all.every(item => item.label.startsWith(`#${item.value} · `)),
			JSON.stringify(all.slice(0, 3)),
		);

		const newest = all[0]?.value ?? "";
		const byIndex = fn(newest[0]) ?? [];
		check(
			"completions: a numeric prefix filters on the index",
			byIndex.length > 0 && byIndex.every(item => item.value.startsWith(newest[0])) && byIndex.some(item => item.value === newest),
			JSON.stringify(byIndex.map(item => item.value)),
		);

		const lang = /#\d+ · (\S+)/.exec(all[0]?.label ?? "")?.[1] ?? "";
		const byLang = fn(lang) ?? [];
		check(
			"completions: a language prefix filters on the declared language",
			lang !== "" && byLang.length > 0 && byLang.every(item => item.label.endsWith(`· ${lang}`)),
			JSON.stringify(byLang.map(item => item.label)),
		);

		const item = all.find(candidate => candidate.value === index);
		check("completions: the description previews the first code line", item?.description === "const answer = 42;", JSON.stringify(item));

		check("completions: a spaced prefix yields none", fn("1 2") === null);
	}
}

process.stdout.write(failures.length === 0 ? "\nAll checks passed.\n" : `\n${failures.length} FAILED\n`);
process.exit(failures.length === 0 ? 0 : 1);
