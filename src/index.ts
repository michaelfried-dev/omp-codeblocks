/**
 * omp-codeblocks — frame markdown code blocks like omp's own tool blocks.
 *
 * ## How it hooks in
 *
 * omp has no extension hook for markdown rendering, so this patches the one
 * mutable seam that governs fence output: `getMarkdownTheme()` returns a
 * *cached, shared* theme object, and `Markdown` calls two of its plain function
 * properties for every fenced block —
 *
 *   codeBlockBorder("```lang")   → the opening fence row
 *   highlightCode(code, lang)    → the body, as styled lines
 *   codeBlockBorder("```")       → the closing fence row
 *
 * Replacing those two properties lets the component itself own row counting,
 * which matters: `Markdown` tracks rendered rows privately for native-scrollback
 * commits, so wrapping `render()` to post-process rows would desync that
 * bookkeeping and duplicate or drop transcript lines while streaming.
 *
 * The calls arrive in strict order per block, so the opening fence becomes the
 * header bar, `highlightCode` emits the numbered body rows, and the closing
 * fence becomes the footer bar carrying the block's copy index.
 */
import { getMarkdownTheme, Markdown } from "@oh-my-pi/pi-coding-agent";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem, MarkdownTheme } from "@oh-my-pi/pi-tui";
import { copyToClipboard } from "./clipboard";
import { buildFrame, frameWidth, MIN_FRAME_WIDTH } from "./frame";
import { BlockRegistry, type CodeBlockRecord } from "./registry";

/** Marks an object this extension has already patched, across reloads. */
const PATCHED = Symbol.for("omp-codeblocks.patched");

/**
 * Languages left unframed. While streaming, diff-family blocks are highlighted
 * one line per `highlightCode` call, which would frame every single line.
 */
const UNFRAMED_LANGS: Record<string, true> = { diff: true, patch: true, udiff: true };

/** How often to re-check the patch, catching theme switches made while idle. */
const REPATCH_INTERVAL_MS = 5000;
/** Cap on how many blocks are offered as argument completions. */
const COMPLETION_LIMIT = 10;

/** Width most recently handed to `Markdown.render()`, observed by the probe. */
let lastRenderWidth = 80;

type Patchable = { [PATCHED]?: boolean };

/**
 * Record the render width without altering the rendered rows.
 *
 * `highlightCode` gets no width argument and no access to the component, so the
 * frame would otherwise have to guess the terminal's geometry. The returned
 * array is passed through untouched, leaving row bookkeeping intact — wrapping
 * it would desync the private row counters behind native-scrollback commits.
 */
function installRenderWidthProbe(): void {
	const proto = Markdown.prototype as Markdown & Patchable;
	if (proto[PATCHED]) return;
	const original = proto.render;
	proto.render = function patchedRender(this: Markdown, width: number): readonly string[] {
		lastRenderWidth = width;
		return original.call(this, width);
	};
	proto[PATCHED] = true;
}

/**
 * Swap framing implementations into the cached markdown theme.
 *
 * Idempotent, and cheap enough to call on every turn: a theme switch rebuilds
 * the cached object, which silently drops the patch until it is reinstalled.
 */
function installThemePatch(registry: BlockRegistry): void {
	const markdownTheme = getMarkdownTheme() as MarkdownTheme & Patchable;
	if (markdownTheme[PATCHED]) return;

	const originalHighlight = markdownTheme.highlightCode;
	const originalBorder = markdownTheme.codeBlockBorder;
	/** Set while the fence pair around a framed block is being emitted. */
	let framing = false;
	/** Fence rows alternate open/close; `"```"` alone is ambiguous without this. */
	let insideFence = false;

	markdownTheme.highlightCode = (code: string, lang?: string): string[] => {
		const styled = originalHighlight ? originalHighlight(code, lang) : code.split("\n");
		if (!framing) return styled;
		const width = frameWidth(lastRenderWidth);
		const { index } = registry.record(code, lang);
		return buildFrame(styled, width, lang, index);
	};

	markdownTheme.codeBlockBorder = (text: string): string => {
		if (!text.startsWith("```")) return originalBorder(text);
		if (!insideFence) {
			insideFence = true;
			const lang = text.slice(3).trim().toLowerCase();
			framing = frameWidth(lastRenderWidth) >= MIN_FRAME_WIDTH && !UNFRAMED_LANGS[lang];
			// The frame carries its own bars, so the fence row is spent on the
			// blank line that separates the block from the prose around it.
			return framing ? "" : originalBorder(text);
		}
		insideFence = false;
		return framing ? "" : originalBorder(text);
	};

	markdownTheme[PATCHED] = true;
}

/**
 * Argument completions for `/copy-block`: the rendered blocks, newest first,
 * each keyed by the index shown in its frame footer. Numeric prefixes match
 * the index, anything else matches the declared language.
 */
function blockCompletions(
	registry: BlockRegistry,
	argumentPrefix: string,
): AutocompleteItem[] | null {
	const normalized = argumentPrefix.trim().toLowerCase();
	if (normalized.includes(" ")) return null;

	const records = registry
		.indices()
		.reverse()
		.map(index => registry.get(index))
		.filter((record): record is CodeBlockRecord => record !== undefined);
	if (records.length === 0) return null;

	const numeric = /^\d+$/.test(normalized);
	const items = records
		.filter(record => {
			const target = numeric
				? String(record.index)
				: (record.lang?.trim() || "text").toLowerCase();
			return normalized.length === 0 || target.startsWith(normalized);
		})
		.slice(0, COMPLETION_LIMIT)
		.map(record => {
			const lineCount = record.code.split("\n").length;
			return {
				value: String(record.index),
				label: `#${record.index} · ${record.lang?.trim() || "text"}`,
				description: record.code.split("\n")[0]?.trim().slice(0, 60) || undefined,
				hint: `${lineCount} line${lineCount === 1 ? "" : "s"}`,
			};
		});
	return items.length > 0 ? items : null;
}

export default function ompCodeblocks(pi: ExtensionAPI): void {
	const registry = new BlockRegistry();
	pi.setLabel("Code Blocks");

	pi.on("session_start", async (_event, ctx) => {
		registry.reset();
		installRenderWidthProbe();
		installThemePatch(registry);
		ctx.setInterval(() => installThemePatch(registry), REPATCH_INTERVAL_MS);
	});
	pi.on("turn_start", async () => installThemePatch(registry));
	pi.on("message_start", async () => installThemePatch(registry));

	const copyBlock = async (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => {
		const argument = args.trim();
		if (argument.length > 0 && !/^\d+$/.test(argument)) {
			ctx.ui.notify(`Not a block number: ${argument}`, "error");
			return;
		}
		const record = argument.length > 0 ? registry.get(Number(argument)) : registry.latest();
		if (!record) {
			const known = registry.indices();
			ctx.ui.notify(
				known.length === 0
					? "No code blocks rendered yet"
					: `No block #${argument} — available: ${known.join(", ")}`,
				"warning",
			);
			return;
		}
		const lineCount = record.code.split("\n").length;
		const outcome = await copyToClipboard(record.code);
		if (outcome === "failed") {
			ctx.ui.notify(`Could not reach a clipboard for block #${record.index}`, "error");
			return;
		}
		// A bare invocation shows the rest of the session inline so the user
		// can point at a specific one on the next call.
		const others = registry.indices().filter(n => n !== record.index);
		ctx.ui.notify(
			`Copied block #${record.index} — ${lineCount} line${lineCount === 1 ? "" : "s"}${
				record.lang ? ` of ${record.lang}` : ""
			}${argument.length === 0 ? " (latest)" : ""}${others.length ? ` · others: ${others.join(", ")}` : ""}`,
			"info",
		);
	};
	pi.registerCommand("copy-block", {
		description: "Copy a code block to the clipboard: [block number], or omit for the latest",
		getArgumentCompletions: argumentPrefix => blockCompletions(registry, argumentPrefix),
		handler: copyBlock,
	});
}
