/**
 * Operational Transformation (OT) Engine for plain-text documents.
 *
 * An operation is an array of components:
 *   - A positive integer n       → retain(n): skip n characters
 *   - A string s                 → insert(s): insert string s
 *   - A negative integer -n      → delete(n): delete n characters
 *
 * Every operation must exactly span the input document length
 * (sum of retain + |delete| = input length).
 */

// ── Builders ────────────────────────────────────────────────────

/** Create a retain component. */
export function retain(n) {
    if (typeof n !== 'number' || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`retain: n must be a positive integer, got ${n}`);
    }
    return n;
}

/** Create an insert component. */
export function insert(s) {
    if (typeof s !== 'string' || s.length === 0) {
        throw new Error(`insert: s must be a non-empty string`);
    }
    return s;
}

/**
 * Create a delete component.
 * Accepts a positive integer n, returns -n.
 */
export function del(n) {
    if (typeof n !== 'number' || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`del: n must be a positive integer, got ${n}`);
    }
    return -n;
}

// ── Type checks ─────────────────────────────────────────────────

export function isRetain(c) { return typeof c === 'number' && c > 0; }
export function isInsert(c) { return typeof c === 'string'; }
export function isDelete(c) { return typeof c === 'number' && c < 0; }

// ── Length helpers ──────────────────────────────────────────────

/**
 * Compute the input length (base document length) and output length
 * of an operation.
 */
export function opLengths(op) {
    let inputLen = 0;
    let outputLen = 0;
    for (const c of op) {
        if (isRetain(c)) {
            inputLen += c;
            outputLen += c;
        } else if (isInsert(c)) {
            outputLen += c.length;
        } else if (isDelete(c)) {
            inputLen += -c;
        } else {
            throw new Error(`Unknown component type: ${JSON.stringify(c)}`);
        }
    }
    return { inputLen, outputLen };
}

/**
 * Check if an operation is a no-op (all retains, no inserts or deletes).
 */
export function isNoop(op) {
    return op.every(c => isRetain(c));
}

// ── Op Builder (normalizes consecutive same-type components) ───

/**
 * OpBuilder accumulates components and automatically merges
 * consecutive components of the same type.
 */
class OpBuilder {
    constructor() {
        this.ops = [];
    }

    retain(n) {
        if (n <= 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isRetain(last)) {
            this.ops[this.ops.length - 1] = last + n;
        } else {
            this.ops.push(n);
        }
    }

    insert(s) {
        if (s.length === 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isInsert(last)) {
            this.ops[this.ops.length - 1] = last + s;
        } else {
            this.ops.push(s);
        }
    }

    delete(n) {
        if (n <= 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isDelete(last)) {
            this.ops[this.ops.length - 1] = last - n;
        } else {
            this.ops.push(-n);
        }
    }

    build() {
        return [...this.ops];
    }
}

// ── Apply ───────────────────────────────────────────────────────

/**
 * Apply an operation to a document string.
 * @param {string} doc - The current document
 * @param {Array} op - The operation to apply
 * @returns {string} The resulting document
 */
export function apply(doc, op) {
    const { inputLen } = opLengths(op);
    if (inputLen !== doc.length) {
        throw new Error(
            `apply: op input length (${inputLen}) !== doc length (${doc.length})`
        );
    }

    let result = '';
    let pos = 0;

    for (const c of op) {
        if (isRetain(c)) {
            result += doc.slice(pos, pos + c);
            pos += c;
        } else if (isInsert(c)) {
            result += c;
        } else if (isDelete(c)) {
            pos += -c; // skip over deleted chars
        }
    }

    // Append any remaining characters (if op has implicit trailing retain)
    result += doc.slice(pos);

    return result;
}

// ── Compose ─────────────────────────────────────────────────────

/**
 * Compose two sequential operations into one.
 * compose(op1, op2) produces op3 such that apply(doc, op3) === apply(apply(doc, op1), op2).
 *
 * op1 transforms doc → doc'
 * op2 transforms doc' → doc''
 * Result transforms doc → doc''
 *
 * Requirement: op1.outputLen === op2.inputLen
 */
export function compose(op1, op2) {
    const { outputLen: op1Out } = opLengths(op1);
    const { inputLen: op2In } = opLengths(op2);

    if (op1Out !== op2In) {
        throw new Error(
            `compose: op1 output length (${op1Out}) !== op2 input length (${op2In})`
        );
    }

    const builder = new OpBuilder();
    let i1 = 0, i2 = 0;
    let c1 = op1[i1], c2 = op2[i2];

    while (i1 < op1.length || i2 < op2.length) {
        // If we've exhausted one side, get undefined
        if (c1 === undefined && c2 === undefined) break;

        // op1 delete: consumes from base doc, doesn't interact with op2
        if (isDelete(c1)) {
            builder.delete(-c1);
            i1++;
            c1 = op1[i1];
            continue;
        }

        // op2 insert: produces chars, doesn't interact with op1
        if (isInsert(c2)) {
            builder.insert(c2);
            i2++;
            c2 = op2[i2];
            continue;
        }

        if (c1 === undefined || c2 === undefined) {
            throw new Error('compose: operation length mismatch during traversal');
        }

        // Both retain
        if (isRetain(c1) && isRetain(c2)) {
            const min = Math.min(c1, c2);
            builder.retain(min);
            c1 = c1 - min > 0 ? c1 - min : op1[++i1];
            c2 = c2 - min > 0 ? c2 - min : op2[++i2];
        }
        // op1 retain, op2 delete
        else if (isRetain(c1) && isDelete(c2)) {
            const min = Math.min(c1, -c2);
            builder.delete(min);
            c1 = c1 - min > 0 ? c1 - min : op1[++i1];
            c2 = -c2 - min > 0 ? -((-c2) - min) : op2[++i2];
        }
        // op1 insert, op2 retain
        else if (isInsert(c1) && isRetain(c2)) {
            const min = Math.min(c1.length, c2);
            builder.insert(c1.slice(0, min));
            c1 = c1.length - min > 0 ? c1.slice(min) : op1[++i1];
            c2 = c2 - min > 0 ? c2 - min : op2[++i2];
        }
        // op1 insert, op2 delete
        else if (isInsert(c1) && isDelete(c2)) {
            const min = Math.min(c1.length, -c2);
            // Insert then delete cancel out
            c1 = c1.length - min > 0 ? c1.slice(min) : op1[++i1];
            c2 = -c2 - min > 0 ? -((-c2) - min) : op2[++i2];
        }
        else {
            throw new Error(`compose: unexpected component pair: ${JSON.stringify(c1)}, ${JSON.stringify(c2)}`);
        }
    }

    return builder.build();
}

// ── Transform ───────────────────────────────────────────────────

/**
 * Transform two concurrent operations op1 and op2 (both based on the
 * same document state) so they can be applied in sequence.
 *
 * Returns [op1', op2'] such that:
 *   apply(apply(doc, op1), op2') === apply(apply(doc, op2), op1')
 *
 * Requirement: op1.inputLen === op2.inputLen
 */
export function transform(op1, op2) {
    const { inputLen: in1 } = opLengths(op1);
    const { inputLen: in2 } = opLengths(op2);

    if (in1 !== in2) {
        throw new Error(
            `transform: op1 input length (${in1}) !== op2 input length (${in2})`
        );
    }

    const builder1 = new OpBuilder(); // op1'
    const builder2 = new OpBuilder(); // op2'

    let i1 = 0, i2 = 0;
    let c1 = op1[i1], c2 = op2[i2];

    while (i1 < op1.length || i2 < op2.length) {
        if (c1 === undefined && c2 === undefined) break;

        // op1 insert goes first (left priority: op1 inserts come first)
        if (isInsert(c1)) {
            builder1.insert(c1);
            builder2.retain(c1.length);
            i1++;
            c1 = op1[i1];
            continue;
        }

        // op2 insert
        if (isInsert(c2)) {
            builder1.retain(c2.length);
            builder2.insert(c2);
            i2++;
            c2 = op2[i2];
            continue;
        }

        if (c1 === undefined || c2 === undefined) {
            throw new Error('transform: operation length mismatch during traversal');
        }

        // Both retain
        if (isRetain(c1) && isRetain(c2)) {
            const min = Math.min(c1, c2);
            builder1.retain(min);
            builder2.retain(min);
            c1 = c1 - min > 0 ? c1 - min : op1[++i1];
            c2 = c2 - min > 0 ? c2 - min : op2[++i2];
        }
        // op1 delete, op2 delete
        else if (isDelete(c1) && isDelete(c2)) {
            const min = Math.min(-c1, -c2);
            // Both delete the same range → both skip
            c1 = -c1 - min > 0 ? -((-c1) - min) : op1[++i1];
            c2 = -c2 - min > 0 ? -((-c2) - min) : op2[++i2];
        }
        // op1 delete, op2 retain
        else if (isDelete(c1) && isRetain(c2)) {
            const min = Math.min(-c1, c2);
            builder1.delete(min);
            // op2' doesn't need this range anymore (it's been deleted by op1)
            c1 = -c1 - min > 0 ? -((-c1) - min) : op1[++i1];
            c2 = c2 - min > 0 ? c2 - min : op2[++i2];
        }
        // op1 retain, op2 delete
        else if (isRetain(c1) && isDelete(c2)) {
            const min = Math.min(c1, -c2);
            // op1' doesn't need this range anymore (it's been deleted by op2)
            builder2.delete(min);
            c1 = c1 - min > 0 ? c1 - min : op1[++i1];
            c2 = -c2 - min > 0 ? -((-c2) - min) : op2[++i2];
        }
        else {
            throw new Error(`transform: unexpected component pair: ${JSON.stringify(c1)}, ${JSON.stringify(c2)}`);
        }
    }

    return [builder1.build(), builder2.build()];
}

/**
 * Create an operation from a simple text diff.
 * Given oldText and newText, computes the minimal OT operation
 * based on the first and last differing character positions.
 */
export function diffToOp(oldText, newText) {
    if (oldText === newText) return [];

    // Find common prefix
    let prefixLen = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
        prefixLen++;
    }

    // Find common suffix (not overlapping with prefix)
    let suffixLen = 0;
    while (
        suffixLen < (oldText.length - prefixLen) &&
        suffixLen < (newText.length - prefixLen) &&
        oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const deletedLen = oldText.length - prefixLen - suffixLen;
    const insertedStr = newText.slice(prefixLen, newText.length - suffixLen);

    const builder = new OpBuilder();
    builder.retain(prefixLen);
    if (deletedLen > 0) builder.delete(deletedLen);
    if (insertedStr.length > 0) builder.insert(insertedStr);
    builder.retain(suffixLen);
    return builder.build();
}
