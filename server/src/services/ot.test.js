/**
 * Comprehensive test suite for the OT engine.
 *
 * Tests cover:
 *  1. Basic apply operations (insert, delete, retain)
 *  2. Compose correctness
 *  3. Transform correctness + convergence property
 *  4. Edge cases (empty docs, boundary ops, overlapping deletes, etc.)
 *  5. diffToOp correctness
 */

import { describe, it, expect } from 'vitest';
import {
    apply,
    compose,
    transform,
    diffToOp,
    opLengths,
    isNoop,
    retain,
    insert,
    del,
    isRetain,
    isInsert,
    isDelete
} from './ot.js';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Assert the convergence property:
 *   apply(apply(doc, a), b') === apply(apply(doc, b), a')
 * where [a', b'] = transform(a, b)
 */
function assertConvergence(doc, opA, opB) {
    const [aPrime, bPrime] = transform(opA, opB);

    const docAfterA = apply(doc, opA);
    const docAfterAThenBPrime = apply(docAfterA, bPrime);

    const docAfterB = apply(doc, opB);
    const docAfterBThenAPrime = apply(docAfterB, aPrime);

    expect(docAfterAThenBPrime).toBe(docAfterBThenAPrime);
    return docAfterAThenBPrime;
}

// ═══════════════════════════════════════════════════════════════
// 1. TYPE CHECKS & BUILDERS
// ═══════════════════════════════════════════════════════════════

describe('Type checks and builders', () => {
    it('retain() creates a positive integer', () => {
        expect(retain(5)).toBe(5);
        expect(isRetain(retain(5))).toBe(true);
    });

    it('insert() creates a string', () => {
        expect(insert('hello')).toBe('hello');
        expect(isInsert(insert('hello'))).toBe(true);
    });

    it('del() creates a negative integer', () => {
        expect(del(3)).toBe(-3);
        expect(isDelete(del(3))).toBe(true);
    });

    it('retain() rejects non-positive values', () => {
        expect(() => retain(0)).toThrow();
        expect(() => retain(-1)).toThrow();
        expect(() => retain(1.5)).toThrow();
    });

    it('insert() rejects empty strings', () => {
        expect(() => insert('')).toThrow();
    });

    it('del() rejects non-positive values', () => {
        expect(() => del(0)).toThrow();
        expect(() => del(-1)).toThrow();
    });
});

// ═══════════════════════════════════════════════════════════════
// 2. opLengths & isNoop
// ═══════════════════════════════════════════════════════════════

describe('opLengths', () => {
    it('computes lengths for retain-only op', () => {
        const { inputLen, outputLen } = opLengths([10]);
        expect(inputLen).toBe(10);
        expect(outputLen).toBe(10);
    });

    it('computes lengths for insert', () => {
        const { inputLen, outputLen } = opLengths(['hello']);
        expect(inputLen).toBe(0);
        expect(outputLen).toBe(5);
    });

    it('computes lengths for delete', () => {
        const { inputLen, outputLen } = opLengths([-3]);
        expect(inputLen).toBe(3);
        expect(outputLen).toBe(0);
    });

    it('computes lengths for mixed op', () => {
        // retain(3), insert("ab"), delete(2), retain(5)
        const { inputLen, outputLen } = opLengths([3, 'ab', -2, 5]);
        expect(inputLen).toBe(10);  // 3 + 2 + 5
        expect(outputLen).toBe(10); // 3 + 2 + 5
    });

    it('empty op has zero lengths', () => {
        const { inputLen, outputLen } = opLengths([]);
        expect(inputLen).toBe(0);
        expect(outputLen).toBe(0);
    });
});

describe('isNoop', () => {
    it('empty op is noop', () => {
        expect(isNoop([])).toBe(true);
    });

    it('retain-only op is noop', () => {
        expect(isNoop([10])).toBe(true);
    });

    it('op with insert is not noop', () => {
        expect(isNoop([3, 'x', 2])).toBe(false);
    });

    it('op with delete is not noop', () => {
        expect(isNoop([3, -1, 2])).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════
// 3. APPLY
// ═══════════════════════════════════════════════════════════════

describe('apply', () => {
    it('applies retain (identity)', () => {
        expect(apply('hello', [5])).toBe('hello');
    });

    it('applies empty op to empty doc', () => {
        expect(apply('', [])).toBe('');
    });

    it('inserts at the beginning', () => {
        expect(apply('world', ['hello ', 5])).toBe('hello world');
    });

    it('inserts at the end', () => {
        expect(apply('hello', [5, ' world'])).toBe('hello world');
    });

    it('inserts in the middle', () => {
        expect(apply('hllo', [1, 'e', 3])).toBe('hello');
    });

    it('deletes from the beginning', () => {
        expect(apply('hello world', [-6, 5])).toBe('world');
    });

    it('deletes from the end', () => {
        expect(apply('hello world', [5, -6])).toBe('hello');
    });

    it('deletes from the middle', () => {
        expect(apply('hello world', [5, -1, 5])).toBe('helloworld');
    });

    it('replaces text (delete + insert)', () => {
        // "hello" → "hi" by deleting "ello" and inserting "i"
        expect(apply('hello', [1, -4, 'i'])).toBe('hi');
    });

    it('inserts into empty document', () => {
        expect(apply('', ['hello'])).toBe('hello');
    });

    it('deletes entire document', () => {
        expect(apply('hello', [-5])).toBe('');
    });

    it('handles multi-byte-like characters', () => {
        expect(apply('ab', [1, '🎉', 1])).toBe('a🎉b');
    });

    it('throws on length mismatch', () => {
        expect(() => apply('hello', [10])).toThrow();
    });

    it('insert-only op at start must include trailing retain', () => {
        expect(apply('hello world', ['X', 11])).toBe('Xhello world');
    });

    it('complex multi-step operation', () => {
        // "abcdef" → retain 2, delete 1, insert "XY", retain 3
        // "ab" + skip "c" + "XY" + "def" = "abXYdef"
        expect(apply('abcdef', [2, -1, 'XY', 3])).toBe('abXYdef');
    });
});

// ═══════════════════════════════════════════════════════════════
// 4. COMPOSE
// ═══════════════════════════════════════════════════════════════

describe('compose', () => {
    it('composes two retains (identity)', () => {
        const doc = 'hello';
        const op1 = [5]; // retain all
        const op2 = [5]; // retain all
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe(apply(apply(doc, op1), op2));
    });

    it('composes insert then retain', () => {
        const doc = 'world';
        const op1 = ['hello ', 5]; // "hello world"
        const op2 = [11];          // retain "hello world"
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('hello world');
    });

    it('composes delete then nothing', () => {
        const doc = 'hello world';
        const op1 = [-6, 5]; // "world"
        const op2 = [5];     // retain "world"
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('world');
    });

    it('composes insert then delete (cancel out)', () => {
        const doc = 'ab';
        const op1 = [1, 'X', 1];  // "aXb" (3 chars)
        const op2 = [1, -1, 1];   // delete "X" → "ab"
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('ab');
    });

    it('composes two inserts at different positions', () => {
        const doc = 'abc';
        const op1 = [1, 'X', 2];   // "aXbc" (4 chars)
        const op2 = [3, 'Y', 1];   // "aXbYc" (5 chars)
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('aXbYc');
    });

    it('composes sequential deletes', () => {
        const doc = 'abcde';
        const op1 = [1, -1, 3];   // delete 'b' → "acde"
        const op2 = [2, -1, 1];   // delete 'd' → "ace"
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('ace');
    });

    it('composes insert then partial delete of insertion', () => {
        const doc = 'ab';
        const op1 = [1, 'XYZ', 1]; // "aXYZb" (5 chars)
        const op2 = [2, -2, 1];    // delete "YZ" → "aXb"
        const composed = compose(op1, op2);
        expect(apply(doc, composed)).toBe('aXb');
    });

    it('throws on length mismatch', () => {
        expect(() => compose(['hello'], [3])).toThrow();
    });

    it('composes with empty ops', () => {
        const doc = 'hello';
        const op1 = []; // noop on empty doc? No — empty op spans 0-length doc
        const op2 = [];
        const composed = compose(op1, op2);
        expect(apply('', composed)).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════
// 5. TRANSFORM — BASIC CASES
// ═══════════════════════════════════════════════════════════════

describe('transform — basic cases', () => {
    it('transforms two retains (identity)', () => {
        const doc = 'hello';
        const opA = [5];
        const opB = [5];
        assertConvergence(doc, opA, opB);
    });

    it('transforms two inserts at same position (left priority)', () => {
        const doc = 'ab';
        const opA = [1, 'X', 1]; // insert X at pos 1
        const opB = [1, 'Y', 1]; // insert Y at pos 1
        const result = assertConvergence(doc, opA, opB);
        // Left priority: A's insert comes first → "aXYb"
        expect(result).toBe('aXYb');
    });

    it('transforms two inserts at different positions', () => {
        const doc = 'abc';
        const opA = [1, 'X', 2]; // insert X at pos 1
        const opB = [2, 'Y', 1]; // insert Y at pos 2
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('aXbYc');
    });

    it('transforms insert vs delete at same position', () => {
        const doc = 'abc';
        const opA = [1, 'X', 2]; // insert X at pos 1
        const opB = [1, -1, 1];  // delete 'b' at pos 1
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('aXc');
    });

    it('transforms delete vs insert at same position', () => {
        const doc = 'abc';
        const opA = [1, -1, 1];  // delete 'b'
        const opB = [1, 'X', 2]; // insert X at pos 1
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('aXc');
    });

    it('transforms two identical deletes', () => {
        const doc = 'abc';
        const opA = [1, -1, 1]; // delete 'b'
        const opB = [1, -1, 1]; // delete 'b'
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('ac');
    });

    it('transforms two non-overlapping deletes', () => {
        const doc = 'abcde';
        const opA = [1, -1, 3]; // delete 'b'
        const opB = [3, -1, 1]; // delete 'd'
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('ace');
    });

    it('transforms overlapping deletes', () => {
        const doc = 'abcde';
        const opA = [1, -3, 1]; // delete 'bcd'
        const opB = [2, -2, 1]; // delete 'cd'
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('ae');
    });

    it('transforms delete all vs insert at beginning', () => {
        const doc = 'abc';
        const opA = [-3];        // delete entire doc
        const opB = ['X', 3];    // insert X at beginning
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('X');
    });

    it('transforms insert at end vs delete at beginning', () => {
        const doc = 'abc';
        const opA = [3, 'X'];   // insert X at end
        const opB = [-1, 2];    // delete 'a'
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('bcX');
    });
});

// ═══════════════════════════════════════════════════════════════
// 6. TRANSFORM — CONVERGENCE PROPERTY (SYSTEMATIC)
// ═══════════════════════════════════════════════════════════════

describe('transform — convergence property', () => {
    const testCases = [
        {
            name: 'both insert at start of doc',
            doc: 'hello',
            opA: ['A', 5],
            opB: ['B', 5]
        },
        {
            name: 'both insert at end of doc',
            doc: 'hello',
            opA: [5, 'A'],
            opB: [5, 'B']
        },
        {
            name: 'insert multi-char strings',
            doc: 'ab',
            opA: ['FOO', 2],
            opB: [2, 'BAR']
        },
        {
            name: 'delete first char vs delete last char',
            doc: 'abcde',
            opA: [-1, 4],
            opB: [4, -1]
        },
        {
            name: 'delete entire doc vs delete entire doc',
            doc: 'hello',
            opA: [-5],
            opB: [-5]
        },
        {
            name: 'replace first char vs replace last char',
            doc: 'abc',
            opA: [-1, 'X', 2],
            opB: [2, -1, 'Y']
        },
        {
            name: 'insert into empty doc (both)',
            doc: '',
            opA: ['A'],
            opB: ['B']
        },
        {
            name: 'one noop vs one insert',
            doc: 'abc',
            opA: [3],
            opB: [1, 'X', 2]
        },
        {
            name: 'complex multi-component ops',
            doc: 'abcdef',
            opA: [2, -1, 'X', 3],  // "abXdef"... no, "ab" + skip c + "X" + "def" = "abXdef"
            opB: [4, -1, 'Y', 1]   // retain 4, delete 1 ('e'), insert Y, retain 1 ('f') = "abcdYf"
        },
        {
            name: 'delete overlapping range then insert',
            doc: 'abcdef',
            opA: [1, -4, 'X', 1],  // "a" + skip "bcde" + "X" + "f" = "aXf"
            opB: [2, -2, 'Y', 2]   // "ab" + skip "cd" + "Y" + "ef" = "abYef"
        },
        {
            name: 'both replace the same character',
            doc: 'abc',
            opA: [1, -1, 'X', 1],  // "aXc"
            opB: [1, -1, 'Y', 1]   // "aYc"
        }
    ];

    for (const tc of testCases) {
        it(`converges: ${tc.name}`, () => {
            assertConvergence(tc.doc, tc.opA, tc.opB);
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// 7. TRANSFORM — EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe('transform — edge cases', () => {
    it('both ops are empty (empty document)', () => {
        const [aPrime, bPrime] = transform([], []);
        expect(aPrime).toEqual([]);
        expect(bPrime).toEqual([]);
    });

    it('one empty op, one insert on empty doc', () => {
        const opA = [];
        const opB = ['hello'];
        const [aPrime, bPrime] = transform(opA, opB);
        // aPrime should retain over B's insert
        expect(apply(apply('', opA), bPrime)).toBe(apply(apply('', opB), aPrime));
    });

    it('single-char document, both delete', () => {
        const doc = 'x';
        const opA = [-1];
        const opB = [-1];
        assertConvergence(doc, opA, opB);
    });

    it('single-char document, one inserts before, one inserts after', () => {
        const doc = 'x';
        const opA = ['A', 1];
        const opB = [1, 'B'];
        assertConvergence(doc, opA, opB);
    });

    it('long insert vs long delete', () => {
        const doc = 'abcdefghij';
        const opA = [10, 'KLMNOPQRST']; // append 10 chars
        const opB = [-10];               // delete all
        assertConvergence(doc, opA, opB);
    });

    it('adjacent deletes', () => {
        const doc = 'abcdef';
        const opA = [1, -2, 3];  // delete 'bc' → "adef"
        const opB = [3, -2, 1];  // delete 'de' → "abcf"
        assertConvergence(doc, opA, opB);
    });

    it('throws on input length mismatch', () => {
        expect(() => transform([5, 'x'], [3, 'y'])).toThrow();
    });
});

// ═══════════════════════════════════════════════════════════════
// 8. TRANSFORM + COMPOSE TOGETHER
// ═══════════════════════════════════════════════════════════════

describe('transform + compose integration', () => {
    it('compose after transform produces consistent results', () => {
        const doc = 'abcde';
        const opA = [2, 'X', 3];   // "abXcde"
        const opB = [3, -1, 1];    // "abce"

        const [aPrime, bPrime] = transform(opA, opB);

        // Path 1: apply A then B'
        const docA = apply(doc, opA);
        const composedAB = compose(opA, bPrime);
        expect(apply(doc, composedAB)).toBe(apply(docA, bPrime));

        // Path 2: apply B then A'
        const docB = apply(doc, opB);
        const composedBA = compose(opB, aPrime);
        expect(apply(doc, composedBA)).toBe(apply(docB, aPrime));

        // Both paths should converge
        expect(apply(doc, composedAB)).toBe(apply(doc, composedBA));
    });

    it('triple concurrent ops converge via sequential transforms', () => {
        const doc = 'abcde';
        const opA = [1, 'X', 4];    // insert X after 'a'
        const opB = [3, 'Y', 2];    // insert Y after 'c'
        const opC = [4, 'Z', 1];    // insert Z after 'd'

        // Transform A and B
        const [aPrime1, bPrime1] = transform(opA, opB);
        
        // A path: apply A, then transform C against A, then transform bPrime1 against cPrimeFromA
        const docAfterA = apply(doc, opA);
        
        // We'll use sequential transformation: first apply A+B' then transform C
        const docAfterABPrime = apply(docAfterA, bPrime1);
        
        // Transform C against A
        const [, cAfterA] = transform(opA, opC);
        // Transform cAfterA against bPrime1
        const [, cAfterAB] = transform(bPrime1, cAfterA);
        
        const finalViaABC = apply(docAfterABPrime, cAfterAB);

        // B path: apply B first
        const docAfterB = apply(doc, opB);
        const docAfterBAPrime = apply(docAfterB, aPrime1);
        
        // Transform C against B
        const [, cAfterB] = transform(opB, opC);
        // Transform cAfterB against aPrime1
        const [, cAfterBA] = transform(aPrime1, cAfterB);
        
        const finalViaBAC = apply(docAfterBAPrime, cAfterBA);

        expect(finalViaABC).toBe(finalViaBAC);
    });
});

// ═══════════════════════════════════════════════════════════════
// 9. diffToOp
// ═══════════════════════════════════════════════════════════════

describe('diffToOp', () => {
    it('returns empty op for identical strings', () => {
        expect(diffToOp('hello', 'hello')).toEqual([]);
    });

    it('detects insertion at beginning', () => {
        const op = diffToOp('world', 'hello world');
        expect(apply('world', op)).toBe('hello world');
    });

    it('detects insertion at end', () => {
        const op = diffToOp('hello', 'hello world');
        expect(apply('hello', op)).toBe('hello world');
    });

    it('detects insertion in middle', () => {
        const op = diffToOp('hllo', 'hello');
        expect(apply('hllo', op)).toBe('hello');
    });

    it('detects deletion at beginning', () => {
        const op = diffToOp('hello world', 'world');
        expect(apply('hello world', op)).toBe('world');
    });

    it('detects deletion at end', () => {
        const op = diffToOp('hello world', 'hello');
        expect(apply('hello world', op)).toBe('hello');
    });

    it('detects deletion in middle', () => {
        const op = diffToOp('hello world', 'helloworld');
        expect(apply('hello world', op)).toBe('helloworld');
    });

    it('detects replacement', () => {
        const op = diffToOp('hello', 'hi');
        expect(apply('hello', op)).toBe('hi');
    });

    it('handles empty → non-empty', () => {
        const op = diffToOp('', 'hello');
        expect(apply('', op)).toBe('hello');
    });

    it('handles non-empty → empty', () => {
        const op = diffToOp('hello', '');
        expect(apply('hello', op)).toBe('');
    });

    it('handles single char change', () => {
        const op = diffToOp('abc', 'axc');
        expect(apply('abc', op)).toBe('axc');
    });

    it('handles complex replacement in middle', () => {
        const op = diffToOp('the quick brown fox', 'the slow red fox');
        expect(apply('the quick brown fox', op)).toBe('the slow red fox');
    });

    it('produced ops can be transformed', () => {
        const doc = 'hello world';
        const opA = diffToOp(doc, 'hello beautiful world');
        const opB = diffToOp(doc, 'hello world!');
        assertConvergence(doc, opA, opB);
    });

    it('multiple diffToOp results compose correctly', () => {
        const doc1 = 'hello';
        const doc2 = 'hello world';
        const doc3 = 'hello beautiful world';

        const op1 = diffToOp(doc1, doc2);
        const op2 = diffToOp(doc2, doc3);

        const composed = compose(op1, op2);
        expect(apply(doc1, composed)).toBe(doc3);
    });
});

// ═══════════════════════════════════════════════════════════════
// 10. STRESS TESTS — RANDOM OPS
// ═══════════════════════════════════════════════════════════════

describe('stress tests — random concurrent ops', () => {
    function randomOp(docLen) {
        const builder = [];
        let remaining = docLen;
        let outputLen = 0;

        while (remaining > 0 || Math.random() < 0.3) {
            const r = Math.random();

            if (remaining > 0 && r < 0.4) {
                // Retain
                const n = Math.min(remaining, Math.floor(Math.random() * 5) + 1);
                builder.push(n);
                remaining -= n;
                outputLen += n;
            } else if (r < 0.7) {
                // Insert
                const chars = 'abcdefghijklmnop';
                const len = Math.floor(Math.random() * 4) + 1;
                let s = '';
                for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
                builder.push(s);
                outputLen += len;
            } else if (remaining > 0) {
                // Delete
                const n = Math.min(remaining, Math.floor(Math.random() * 3) + 1);
                builder.push(-n);
                remaining -= n;
            }

            // Safety: limit op size
            if (builder.length > 20) break;
        }

        // Retain any remaining
        if (remaining > 0) {
            builder.push(remaining);
        }

        return builder;
    }

    for (let i = 0; i < 50; i++) {
        it(`random convergence test #${i + 1}`, () => {
            const docLen = Math.floor(Math.random() * 20) + 1;
            const doc = 'abcdefghijklmnopqrst'.slice(0, docLen);
            const opA = randomOp(docLen);
            const opB = randomOp(docLen);

            // Should not throw and should converge
            assertConvergence(doc, opA, opB);
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// 11. REAL-WORLD EDITING SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe('real-world editing scenarios', () => {
    it('two users type at opposite ends of a paragraph', () => {
        const doc = 'The quick brown fox jumps over the lazy dog.';
        const opA = diffToOp(doc, 'Once upon a time, the quick brown fox jumps over the lazy dog.');
        const opB = diffToOp(doc, 'The quick brown fox jumps over the lazy dog. The end.');
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('Once upon a time, the quick brown fox jumps over the lazy dog. The end.');
    });

    it('one user inserts while another deletes a different section', () => {
        const doc = 'function hello() { return "world"; }';
        const opA = diffToOp(doc, 'function hello(name) { return "world"; }');
        const opB = diffToOp(doc, 'function hello() { return ""; }');
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('function hello(name) { return ""; }');
    });

    it('both users add newlines in different places', () => {
        const doc = 'line1\nline2\nline3';
        const opA = diffToOp(doc, 'line1\nnewA\nline2\nline3');
        const opB = diffToOp(doc, 'line1\nline2\nnewB\nline3');
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('line1\nnewA\nline2\nnewB\nline3');
    });

    it('both users delete the same word', () => {
        const doc = 'hello beautiful world';
        const opA = diffToOp(doc, 'hello world');
        const opB = diffToOp(doc, 'hello world');
        const result = assertConvergence(doc, opA, opB);
        expect(result).toBe('hello world');
    });

    it('user replaces a word while another deletes it', () => {
        const doc = 'the old cat';
        const opA = diffToOp(doc, 'the new cat');
        const opB = diffToOp(doc, 'the cat');
        assertConvergence(doc, opA, opB);
        // Both paths should converge (exact result depends on transform priority)
    });

    it('rapid sequential typing simulation', () => {
        let doc = '';
        const ops = [];
        const chars = 'Hello, World!';
        
        for (const ch of chars) {
            const newDoc = doc + ch;
            const op = diffToOp(doc, newDoc);
            ops.push(op);
            doc = newDoc;
        }

        // Compose all ops
        let composed = ops[0];
        for (let i = 1; i < ops.length; i++) {
            composed = compose(composed, ops[i]);
        }

        expect(apply('', composed)).toBe('Hello, World!');
    });
});
