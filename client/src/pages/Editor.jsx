import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import axios from 'axios';
import { Save, Share2, ArrowLeft, History, X, Sparkles } from 'lucide-react';

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
    const [summary, setSummary] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const navigate = useNavigate();
    const API_URL = import.meta.env.VITE_BACKEND_URL;

    // Ref to track if change is local or remote to avoid loops
    const isLocalChange = useRef(false);

    useEffect(() => {
        // Connect to Socket via standard websocket
        const newSocket = io(API_URL);
        setSocket(newSocket);

        return () => newSocket.close();
    }, [API_URL]);

    useEffect(() => {
        if (!socket || !currentUser) return;

        // Join room
        socket.emit('join-note', noteId, {
            uid: currentUser.uid,
            email: currentUser.email
        });

        // Listen for incoming changes
        socket.on('note-updated', (newContent) => {
            setContent(newContent);
        });

        socket.on('user-joined', (user) => {
            setCollaborators(prev => {
                const exists = prev.find(c => c.uid === user.uid);
                if (exists) return prev;
                return [...prev, user];
            });
        });

        return () => {
            socket.emit('leave-note', noteId);
            socket.off('note-updated');
            socket.off('user-joined');
        };
    }, [socket, noteId, currentUser]);

    useEffect(() => {
        fetchNote();
    }, [noteId]);

    async function fetchNote() {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get(`${API_URL}/api/notes/${noteId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setTitle(response.data.title);
            setContent(response.data.content);
            if (response.data.summary) {
                setSummary(response.data.summary);
            }
        } catch (err) {
            console.error("Failed to fetch note", err);
            if (err.response && err.response.status === 403) {
                alert("You do not have access to this note");
                navigate('/');
            }
        }
    }

    const handleContentChange = (e) => {
        const newContent = e.target.value;
        setContent(newContent);
        setStatus('Unsaved...');
        if (summary) setSummary('');

        if (socket) {
            socket.emit('edit-note', noteId, newContent);
        }

        // Debounced save could go here using a custom hook or timer
        saveToDb(newContent);
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
            const token = localStorage.getItem('token');
            await axios.put(`${API_URL}/api/notes/${noteId}`, {
                title,
                content
            }, {
                headers: { Authorization: `Bearer ${token}` }
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

    async function handleSummarize() {
        if (!content.trim()) return;
        setIsSummarizing(true);
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(`${API_URL}/api/notes/${noteId}/summarize`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSummary(response.data.summary);
        } catch (err) {
            console.error("Failed to summarize", err);
            alert("Failed to summarize note");
        } finally {
            setIsSummarizing(false);
        }
    }

    return (
        <div className="editor-container">
            <header className="editor-header">
                <button className="back-btn" onClick={() => navigate('/')}>
                    <ArrowLeft size={20} />
                </button>
                <input
                    className="title-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Untitled Note"
                />
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
                                const token = localStorage.getItem('token');
                                await axios.post(`${API_URL}/api/notes/${noteId}/share`, { email: shareEmail }, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
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
                </div>
            </header>
            <textarea
                className="editor-textarea"
                value={content}
                onChange={handleContentChange}
                placeholder="Start typing..."
            />
            
            {summary && (
                <div className="summary-box">
                    <div className="summary-header">
                        <Sparkles size={16} />
                        <h3>AI Summary</h3>
                    </div>
                    <p>{summary}</p>
                </div>
            )}
            
            <div className="editor-footer">
                <button 
                    className="summarize-btn" 
                    onClick={handleSummarize} 
                    disabled={isSummarizing || !content.trim()}
                >
                    <Sparkles size={18} />
                    <span>{isSummarizing ? 'Summarizing...' : 'Summarize Note'}</span>
                </button>
            </div>
        </div>
    );
}
