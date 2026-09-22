/**
 * Frame drawing for fenced code blocks.
 *
 * Mirrors the chrome omp's own tool blocks use (`renderOutputBlock`, the frame
 * around `write`/`edit`/eval cells): a rounded bar with a three-cell cap and an
 * inset label, `│ … │` content rows with one cell of padding, a dim border, and
 * a line-number gutter of plain dim digits prefixed to the code — no separator
 * glyph. Reimplemented rather than imported because `renderOutputBlock` lives
 * behind an unversioned deep import.
 *
 * Every row is produced in one pass, from the callback whose rows `Markdown`
 * emits literally at column 0. Splitting the frame across the fence callbacks
 * instead would subject its bars to the component's private `paddingX` while
 * its body stayed unpadded, and nothing can reconcile the two: the component
 * caches rendered rows by text and width, so a later correction is never
 * repainted.
 */
import { padding, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { theme } from "@oh-my-pi/pi-coding-agent";

/** Cap glyph count after the corner, matching `renderOutputBlock`'s `h.repeat(3)`. */
const CAP_CELLS = 3;
/** One cell of padding inside each vertical border, the output-block default. */
const CONTENT_PADDING = 1;
/** Gutter never shrinks below two digits, so 1..99 share one layout. */
const MIN_GUTTER_WIDTH = 2;
/** Below this the frame is pointless; the block renders as a plain fence instead. */
export const MIN_FRAME_WIDTH = 24;

function border(text: string): string {
	return theme.fg("dim", text);
}

/** Cells of left indent, matching the assistant-message surface's `paddingX`. */
const FRAME_INDENT = 1;

/**
 * Frame width for a component rendered at `renderWidth`.
 *
 * `Markdown.render()` fits every row, including the literal code rows this
 * frame rides on, within `renderWidth - 2 * paddingX`. `paddingX` is private,
 * and the surfaces that render markdown use 0 or 1, so the frame reserves its
 * own indent plus the widest padding: on the assistant-message surface its
 * columns line up exactly with the surrounding prose, and on a flush surface
 * it is simply inset.
 */
export function frameWidth(renderWidth: number): number {
	return renderWidth - FRAME_INDENT - 2;
}

/** Horizontal bar with an optional inset label: `╭─── typescript ─────────╮`. */
function bar(width: number, leftChar: string, rightChar: string, label?: string): string {
	const h = theme.boxRound.horizontal;
	const leftGlyphs = `${leftChar}${h.repeat(CAP_CELLS)}`;
	const leftWidth = visibleWidth(leftGlyphs);
	const rightWidth = visibleWidth(rightChar);
	if (!label) {
		return border(leftGlyphs + h.repeat(Math.max(0, width - leftWidth - rightWidth)) + rightChar);
	}
	const trimmed = truncateToWidth(` ${label} `, Math.max(0, width - leftWidth - rightWidth));
	const fill = Math.max(0, width - leftWidth - visibleWidth(trimmed) - rightWidth);
	return `${border(leftGlyphs)}${trimmed}${border(h.repeat(fill) + rightChar)}`;
}

/**
 * Render a complete framed block: header bar naming the language, numbered code
 * rows, and a footer bar carrying the copy index. Line numbers count source
 * lines, so a wrapped line is numbered once and its continuations are blank.
 */
export function buildFrame(
	styledLines: readonly string[],
	width: number,
	lang: string | undefined,
	index: number,
): string[] {
	const contentWidth = Math.max(1, width - 2 - CONTENT_PADDING * 2);
	const gutterWidth = Math.max(MIN_GUTTER_WIDTH, String(styledLines.length).length);
	const pad = padding(CONTENT_PADDING);
	const indent = padding(FRAME_INDENT);
	const vertical = border(theme.boxRound.vertical);

	const label = lang?.trim() ? lang.trim() : "text";
	const rows = [
		indent + bar(width, theme.boxRound.topLeft, theme.boxRound.topRight, theme.fg("toolTitle", label)),
	];
	for (const [i, line] of styledLines.entries()) {
		const numbered = theme.fg("dim", `${String(i + 1).padStart(gutterWidth)} `) + line;
		for (const row of wrapTextWithAnsi(numbered.trimEnd(), contentWidth)) {
			const cell = row + padding(Math.max(0, contentWidth - visibleWidth(row)));
			rows.push(`${indent}${vertical}${pad}${cell}${pad}${vertical}`);
		}
	}
	rows.push(
		indent + bar(width, theme.boxRound.bottomLeft, theme.boxRound.bottomRight, theme.fg("dim", `#${index}`)),
	);
	return rows;
}
