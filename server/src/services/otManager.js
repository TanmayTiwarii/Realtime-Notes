/**
 * OT Session Manager — manages per-note OT state.
 *
 * Each note with active editors gets an in-memory session containing:
 *   - document: the current canonical text
 *   - revision: monotonically increasing version counter
 *   - history: array of ops applied since session start (indexed by revision)
 *   - saveTimer: debounced DB persistence timer
 *   - clients: Set of socket IDs in the room
 */

import { transform, apply, opLengths } from './ot.js';
import Note from '../models/Note.js';

const SAVE_DEBOUNCE_MS = 5000; // Persist to DB 5s after last edit

/** @type {Map<string, { document: string, revision: number, history: Array, saveTimer: any, clients: Set<string> }>} */
const sessions = new Map();

// ── Public API ──────────────────────────────────────────────────

/**
 * Initialize (or join) an OT session for a note.
 * If the session already exists, this is a no-op (idempotent).
 * Returns { document, revision }.
 */
export async function initSession(noteId, socketId) {
    let session = sessions.get(noteId);

    if (!session) {
        // Load from DB
        const note = await Note.findById(noteId).select('content').lean();
        const content = note?.content || '';

        session = {
            document: content,
            revision: 0,
            history: [],
            saveTimer: null,
            clients: new Set()
        };
        sessions.set(noteId, session);
        console.log(`[OT] Session created for note ${noteId} (${content.length} chars)`);
    }

    session.clients.add(socketId);

    return {
        document: session.document,
        revision: session.revision
    };
}

/**
 * Get the current document state for a note.
 * Returns { document, revision } or null if no active session.
 */
export function getDocument(noteId) {
    const session = sessions.get(noteId);
    if (!session) return null;
    return {
        document: session.document,
        revision: session.revision
    };
}

/**
 * Receive an operation from a client.
 *
 * @param {string} noteId
 * @param {number} clientRevision - The revision the client's op is based on
 * @param {Array} op - The OT operation
 * @returns {{ ok: true, op: Array, revision: number } | { ok: false, error: string }}
 */
export function receiveOp(noteId, clientRevision, op) {
    const session = sessions.get(noteId);

    if (!session) {
        return { ok: false, error: 'No active session for this note' };
    }

    if (typeof clientRevision !== 'number' || clientRevision < 0) {
        return { ok: false, error: `Invalid client revision: ${clientRevision}` };
    }

    if (clientRevision > session.revision) {
        return { ok: false, error: `Client revision ${clientRevision} is ahead of server revision ${session.revision}` };
    }

    // Validate op spans the document at clientRevision
    // We need to transform it forward through history[clientRevision..] first
    let transformedOp = op;

    try {
        // Transform against all ops the client hasn't seen
        for (let i = clientRevision; i < session.revision; i++) {
            const serverOp = session.history[i];
            const [, opPrime] = transform(serverOp, transformedOp);
            transformedOp = opPrime;
        }

        // Validate the transformed op spans the current document
        const { inputLen } = opLengths(transformedOp);
        if (inputLen !== session.document.length) {
            return {
                ok: false,
                error: `Op input length (${inputLen}) does not match document length (${session.document.length})`
            };
        }

        // Apply to the server document
        session.document = apply(session.document, transformedOp);
        session.history.push(transformedOp);
        session.revision++;

        // Schedule debounced DB save
        scheduleSave(noteId);

        return {
            ok: true,
            op: transformedOp,
            revision: session.revision
        };
    } catch (err) {
        console.error(`[OT] Error processing op for note ${noteId}:`, err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Remove a client from a session. If the session has no more clients,
 * persist to DB and destroy the session.
 */
export async function removeClient(noteId, socketId) {
    const session = sessions.get(noteId);
    if (!session) return;

    session.clients.delete(socketId);

    if (session.clients.size === 0) {
        // Final save before cleanup
        await persistToDb(noteId);
        if (session.saveTimer) clearTimeout(session.saveTimer);
        sessions.delete(noteId);
        console.log(`[OT] Session destroyed for note ${noteId}`);
    }
}

/**
 * Get all active session note IDs (for diagnostics).
 */
export function getActiveSessions() {
    return [...sessions.keys()];
}

/**
 * Destroy a session immediately (for testing).
 */
export function destroySession(noteId) {
    const session = sessions.get(noteId);
    if (session) {
        if (session.saveTimer) clearTimeout(session.saveTimer);
        sessions.delete(noteId);
    }
}

/**
 * Reset all sessions (for testing only).
 */
export function _resetAll() {
    for (const [noteId, session] of sessions) {
        if (session.saveTimer) clearTimeout(session.saveTimer);
    }
    sessions.clear();
}

// ── Internal ────────────────────────────────────────────────────

function scheduleSave(noteId) {
    const session = sessions.get(noteId);
    if (!session) return;

    if (session.saveTimer) clearTimeout(session.saveTimer);
    session.saveTimer = setTimeout(() => persistToDb(noteId), SAVE_DEBOUNCE_MS);
}

async function persistToDb(noteId) {
    const session = sessions.get(noteId);
    if (!session) return;

    try {
        await Note.updateOne(
            { _id: noteId },
            { $set: { content: session.document } }
        );
        console.log(`[OT] Persisted note ${noteId} (rev ${session.revision})`);
    } catch (err) {
        console.error(`[OT] DB persist failed for note ${noteId}:`, err.message);
    }
}
