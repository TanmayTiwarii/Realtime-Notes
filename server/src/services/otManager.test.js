/**
 * Integration tests for OT Session Manager.
 *
 * These tests mock the database layer and test the full
 * OT pipeline: session init, multi-client op submission,
 * concurrent convergence, and session lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock mongoose Note model before importing otManager
vi.mock('../models/Note.js', () => {
    return {
        default: {
            findById: vi.fn(() => ({
                select: vi.fn(() => ({
                    lean: vi.fn(() => Promise.resolve({ content: '' }))
                }))
            })),
            updateOne: vi.fn(() => Promise.resolve({ matchedCount: 1 }))
        }
    };
});

import {
    initSession,
    getDocument,
    receiveOp,
    removeClient,
    destroySession,
    _resetAll
} from './otManager.js';
import Note from '../models/Note.js';
import { apply, transform, diffToOp } from './ot.js';

beforeEach(() => {
    _resetAll();
    vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// 1. SESSION LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe('session lifecycle', () => {
    it('initializes a new session from DB content', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello world' }))
            }))
        });

        const result = await initSession('note-1', 'socket-a');
        expect(result.document).toBe('hello world');
        expect(result.revision).toBe(0);
    });

    it('second client joining gets the same state (idempotent)', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello' }))
            }))
        });

        const r1 = await initSession('note-1', 'socket-a');
        const r2 = await initSession('note-1', 'socket-b');

        expect(r1.document).toBe(r2.document);
        expect(r1.revision).toBe(r2.revision);
    });

    it('returns current document state via getDocument', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'test' }))
            }))
        });

        await initSession('note-1', 'socket-a');
        const state = getDocument('note-1');
        expect(state).not.toBeNull();
        expect(state.document).toBe('test');
        expect(state.revision).toBe(0);
    });

    it('getDocument returns null for non-existent session', () => {
        expect(getDocument('nonexistent')).toBeNull();
    });

    it('destroys session when last client leaves', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'test' }))
            }))
        });

        await initSession('note-1', 'socket-a');
        await removeClient('note-1', 'socket-a');
        expect(getDocument('note-1')).toBeNull();
    });

    it('session persists when one of two clients leaves', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'test' }))
            }))
        });

        await initSession('note-1', 'socket-a');
        await initSession('note-1', 'socket-b');
        await removeClient('note-1', 'socket-a');
        expect(getDocument('note-1')).not.toBeNull();
    });

    it('destroySession forcefully removes session', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'test' }))
            }))
        });

        await initSession('note-1', 'socket-a');
        destroySession('note-1');
        expect(getDocument('note-1')).toBeNull();
    });

    it('handles empty content from DB gracefully', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: '' }))
            }))
        });

        const result = await initSession('note-1', 'socket-a');
        expect(result.document).toBe('');
        expect(result.revision).toBe(0);
    });

    it('handles null note from DB gracefully', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve(null))
            }))
        });

        const result = await initSession('note-1', 'socket-a');
        expect(result.document).toBe('');
        expect(result.revision).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════
// 2. SEQUENTIAL OPS FROM ONE CLIENT
// ═══════════════════════════════════════════════════════════════

describe('sequential ops from one client', () => {
    beforeEach(async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello' }))
            }))
        });
        await initSession('note-1', 'socket-a');
    });

    it('applies a single insert op', () => {
        const op = diffToOp('hello', 'hello world');
        const result = receiveOp('note-1', 0, op);

        expect(result.ok).toBe(true);
        expect(result.revision).toBe(1);
        expect(getDocument('note-1').document).toBe('hello world');
    });

    it('applies sequential ops incrementing revision', () => {
        const op1 = diffToOp('hello', 'hello world');
        const r1 = receiveOp('note-1', 0, op1);
        expect(r1.ok).toBe(true);
        expect(r1.revision).toBe(1);

        const op2 = diffToOp('hello world', 'hello beautiful world');
        const r2 = receiveOp('note-1', 1, op2);
        expect(r2.ok).toBe(true);
        expect(r2.revision).toBe(2);

        expect(getDocument('note-1').document).toBe('hello beautiful world');
    });

    it('applies a delete op', () => {
        const op = diffToOp('hello', 'hllo');
        const result = receiveOp('note-1', 0, op);

        expect(result.ok).toBe(true);
        expect(getDocument('note-1').document).toBe('hllo');
    });

    it('applies a replace op', () => {
        const op = diffToOp('hello', 'hi');
        const result = receiveOp('note-1', 0, op);

        expect(result.ok).toBe(true);
        expect(getDocument('note-1').document).toBe('hi');
    });

    it('applies op that clears the document', () => {
        const op = diffToOp('hello', '');
        const result = receiveOp('note-1', 0, op);

        expect(result.ok).toBe(true);
        expect(getDocument('note-1').document).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════
// 3. CONCURRENT OPS FROM TWO CLIENTS
// ═══════════════════════════════════════════════════════════════

describe('concurrent ops from two clients', () => {
    beforeEach(async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello world' }))
            }))
        });
        await initSession('note-1', 'socket-a');
        await initSession('note-1', 'socket-b');
    });

    it('handles two clients submitting ops sequentially', () => {
        const opA = diffToOp('hello world', 'hello beautiful world');
        const rA = receiveOp('note-1', 0, opA);
        expect(rA.ok).toBe(true);

        // Client B now at rev 1, submits based on rev 1
        const docAfterA = 'hello beautiful world';
        const opB = diffToOp(docAfterA, 'hello beautiful world!');
        const rB = receiveOp('note-1', 1, opB);
        expect(rB.ok).toBe(true);

        expect(getDocument('note-1').document).toBe('hello beautiful world!');
    });

    it('handles two clients with concurrent ops (same base revision)', () => {
        // Both clients submit ops based on revision 0
        const opA = diffToOp('hello world', 'hello beautiful world');
        const opB = diffToOp('hello world', 'hello world!');

        // A goes first
        const rA = receiveOp('note-1', 0, opA);
        expect(rA.ok).toBe(true);
        expect(rA.revision).toBe(1);

        // B submits with rev 0, server transforms against A
        const rB = receiveOp('note-1', 0, opB);
        expect(rB.ok).toBe(true);
        expect(rB.revision).toBe(2);

        // Both modifications should be present
        expect(getDocument('note-1').document).toBe('hello beautiful world!');
    });

    it('handles concurrent inserts at the same position', () => {
        const opA = diffToOp('hello world', 'hello X world');
        const opB = diffToOp('hello world', 'hello Y world');

        const rA = receiveOp('note-1', 0, opA);
        expect(rA.ok).toBe(true);

        const rB = receiveOp('note-1', 0, opB);
        expect(rB.ok).toBe(true);

        const doc = getDocument('note-1').document;
        // Both X and Y should be present (exact order depends on transform priority)
        expect(doc).toContain('X');
        expect(doc).toContain('Y');
    });

    it('handles concurrent deletes of the same text', () => {
        const opA = diffToOp('hello world', 'hello');
        const opB = diffToOp('hello world', 'hello');

        const rA = receiveOp('note-1', 0, opA);
        expect(rA.ok).toBe(true);

        const rB = receiveOp('note-1', 0, opB);
        expect(rB.ok).toBe(true);

        expect(getDocument('note-1').document).toBe('hello');
    });

    it('handles one insert, one delete of different sections', () => {
        const opA = diffToOp('hello world', 'hello beautiful world'); // insert in middle
        const opB = diffToOp('hello world', 'hello worl');            // delete last char

        const rA = receiveOp('note-1', 0, opA);
        expect(rA.ok).toBe(true);

        const rB = receiveOp('note-1', 0, opB);
        expect(rB.ok).toBe(true);

        expect(getDocument('note-1').document).toBe('hello beautiful worl');
    });

    it('handles three concurrent ops from three clients', async () => {
        await initSession('note-1', 'socket-c');

        const opA = diffToOp('hello world', 'HELLO world');
        const opB = diffToOp('hello world', 'hello WORLD');
        const opC = diffToOp('hello world', 'hello world!');

        receiveOp('note-1', 0, opA);
        receiveOp('note-1', 0, opB);
        receiveOp('note-1', 0, opC);

        const doc = getDocument('note-1').document;
        expect(doc).toContain('HELLO');
        expect(doc).toContain('WORLD');
        expect(doc).toContain('!');
    });
});

// ═══════════════════════════════════════════════════════════════
// 4. ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

describe('error handling', () => {
    it('rejects op for non-existent session', () => {
        const result = receiveOp('nonexistent', 0, ['x']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('No active session');
    });

    it('rejects op with future revision', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello' }))
            }))
        });
        await initSession('note-1', 'socket-a');

        const result = receiveOp('note-1', 99, ['hello']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('ahead of server');
    });

    it('rejects op with negative revision', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello' }))
            }))
        });
        await initSession('note-1', 'socket-a');

        const result = receiveOp('note-1', -1, ['hello']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Invalid client revision');
    });

    it('rejects op with wrong input length', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'hello' }))
            }))
        });
        await initSession('note-1', 'socket-a');

        // Op that expects 10-char doc but doc is 5 chars
        const result = receiveOp('note-1', 0, [10, 'x']);
        expect(result.ok).toBe(false);
    });

    it('removeClient is safe for non-existent session', async () => {
        // Should not throw
        await removeClient('nonexistent', 'socket-a');
    });

    it('destroySession is safe for non-existent session', () => {
        // Should not throw
        destroySession('nonexistent');
    });
});

// ═══════════════════════════════════════════════════════════════
// 5. MULTI-OP CONVERGENCE SIMULATION
// ═══════════════════════════════════════════════════════════════

describe('multi-op convergence simulation', () => {
    it('simulates a realistic editing session with interleaved ops', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: '' }))
            }))
        });
        await initSession('note-1', 'socket-a');
        await initSession('note-1', 'socket-b');

        // Client A types "Hello"
        let clientADoc = '';
        let clientAOp = diffToOp(clientADoc, 'Hello');
        let rA = receiveOp('note-1', 0, clientAOp);
        expect(rA.ok).toBe(true);
        clientADoc = 'Hello';

        // Client B hasn't received A's op yet, types "World" based on rev 0
        let clientBDoc = '';
        let clientBOp = diffToOp(clientBDoc, 'World');
        let rB = receiveOp('note-1', 0, clientBOp);
        expect(rB.ok).toBe(true);

        // Server should have both
        const serverDoc = getDocument('note-1').document;
        expect(serverDoc).toContain('Hello');
        expect(serverDoc).toContain('World');

        // Client A (now at rev 2 after receiving B's transformed op) adds " "
        // Client A applies the transformed B op to get to server state
        const [, bPrime] = transform(clientAOp, clientBOp);
        clientADoc = apply(clientADoc, bPrime);

        // Actually let's just use the server document
        clientADoc = serverDoc;
        const spaceOp = diffToOp(clientADoc, clientADoc + ' ');
        let rA2 = receiveOp('note-1', 2, spaceOp);
        expect(rA2.ok).toBe(true);

        expect(getDocument('note-1').document).toBe(serverDoc + ' ');
    });

    it('handles rapid-fire ops from multiple clients', async () => {
        Note.findById.mockReturnValue({
            select: vi.fn(() => ({
                lean: vi.fn(() => Promise.resolve({ content: 'start' }))
            }))
        });
        await initSession('note-1', 'socket-a');
        await initSession('note-1', 'socket-b');

        // Rapid ops from A
        receiveOp('note-1', 0, diffToOp('start', 'start1'));
        receiveOp('note-1', 1, diffToOp('start1', 'start12'));
        receiveOp('note-1', 2, diffToOp('start12', 'start123'));

        // B submits based on rev 0 (hasn't seen any of A's ops)
        const rB = receiveOp('note-1', 0, diffToOp('start', 'Xstart'));
        expect(rB.ok).toBe(true);

        const doc = getDocument('note-1').document;
        expect(doc).toContain('X');
        expect(doc).toContain('start');
        expect(doc).toContain('123');
    });
});
