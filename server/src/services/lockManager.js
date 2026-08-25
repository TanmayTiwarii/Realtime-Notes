/**
 * In-memory per-note write-lock manager.
 *
 * Lock map: Map<noteId, { socketId, userId, userEmail, lockedAt, lastHeartbeat }>
 *
 * - Only one client may hold the write lock for a given note at any time.
 * - Stale locks (no heartbeat for STALE_TIMEOUT_MS) are swept automatically.
 * - On sweep-release, the registered onStaleLockReleased callback fires so the
 *   socket layer can broadcast `note-unlocked`.
 */

const STALE_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes
const SWEEP_INTERVAL_MS = 30 * 1000;       // check every 30 s

/** @type {Map<string, { socketId: string, userId: string, userEmail: string, lockedAt: number, lastHeartbeat: number }>} */
const locks = new Map();

/** @type {((noteId: string, holder: object) => void) | null} */
let onStaleLockReleased = null;

// ── public API ──────────────────────────────────────────────────

/**
 * Register a callback invoked when a stale lock is auto-released.
 * Signature: (noteId, holder) => void
 */
export function onStaleRelease(cb) {
    onStaleLockReleased = cb;
}

/**
 * Attempt to acquire the write lock for `noteId`.
 * @returns {{ granted: boolean, holder?: { userEmail: string, userId: string } }}
 */
export function acquireLock(noteId, socketId, userId, userEmail) {
    const existing = locks.get(noteId);

    if (existing) {
        // Same socket re-requesting — idempotent grant
        if (existing.socketId === socketId) {
            existing.lastHeartbeat = Date.now();
            return { granted: true };
        }
        // Someone else holds it
        return {
            granted: false,
            holder: { userEmail: existing.userEmail, userId: existing.userId }
        };
    }

    const now = Date.now();
    locks.set(noteId, {
        socketId,
        userId,
        userEmail,
        lockedAt: now,
        lastHeartbeat: now
    });

    return { granted: true };
}

/**
 * Release the lock for `noteId` only if `socketId` is the current holder.
 * @returns {boolean} true if a lock was actually released.
 */
export function releaseLock(noteId, socketId) {
    const existing = locks.get(noteId);
    if (existing && existing.socketId === socketId) {
        locks.delete(noteId);
        return true;
    }
    return false;
}

/**
 * Check whether `socketId` currently holds the write lock for `noteId`.
 */
export function isLockHolder(noteId, socketId) {
    const existing = locks.get(noteId);
    return existing ? existing.socketId === socketId : false;
}

/**
 * Push the heartbeat timestamp forward (keeps the lock alive).
 * @returns {boolean} true if the renewal succeeded (caller is the holder).
 */
export function renewLock(noteId, socketId) {
    const existing = locks.get(noteId);
    if (existing && existing.socketId === socketId) {
        existing.lastHeartbeat = Date.now();
        return true;
    }
    return false;
}

/**
 * Release every lock held by `socketId` (called on disconnect).
 * @returns {string[]} List of noteIds whose locks were released.
 */
export function releaseAllForSocket(socketId) {
    const released = [];
    for (const [noteId, entry] of locks) {
        if (entry.socketId === socketId) {
            locks.delete(noteId);
            released.push(noteId);
        }
    }
    return released;
}

/**
 * Get the current lock holder info for a note, or null if unlocked.
 */
export function getLockInfo(noteId) {
    const existing = locks.get(noteId);
    if (!existing) return null;
    return {
        userEmail: existing.userEmail,
        userId: existing.userId,
        socketId: existing.socketId
    };
}

// ── stale-lock sweeper ──────────────────────────────────────────

setInterval(() => {
    const now = Date.now();
    for (const [noteId, entry] of locks) {
        if (now - entry.lastHeartbeat > STALE_TIMEOUT_MS) {
            console.log(`[LockManager] Stale lock released for note ${noteId} (holder: ${entry.userEmail})`);
            locks.delete(noteId);
            if (onStaleLockReleased) {
                onStaleLockReleased(noteId, {
                    userEmail: entry.userEmail,
                    userId: entry.userId,
                    socketId: entry.socketId
                });
            }
        }
    }
}, SWEEP_INTERVAL_MS);
