import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import api from '../services/api';
import { Save, Share2, ArrowLeft, X, MessageSquare, Send, Pencil, Eraser, RotateCcw, Trash2 } from 'lucide-react';

// ── Lightweight OT helpers (client-side, mirrors server ot.js) ──

function isRetain(c) { return typeof c === 'number' && c > 0; }
function isInsert(c) { return typeof c === 'string'; }
function isDelete(c) { return typeof c === 'number' && c < 0; }

function opLengths(op) {
    let inputLen = 0, outputLen = 0;
    for (const c of op) {
        if (isRetain(c)) { inputLen += c; outputLen += c; }
        else if (isInsert(c)) { outputLen += c.length; }
        else if (isDelete(c)) { inputLen += -c; }
    }
    return { inputLen, outputLen };
}

class OpBuilder {
    constructor() { this.ops = []; }
    retain(n) {
        if (n <= 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isRetain(last)) this.ops[this.ops.length - 1] = last + n;
        else this.ops.push(n);
    }
    insert(s) {
        if (!s || s.length === 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isInsert(last)) this.ops[this.ops.length - 1] = last + s;
        else this.ops.push(s);
    }
    delete(n) {
        if (n <= 0) return;
        const last = this.ops[this.ops.length - 1];
        if (isDelete(last)) this.ops[this.ops.length - 1] = last - n;
        else this.ops.push(-n);
    }
    build() {
        return [...this.ops];
    }
}

function applyOp(doc, op) {
    let result = '', pos = 0;
    for (const c of op) {
        if (isRetain(c)) { result += doc.slice(pos, pos + c); pos += c; }
        else if (isInsert(c)) { result += c; }
        else if (isDelete(c)) { pos += -c; }
    }
    result += doc.slice(pos);
    return result;
}

function transformOps(op1, op2) {
    const b1 = new OpBuilder(), b2 = new OpBuilder();
    let i1 = 0, i2 = 0, c1 = op1[i1], c2 = op2[i2];
    while (i1 < op1.length || i2 < op2.length) {
        if (c1 === undefined && c2 === undefined) break;
        if (isInsert(c1)) { b1.insert(c1); b2.retain(c1.length); i1++; c1 = op1[i1]; continue; }
        if (isInsert(c2)) { b1.retain(c2.length); b2.insert(c2); i2++; c2 = op2[i2]; continue; }
        if (c1 === undefined || c2 === undefined) break;
        if (isRetain(c1) && isRetain(c2)) {
            const m = Math.min(c1, c2); b1.retain(m); b2.retain(m);
            c1 = c1 - m > 0 ? c1 - m : op1[++i1]; c2 = c2 - m > 0 ? c2 - m : op2[++i2];
        } else if (isDelete(c1) && isDelete(c2)) {
            const m = Math.min(-c1, -c2);
            c1 = -c1 - m > 0 ? -((-c1) - m) : op1[++i1]; c2 = -c2 - m > 0 ? -((-c2) - m) : op2[++i2];
        } else if (isDelete(c1) && isRetain(c2)) {
            const m = Math.min(-c1, c2); b1.delete(m);
            c1 = -c1 - m > 0 ? -((-c1) - m) : op1[++i1]; c2 = c2 - m > 0 ? c2 - m : op2[++i2];
        } else if (isRetain(c1) && isDelete(c2)) {
            const m = Math.min(c1, -c2); b2.delete(m);
            c1 = c1 - m > 0 ? c1 - m : op1[++i1]; c2 = -c2 - m > 0 ? -((-c2) - m) : op2[++i2];
        } else break;
    }
    return [b1.build(), b2.build()];
}

function diffToOp(oldText, newText) {
    if (oldText === newText) return [];
    let prefixLen = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) prefixLen++;
    let suffixLen = 0;
    while (
        suffixLen < (oldText.length - prefixLen) &&
        suffixLen < (newText.length - prefixLen) &&
        oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) suffixLen++;
    const deletedLen = oldText.length - prefixLen - suffixLen;
    const insertedStr = newText.slice(prefixLen, newText.length - suffixLen);
    const b = new OpBuilder();
    b.retain(prefixLen);
    if (deletedLen > 0) b.delete(deletedLen);
    if (insertedStr.length > 0) b.insert(insertedStr);
    b.retain(suffixLen);
    return b.build();
}

// ── Editor Component ────────────────────────────────────────────

export default function Editor() {
    const { id: noteId } = useParams();
    const { currentUser } = useAuth();
    const [content, setContent] = useState('');
    const [title, setTitle] = useState('');
    const [socket, setSocket] = useState(null);
    const [collaborators, setCollaborators] = useState([]);
    const [status, setStatus] = useState('Synced');
    const [isSharing, setIsSharing] = useState(false);
    const [shareEmail, setShareEmail] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    
    // Group Chat states
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [newMsg, setNewMsg] = useState('');
    const [aiTyping, setAiTyping] = useState(false);

    // Drawing Layer states
    const [isDrawingMode, setIsDrawingMode] = useState(false);
    const [drawings, setDrawings] = useState([]);
    const [currentStroke, setCurrentStroke] = useState(null);
    const [remoteActiveStrokes, setRemoteActiveStrokes] = useState({});
    const [selectedColor, setSelectedColor] = useState('#a855f7');
    const [isEraser, setIsEraser] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);

    const isDrawingRef = useRef(false);
    const textareaRef = useRef(null);

    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_BACKEND_URL;
    const messagesEndRef = useRef(null);

    // ── OT State (refs to avoid re-render loops) ────────────────
    const docRef = useRef('');         // The shadow document for diffing
    const revisionRef = useRef(0);     // Last acknowledged server revision
    const pendingRef = useRef(null);   // Op sent to server, waiting for ack
    const bufferRef = useRef(null);    // Buffered local op while pending is in-flight
    const syncedRef = useRef(false);   // Has received doc-sync?

    // Auto-resize document height to fully fit multi-line content natively
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [content]);

    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        return () => newSocket.close();
    }, [API_URL]);

    useEffect(() => {
        if (!socket || !currentUser) return;

        const userId = currentUser.id || currentUser.uid || currentUser._id;

        // Join room
        socket.emit('join-note', noteId, {
            id: userId,
            email: currentUser.email
        });

        // ── OT: Initial document sync ───────────────────────────
        socket.on('doc-sync', ({ content: serverContent, revision }) => {
            docRef.current = serverContent;
            revisionRef.current = revision;
            pendingRef.current = null;
            bufferRef.current = null;
            syncedRef.current = true;
            setContent(serverContent);
            setIsLoading(false);
            setStatus('Synced');
        });

        // ── OT: Server acknowledged our op ──────────────────────
        socket.on('op-ack', ({ revision }) => {
            revisionRef.current = revision;
            pendingRef.current = null;

            // If we have a buffered op, send it now
            if (bufferRef.current && bufferRef.current.length > 0) {
                const bufferedOp = bufferRef.current;
                bufferRef.current = null;
                pendingRef.current = bufferedOp;
                socket.emit('submit-op', {
                    noteId,
                    revision: revisionRef.current,
                    op: bufferedOp
                });
                setStatus('Syncing...');
            } else {
                setStatus('Synced');
            }
        });

        // ── OT: Remote op from another client ───────────────────
        socket.on('apply-op', ({ op, revision }) => {
            revisionRef.current = revision;

            // Transform against our pending and buffered ops
            let serverOp = op;

            if (pendingRef.current) {
                const [pendingPrime, serverPrime] = transformOps(pendingRef.current, serverOp);
                pendingRef.current = pendingPrime;
                serverOp = serverPrime;
            }

            if (bufferRef.current) {
                const [bufferPrime, serverPrime] = transformOps(bufferRef.current, serverOp);
                bufferRef.current = bufferPrime;
                serverOp = serverPrime;
            }

            // Apply the (possibly transformed) server op to our local document
            const oldDoc = docRef.current;
            const newDoc = applyOp(oldDoc, serverOp);
            docRef.current = newDoc;

            // Preserve cursor position while applying remote changes
            const textarea = textareaRef.current;
            let cursorBefore = textarea ? textarea.selectionStart : 0;

            // Adjust cursor based on the server op
            let pos = 0;
            for (const c of serverOp) {
                if (isRetain(c)) {
                    pos += c;
                } else if (isInsert(c)) {
                    if (pos <= cursorBefore) cursorBefore += c.length;
                    pos += c.length;
                } else if (isDelete(c)) {
                    const delCount = -c;
                    if (pos < cursorBefore) {
                        cursorBefore -= Math.min(delCount, cursorBefore - pos);
                    }
                }
            }

            setContent(newDoc);

            // Restore cursor after React re-renders
            requestAnimationFrame(() => {
                if (textarea) {
                    textarea.selectionStart = cursorBefore;
                    textarea.selectionEnd = cursorBefore;
                }
            });
        });

        // ── OT error → full re-sync ────────────────────────────
        socket.on('ot-error', () => {
            console.warn('[OT] Error from server, requesting re-sync');
        });

        // ── Title updates (last-write-wins) ─────────────────────
        socket.on('title-updated', (newTitle) => {
            setTitle(newTitle);
        });

        socket.on('user-joined', (user) => {
            setCollaborators(prev => {
                const incomingId = user?.id || user?.uid || user?._id;
                const exists = prev.find(c => (c.id || c.uid || c._id) === incomingId);
                if (exists) return prev;
                return [...prev, user];
            });
        });

        // Listen for incoming chat messages
        socket.on('chat-message', (msg) => {
            setMessages(prev => {
                if (msg._id && prev.some(m => m._id === msg._id)) return prev;
                return [...prev, msg];
            });
        });

        // Listen for AI typing indicator
        socket.on('ai-typing', (isTyping) => {
            setAiTyping(isTyping);
        });

        // Listen for drawing socket updates
        socket.on('stroke-progress', (stroke) => {
            setRemoteActiveStrokes(prev => ({
                ...prev,
                [stroke.id]: stroke
            }));
        });

        socket.on('stroke-drawn', (stroke) => {
            setDrawings(prev => {
                if (prev.some(s => s.id === stroke.id)) return prev;
                return [...prev, stroke];
            });
            setRemoteActiveStrokes(prev => {
                const updated = { ...prev };
                delete updated[stroke.id];
                return updated;
            });
        });

        socket.on('stroke-deleted', (strokeId) => {
            setDrawings(prev => prev.filter(s => s.id !== strokeId));
        });

        socket.on('drawings-cleared', () => {
            setDrawings([]);
            setRemoteActiveStrokes({});
        });

        // Handle user leaving
        socket.on('user-left', (leftUserId) => {
            setCollaborators(prev => prev.filter(c => (c.id || c.uid || c._id) !== leftUserId));
        });

        return () => {
            socket.emit('leave-note', noteId);
            socket.off('doc-sync');
            socket.off('op-ack');
            socket.off('apply-op');
            socket.off('ot-error');
            socket.off('title-updated');
            socket.off('user-joined');
            socket.off('chat-message');
            socket.off('ai-typing');
            socket.off('stroke-progress');
            socket.off('stroke-drawn');
            socket.off('stroke-deleted');
            socket.off('drawings-cleared');
            socket.off('user-left');
        };
    }, [socket, noteId, currentUser]);

    useEffect(() => {
        fetchNote();
    }, [noteId]);

    // Auto scroll chat to bottom
    useEffect(() => {
        if (messagesEndRef.current) {
            const container = messagesEndRef.current;
            container.scrollTop = container.scrollHeight;
        }
    }, [messages, aiTyping, isChatOpen]);

    async function fetchNote() {
        try {
            setIsLoading(true);
            const response = await api.get(`/api/notes/${noteId}`);
            setTitle(response.data.title);
            // Content will be set by doc-sync from the OT session
            if (response.data.messages) {
                setMessages(response.data.messages);
            }
            if (response.data.drawings) {
                setDrawings(response.data.drawings);
            }
        } catch (err) {
            console.error("Failed to fetch note", err);
            if (err.response && err.response.status === 403) {
                alert("You do not have access to this note");
                navigate('/');
            }
        }
    }

    // ── OT: Send local changes ──────────────────────────────────

    const sendOp = useCallback((op) => {
        if (!socket || !syncedRef.current || op.length === 0) return;

        if (pendingRef.current === null) {
            // No op in-flight, send directly
            pendingRef.current = op;
            socket.emit('submit-op', {
                noteId,
                revision: revisionRef.current,
                op
            });
            setStatus('Syncing...');
        } else {
            // Already have an op in-flight, buffer this one
            if (bufferRef.current === null) {
                bufferRef.current = op;
            } else {
                // Compose the buffer with the new op
                // Simple approach: just compose them
                bufferRef.current = composeOps(bufferRef.current, op);
            }
        }
    }, [socket, noteId]);

    const handleContentChange = (e) => {
        if (!syncedRef.current) return;

        const newContent = e.target.value;
        const oldContent = docRef.current;

        // Compute the OT operation from the diff
        const op = diffToOp(oldContent, newContent);

        if (op.length === 0) return;

        // Update the shadow document
        docRef.current = newContent;
        setContent(newContent);
        setStatus('Editing...');

        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;

        // Send to server
        sendOp(op);
    };

    const handleTitleChange = (e) => {
        const newTitle = e.target.value;
        setTitle(newTitle);
        if (socket) {
            socket.emit('edit-title', noteId, newTitle);
        }
    };

    // Simple debounce for saving title to DB
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (title && socket) {
                // Title is saved by the edit-title socket event
            }
        }, 2000);
        return () => clearTimeout(timeoutId);
    }, [title]);

    const handleBackNavigation = () => {
        navigate('/');
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMsg.trim() || !socket) return;

        const messageText = newMsg;
        const tempMsg = {
            sender: currentUser.email,
            content: messageText,
            isAi: false,
            createdAt: new Date().toISOString()
        };

        // Append locally for immediate real-time feedback
        setMessages(prev => [...prev, tempMsg]);
        setNewMsg('');

        // Emit to server
        socket.emit('send-chat', noteId, {
            sender: currentUser.email,
            content: messageText
        });
    };

    const handleTextareaScroll = (e) => {
        setScrollTop(e.target.scrollTop);
    };

    const getSvgPoint = (e) => {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = (e.clientY - rect.top) + scrollTop;
        return { x, y };
    };

    const handleDrawStart = (e) => {
        if (!isDrawingMode) return;
        const pt = getSvgPoint(e);

        if (isEraser) {
            eraseAtPoint(pt);
            isDrawingRef.current = true;
            return;
        }

        isDrawingRef.current = true;
        const newStroke = {
            id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5),
            color: selectedColor,
            strokeWidth: 4,
            points: [pt]
        };
        setCurrentStroke(newStroke);
        if (socket) {
            socket.emit('draw-progress', noteId, newStroke);
        }
    };

    const handleDrawMove = (e) => {
        if (!isDrawingMode || !isDrawingRef.current) return;
        const pt = getSvgPoint(e);

        if (isEraser) {
            eraseAtPoint(pt);
            return;
        }

        if (currentStroke) {
            const updatedPoints = [...currentStroke.points, pt];
            const updatedStroke = { ...currentStroke, points: updatedPoints };
            setCurrentStroke(updatedStroke);
            if (socket) {
                socket.emit('draw-progress', noteId, updatedStroke);
            }
        }
    };

    const handleDrawEnd = () => {
        if (!isDrawingMode || !isDrawingRef.current) return;
        isDrawingRef.current = false;

        if (isEraser) return;

        if (currentStroke && currentStroke.points.length > 0) {
            const finishedStroke = currentStroke;
            setDrawings(prev => [...prev, finishedStroke]);
            setCurrentStroke(null);

            if (socket) {
                socket.emit('draw-stroke', noteId, finishedStroke);
            }
            setStatus('Synced');
        }
    };

    const eraseAtPoint = (pt) => {
        setDrawings(prev => {
            const toKeep = [];
            let erasedAny = false;
            for (const stroke of prev) {
                let hit = false;
                for (const p of stroke.points) {
                    const dist = Math.hypot(p.x - pt.x, p.y - pt.y);
                    if (dist < 20) {
                        hit = true;
                        break;
                    }
                }
                if (hit) {
                    erasedAny = true;
                    if (socket) {
                        socket.emit('delete-stroke', noteId, stroke.id);
                    }
                } else {
                    toKeep.push(stroke);
                }
            }
            if (erasedAny) setStatus('Synced');
            return toKeep;
        });
    };

    const handleClearCanvas = () => {
        setDrawings([]);
        if (socket) {
            socket.emit('clear-drawings', noteId);
        }
        setStatus('Synced');
    };

    return (
        <div className="editor-container">
            <header className="editor-header">
                <div className="editor-brand-left" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    <button className="back-btn" onClick={handleBackNavigation} title="Back to NoteSync Workspace">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="editor-logo-pill" style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '0.3rem 0.75rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', color: '#cbd5e1' }}>
                        NoteSync
                    </div>
                </div>
                {isLoading ? (
                    <div className="skeleton-box skeleton-editor-title" style={{ flexGrow: 1, margin: '0.5rem' }} />
                ) : (
                    <input
                        className="title-input"
                        value={title}
                        onChange={handleTitleChange}
                        placeholder="Untitled Note"
                    />
                )}
                <div className="editor-actions">
                    <div className="collaborators-list">
                        {collaborators.map((c, i) => (
                            <span key={i} className="collaborator-avatar" title={c.email}>
                                {c.email?.charAt(0).toUpperCase()}
                            </span>
                        ))}
                    </div>
                    
                    <div className="status-badge" data-status={status}>
                        <span className="status-dot"></span>
                        {status}
                    </div>

                    {isSharing ? (
                        <form className="share-form" onSubmit={async (e) => {
                            e.preventDefault();
                            if (!shareEmail) return;
                            try {
                                await api.post(`/api/notes/${noteId}/share`, { email: shareEmail });
                                alert(`Shared with ${shareEmail}`);
                                setIsSharing(false);
                                setShareEmail('');
                            } catch (err) {
                                alert(err.response?.data?.message || "Failed to share");
                            }
                        }}>
                            <input
                                autoFocus
                                type="email"
                                value={shareEmail}
                                onChange={(e) => setShareEmail(e.target.value)}
                                placeholder="Enter email address"
                            />
                            <button type="submit" className="share-submit-btn">Invite</button>
                            <button type="button" className="share-cancel-btn" onClick={() => setIsSharing(false)}>
                                <X size={16} />
                            </button>
                        </form>
                    ) : (
                        <button className="header-btn share-btn" onClick={() => setIsSharing(true)} title="Share">
                            <Share2 size={18} />
                            <span>Share</span>
                        </button>
                    )}

                    <button 
                        className={`header-btn draw-toggle-btn ${isDrawingMode ? 'active' : ''}`} 
                        onClick={() => setIsDrawingMode(!isDrawingMode)} 
                        title="Draw Layer Overlay"
                    >
                        <Pencil size={18} />
                        <span>Draw</span>
                    </button>

                    <button 
                        className={`header-btn chat-toggle-btn ${isChatOpen ? 'active' : ''}`} 
                        onClick={() => setIsChatOpen(!isChatOpen)} 
                        title="Group Chat"
                    >
                        <MessageSquare size={18} />
                        <span>Chat</span>
                    </button>
                </div>
            </header>
            
            <div className="editor-content-wrapper" style={{ display: 'flex', flexGrow: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
                <div className="editor-main-area">
                    <div className="document-page-container">
                        {/* SVG Vector Drawing Canvas Overlay */}
                        <svg
                            className="drawing-overlay-canvas"
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                pointerEvents: isDrawingMode ? 'auto' : 'none',
                                zIndex: isDrawingMode ? 15 : 5
                            }}
                            onMouseDown={handleDrawStart}
                            onMouseMove={handleDrawMove}
                            onMouseUp={handleDrawEnd}
                            onMouseLeave={handleDrawEnd}
                        >
                            <g transform={`translate(0, -${scrollTop})`}>
                                {drawings.map((stroke) => (
                                    <path
                                        key={stroke.id}
                                        d={stroke.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                                        fill="none"
                                        stroke={stroke.color}
                                        strokeWidth={stroke.strokeWidth}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                ))}
                                {Object.values(remoteActiveStrokes).map((stroke) => (
                                    stroke && stroke.points && stroke.points.length > 0 && (
                                        <path
                                            key={`remote-${stroke.id}`}
                                            d={stroke.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                                            fill="none"
                                            stroke={stroke.color}
                                            strokeWidth={stroke.strokeWidth}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity={0.8}
                                        />
                                    )
                                ))}
                                {currentStroke && currentStroke.points.length > 0 && (
                                    <path
                                        d={currentStroke.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                                        fill="none"
                                        stroke={currentStroke.color}
                                        strokeWidth={currentStroke.strokeWidth}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                )}
                            </g>
                        </svg>

                        {isLoading ? (
                            <div style={{ flexGrow: 1, padding: '3rem 8%', zIndex: 10 }}>
                                <div className="skeleton-box skeleton-editor-body" />
                                <div className="skeleton-box skeleton-editor-body" style={{ width: '90%' }} />
                                <div className="skeleton-box skeleton-editor-body" style={{ width: '85%' }} />
                                <div className="skeleton-box skeleton-editor-body" style={{ width: '70%' }} />
                                <div className="skeleton-box skeleton-editor-body" style={{ width: '95%' }} />
                                <div className="skeleton-box skeleton-editor-body" style={{ width: '60%' }} />
                            </div>
                        ) : (
                            <textarea
                                ref={textareaRef}
                                className="editor-textarea"
                                value={content}
                                onChange={handleContentChange}
                                onScroll={handleTextareaScroll}
                                placeholder="Start typing..."
                            />
                        )}
                    </div>

                    {/* Rich Floating Drawing Toolbar Overlays */}
                    {isDrawingMode && (
                        <div className="drawing-toolbar">
                            <div className="palette-swatches">
                                {['#a855f7', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e'].map(color => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={`color-swatch ${selectedColor === color && !isEraser ? 'selected' : ''}`}
                                        style={{ backgroundColor: color }}
                                        onClick={() => {
                                            setSelectedColor(color);
                                            setIsEraser(false);
                                        }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            
                            <div className="toolbar-divider" />

                            <button
                                type="button"
                                className={`tool-btn ${isEraser ? 'active' : ''}`}
                                onClick={() => setIsEraser(!isEraser)}
                                title="Eraser (Click or wipe over strokes)"
                            >
                                <Eraser size={18} />
                                <span>Eraser</span>
                            </button>

                            <button
                                type="button"
                                className="tool-btn clear-btn"
                                onClick={handleClearCanvas}
                                title="Clear whole drawing canvas"
                            >
                                <Trash2 size={18} />
                                <span>Clear</span>
                            </button>
                        </div>
                    )}
                </div>
                
                {isChatOpen && (
                    <aside className="chat-sidebar">
                        <div className="chat-header">
                            <div className="chat-title-group">
                                <MessageSquare size={18} />
                                <h3>Group Chat</h3>
                            </div>
                            <button className="chat-close-btn" onClick={() => setIsChatOpen(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        
                        <div className="chat-messages-container" ref={messagesEndRef}>
                            {messages.length === 0 ? (
                                <div className="no-messages">
                                    <p>No messages yet. Start the conversation below!</p>
                                    <small>Mention <b>@ai</b> to ask the AI Assistant questions about this note.</small>
                                </div>
                            ) : (
                                messages.map((m, idx) => {
                                    const isMe = m.sender === currentUser.email;
                                    return (
                                        <div key={idx} className={`chat-message ${isMe ? 'message-me' : m.isAi ? 'message-ai' : 'message-other'}`}>
                                            <div className="message-sender">{isMe ? 'You' : m.sender}</div>
                                            <div className="message-content">{m.content}</div>
                                            <div className="message-time">
                                                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {aiTyping && (
                                <div className="chat-message message-ai typing-indicator-msg">
                                    <div className="message-sender">AI Assistant</div>
                                    <div className="typing-dots">
                                        <span></span><span></span><span></span>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <form className="chat-input-form" onSubmit={handleSendMessage}>
                            <input
                                type="text"
                                value={newMsg}
                                onChange={(e) => setNewMsg(e.target.value)}
                                placeholder="Type a message... (use @ai)"
                            />
                            <button type="submit" className="chat-send-btn" disabled={!newMsg.trim()}>
                                <Send size={16} />
                            </button>
                        </form>
                    </aside>
                )}
            </div>
        </div>
    );
}

// ── Compose helper for buffering ────────────────────────────────

function composeOps(op1, op2) {
    const { outputLen: op1Out } = opLengths(op1);
    const { inputLen: op2In } = opLengths(op2);
    if (op1Out !== op2In) {
        // Length mismatch — can't compose, just use op2
        // This is a safety fallback; should not happen in practice
        console.warn('[OT] Compose length mismatch, using latest op');
        return op2;
    }

    const builder = new OpBuilder();
    let i1 = 0, i2 = 0;
    let c1 = op1[i1], c2 = op2[i2];

    while (i1 < op1.length || i2 < op2.length) {
        if (c1 === undefined && c2 === undefined) break;
        if (isDelete(c1)) { builder.delete(-c1); i1++; c1 = op1[i1]; continue; }
        if (isInsert(c2)) { builder.insert(c2); i2++; c2 = op2[i2]; continue; }
        if (c1 === undefined || c2 === undefined) break;

        if (isRetain(c1) && isRetain(c2)) {
            const m = Math.min(c1, c2); builder.retain(m);
            c1 = c1 - m > 0 ? c1 - m : op1[++i1]; c2 = c2 - m > 0 ? c2 - m : op2[++i2];
        } else if (isRetain(c1) && isDelete(c2)) {
            const m = Math.min(c1, -c2); builder.delete(m);
            c1 = c1 - m > 0 ? c1 - m : op1[++i1]; c2 = -c2 - m > 0 ? -((-c2) - m) : op2[++i2];
        } else if (isInsert(c1) && isRetain(c2)) {
            const m = Math.min(c1.length, c2); builder.insert(c1.slice(0, m));
            c1 = c1.length - m > 0 ? c1.slice(m) : op1[++i1]; c2 = c2 - m > 0 ? c2 - m : op2[++i2];
        } else if (isInsert(c1) && isDelete(c2)) {
            const m = Math.min(c1.length, -c2);
            c1 = c1.length - m > 0 ? c1.slice(m) : op1[++i1]; c2 = -c2 - m > 0 ? -((-c2) - m) : op2[++i2];
        } else break;
    }

    return builder.build();
}
