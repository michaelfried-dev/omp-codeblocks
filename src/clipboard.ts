/**
 * Self-contained clipboard write.
 *
 * omp has its own `copyToClipboard`, but it lives behind an unversioned deep
 * import (`@oh-my-pi/pi-coding-agent/utils/clipboard`). This reimplements the
 * same two-pronged strategy so the extension only depends on the package root:
 * OSC 52 first (works over SSH/mosh/tmux, and is what a terminal multiplexer
 * forwards), then a native helper for local sessions that ignore OSC 52.
 */

/** Native clipboard helpers by platform, in the order they are attempted. */
function nativeCommands(): string[][] {
	if (process.platform === "darwin") return [["pbcopy"]];
	if (process.platform === "win32") return [["clip.exe"]];
	return [
		["wl-copy"],
		["xclip", "-selection", "clipboard"],
		["xsel", "--clipboard", "--input"],
	];
}

/**
 * Put `text` on the system clipboard, best effort.
 *
 * Returns the mechanism that reported success. OSC 52 cannot be verified from
 * this side — the terminal never answers — so it is reported as `osc52` only
 * when no native helper also succeeded.
 */
export async function copyToClipboard(text: string): Promise<"native" | "osc52" | "failed"> {
	let wroteOsc52 = false;
	if (process.stdout.isTTY) {
		try {
			process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
			wroteOsc52 = true;
		} catch {
			// A closed/EPIPE stdout is not fatal; fall through to the native helper.
		}
	}

	for (const command of nativeCommands()) {
		try {
			const child = Bun.spawn(command, {
				stdin: new TextEncoder().encode(text),
				stdout: "ignore",
				stderr: "ignore",
			});
			if ((await child.exited) === 0) return "native";
		} catch {
			// Helper missing on this host — try the next one.
		}
	}

	return wroteOsc52 ? "osc52" : "failed";
}
