/**
 * Stable numbering for rendered code blocks.
 *
 * A markdown component re-renders its message many times (every frame while
 * streaming, again on resize, again when it is replayed into scrollback), so
 * numbering by render order would make the badge flicker and leak entries.
 * Blocks are therefore keyed by their own content: the same code always gets
 * the same index, and re-renders are free.
 */

export interface CodeBlockRecord {
	/** 1-based index shown in the frame chip and accepted by `/copy-block <n>`. */
	index: number;
	/** Raw, unhighlighted source — what `/copy-block` puts on the clipboard. */
	code: string;
	/** Fence info string, when the block declared one. */
	lang?: string;
}

/** Bound on retained blocks; oldest are evicted first. */
const MAX_BLOCKS = 300;

export class BlockRegistry {
	#byKey = new Map<string, CodeBlockRecord>();
	#byIndex = new Map<number, CodeBlockRecord>();
	#next = 1;
	#latest: CodeBlockRecord | undefined;

	/** Record a block (or return its existing record) and mark it most recent. */
	record(code: string, lang: string | undefined): CodeBlockRecord {
		const key = `${lang ?? ""}\u0000${code}`;
		const existing = this.#byKey.get(key);
		if (existing) {
			this.#latest = existing;
			return existing;
		}
		const record: CodeBlockRecord = { index: this.#next++, code, lang };
		this.#byKey.set(key, record);
		this.#byIndex.set(record.index, record);
		this.#latest = record;
		if (this.#byKey.size > MAX_BLOCKS) {
			const oldestKey = this.#byKey.keys().next().value;
			if (oldestKey !== undefined) {
				const oldest = this.#byKey.get(oldestKey);
				this.#byKey.delete(oldestKey);
				if (oldest) this.#byIndex.delete(oldest.index);
			}
		}
		return record;
	}

	get(index: number): CodeBlockRecord | undefined {
		return this.#byIndex.get(index);
	}

	/** The most recently rendered block — the target of a bare `/copy-block`. */
	latest(): CodeBlockRecord | undefined {
		return this.#latest;
	}

	/** Indices currently resolvable, oldest first. */
	indices(): number[] {
		return [...this.#byIndex.keys()];
	}

	reset(): void {
		this.#byKey.clear();
		this.#byIndex.clear();
		this.#latest = undefined;
		this.#next = 1;
	}
}
