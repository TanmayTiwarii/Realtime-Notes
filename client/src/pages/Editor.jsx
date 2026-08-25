import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import api from '../services/api';
import { Save, Share2, ArrowLeft, X, MessageSquare, Send, Pencil, Eraser, RotateCcw, Trash2, Lock, Unlock, Edit3, Loader } from 'lucide-react';

export default function Editor() {
    const { id: noteId } = useParams();
    const { currentUser } = useAuth();
    const [content, setContent] = useState('');
    const [title, setTitle] = useState('');
    const [socket, setSocket] = useState(null);
    const [collaborators, setCollaborators] = useState([]);
    const [status, setStatus] = useState('Saved');
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

    // Write-lock states
    const [lockHolder, setLockHolder] = useState(null);       // { userEmail } or null
    const [hasLock, setHasLock] = useState(false);             // this client holds the lock
    const [lockRequesting, setLockRequesting] = useState(false);
    const [warningMsg, setWarningMsg] = useState('');

    const isDrawingRef = useRef(false);
    const textareaRef = useRef(null);
    const heartbeatRef = useRef(null);
    const warningTimeoutRef = useRef(null);

    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_BACKEND_URL;
    const messagesEndRef = useRef(null);

    // Ref to track if change is local or remote to avoid loops
    const isLocalChange = useRef(false);

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

        // Listen for incoming note changes
        socket.on('note-updated', (newContent) => {
            setContent(newContent);
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

        // ── Write-lock listeners ─────────────────────────────
        socket.on('lock-granted', () => {
            setHasLock(true);
            setLockHolder(null);
            setLockRequesting(false);
        });

        socket.on('lock-denied', (data) => {
            setHasLock(false);
            if (data.holder) setLockHolder(data.holder);
            setLockRequesting(false);
        });

        socket.on('note-locked', (data) => {
            setLockHolder(data.holder);
            setHasLock(false);
        });

        socket.on('note-unlocked', () => {
            setLockHolder(null);
            // Don't touch hasLock here — if this client released, it was already set to false
        });

        socket.on('lock-state', (data) => {
            // Initial state on join — someone already holds the lock
            setLockHolder(data.holder);
            setHasLock(false);
        });

        return () => {
            // Release lock before leaving
            socket.emit('release-edit-lock', noteId);
            socket.emit('leave-note', noteId);
            socket.off('note-updated');
            socket.off('user-joined');
            socket.off('chat-message');
            socket.off('ai-typing');
            socket.off('stroke-progress');
            socket.off('stroke-drawn');
            socket.off('stroke-deleted');
            socket.off('drawings-cleared');
            socket.off('user-left');
            socket.off('lock-granted');
            socket.off('lock-denied');
            socket.off('note-locked');
            socket.off('note-unlocked');
            socket.off('lock-state');
            // Clear heartbeat
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        };
    }, [socket, noteId, currentUser]);

    // Heartbeat to keep the lock alive while editing
    useEffect(() => {
        if (hasLock && socket) {
            heartbeatRef.current = setInterval(() => {
                socket.emit('heartbeat-lock', noteId);
            }, 30000);
        }
        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, [hasLock, socket, noteId]);

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
            setContent(response.data.content);
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
        } finally {
            setIsLoading(false);
        }
    }

    const handleContentChange = (e) => {
        if (!hasLock) return;
        const newContent = e.target.value;
        setContent(newContent);
        setStatus('Unsaved...');

        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;

        if (socket) {
            socket.emit('edit-note', noteId, newContent);
        }
    };

    const handleInteraction = () => {
        if (hasLock) return;
        if (lockHolder) {
            setWarningMsg('Cannot write right now');
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            warningTimeoutRef.current = setTimeout(() => setWarningMsg(''), 3000);
        } else if (!lockRequesting) {
            setLockRequesting(true);
            socket.emit('request-edit-lock', noteId);
        }
    };

    const handleDocumentBlur = (e) => {
        // If focus is moving between title and textarea, do not release
        if (e.relatedTarget && (
            e.relatedTarget.classList.contains('title-input') || 
            e.relatedTarget.classList.contains('editor-textarea')
        )) {
            return;
        }
        
        // Otherwise, focus left the document area -> release lock
        if (socket && hasLock) {
            saveNote();
            socket.emit('release-edit-lock', noteId);
            setHasLock(false);
            setLockHolder(null);
        }
    };

    const handleBackNavigation = () => {
        if (socket && hasLock) {
            saveNote();
            socket.emit('release-edit-lock', noteId);
        }
        navigate('/');
    };

    // Simple debounce for saving to DB
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (status === 'Unsaved...') {
                saveNote();
            }
        }, 2000);
        return () => clearTimeout(timeoutId);
    }, [content, title]);

    async function saveNote() {
        try {
            setStatus('Saving...');
            await api.put(`/api/notes/${noteId}`, {
                title,
                content
            });
            setStatus('Saved');
        } catch (err) {
            console.error("Failed to save", err);
            setStatus('Error saving');
        }
    }

    function handleGenericSave() {
        saveNote();
    }

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
            // Real-time socket commands immediately save vectors to DB natively
            setStatus('Saved');
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
            if (erasedAny) setStatus('Saved');
            return toKeep;
        });
    };

    const handleClearCanvas = () => {
        setDrawings([]);
        if (socket) {
            socket.emit('clear-drawings', noteId);
        }
        setStatus('Saved');
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
                        onClick={handleInteraction}
                        onFocus={handleInteraction}
                        onBlur={handleDocumentBlur}
                        onChange={(e) => { if (hasLock) setTitle(e.target.value); }}
                        readOnly={!hasLock}
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

                    <button className="header-btn save-btn" onClick={handleGenericSave} title="Save">
                        <Save size={18} />
                        <span>Save</span>
                    </button>
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

            {/* Lock banner — visible when someone else holds the lock */}
            {lockHolder && !hasLock && (
                <div className="lock-banner">
                    <span className="lock-pulse"></span>
                    <Lock size={14} />
                    <span>{lockHolder.userEmail} is editing</span>
                    {warningMsg && <span style={{marginLeft: 'auto', color: '#f87171', fontWeight: 600}}>{warningMsg}</span>}
                </div>
            )}
            
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
                                className={`editor-textarea ${!hasLock ? 'editor-readonly' : ''}`}
                                value={content}
                                onClick={handleInteraction}
                                onFocus={handleInteraction}
                                onBlur={handleDocumentBlur}
                                onChange={handleContentChange}
                                onScroll={handleTextareaScroll}
                                readOnly={!hasLock}
                                placeholder={hasLock ? 'Start typing...' : 'Click to start editing...'}
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

