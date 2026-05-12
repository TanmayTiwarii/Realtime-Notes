import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { Plus, LogOut, FileText, Trash2, Search, RefreshCw, Users, Share2 } from 'lucide-react';

export default function Dashboard() {
    const [notes, setNotes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('all'); // 'all' | 'shared'
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { currentUser, logout } = useAuth();
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const API_URL = import.meta.env.VITE_BACKEND_URL;

    useEffect(() => {
        fetchNotes();
    }, []);

    async function fetchNotes() {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get(`${API_URL}/api/notes`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setNotes(response.data);
        } catch (err) {
            console.error("Failed to fetch notes", err);
        }
    }

    async function handleLogout() {
        try {
            await logout();
            navigate('/login');
        } catch {
            setError('Failed to log out');
        }
    }

    async function createNote() {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.post(`${API_URL}/api/notes`, {
                title: 'Untitled Note',
                content: ''
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            navigate(`/note/${response.data.id}`);
        } catch (err) {
            console.error("Failed to create note", err);
            setError(err.response?.data?.error || 'Failed to create note');
        }
    }

    async function deleteNote(e, id) {
        e.stopPropagation(); // Prevent navigation
        if (!window.confirm("Are you sure you want to delete this note?")) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`${API_URL}/api/notes/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setNotes(notes.filter(n => n.id !== id));
        } catch (err) {
            console.error("Failed to delete note", err);
            setError("Failed to delete note (Only owner can delete)");
        }
    }

    function getTimeAgo(dateString) {
        if (!dateString) return 'Just now';
        const diff = Date.now() - new Date(dateString).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Updated just now';
        if (mins < 60) return `Modified ${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `Modified ${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `Modified ${days}d ago`;
    }

    const currentUserId = currentUser?.id || currentUser?.uid || currentUser?._id;

    const filteredNotes = notes.filter(note => {
        // Search filter on the basis of heading only
        const matchesSearch = (note.title || '').toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;

        // Tab filter
        if (activeTab === 'shared') {
            return note.ownerId !== currentUserId;
        }
        return true; // 'all' shows everything
    });

    return (
        <div className="dashboard-layout">
            {/* Left Sidebar matching mockups exactly */}
            <aside className="dashboard-sidebar">
                <div className="logo-brand">
                    <div className="logo-icon">
                        <FileText size={20} color="white" />
                    </div>
                    <div className="brand-text-group">
                        <h2>NoteSync</h2>
                        <span>Personal Workspace</span>
                    </div>
                </div>

                <div className="sidebar-btn-wrapper">
                    <button className="new-note-primary-btn" onClick={createNote}>
                        <Plus size={18} strokeWidth={2.5} />
                        <span>New Note</span>
                    </button>
                </div>

                <nav className="sidebar-nav">
                    <button 
                        className={`nav-item ${activeTab === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveTab('all')}
                    >
                        <FileText size={18} />
                        <span>All Notes</span>
                    </button>

                    <button 
                        className={`nav-item ${activeTab === 'shared' ? 'active' : ''}`}
                        onClick={() => setActiveTab('shared')}
                    >
                        <Users size={18} />
                        <span>Shared</span>
                    </button>
                </nav>

                <div className="sidebar-bottom">
                    <div className="user-profile-card">
                        <div className="user-avatar-circle">
                            {currentUser?.email?.charAt(0).toUpperCase()}
                        </div>
                        <div className="user-email-truncate" title={currentUser?.email}>
                            {currentUser?.email?.split('@')[0]}
                        </div>
                        <button className="logout-mini-btn" onClick={handleLogout} title="Log out">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Area container */}
            <div className="dashboard-main-area">
                {/* Top header searchbar matching design */}
                <header className="dashboard-topbar">
                    <div className="search-bar-wrapper">
                        <Search size={18} className="search-icon" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search note headings..."
                            className="topbar-search-input"
                        />
                    </div>

                    <div className="topbar-actions">
                        <button 
                            className={`topbar-icon-btn ${isRefreshing ? 'spin' : ''}`} 
                            onClick={async () => {
                                setIsRefreshing(true);
                                await fetchNotes();
                                setTimeout(() => setIsRefreshing(false), 500);
                            }} 
                            title="Refresh Workspace"
                        >
                            <RefreshCw size={18} />
                        </button>
                        <div className="topbar-user-badge">
                            <div className="topbar-avatar">
                                {currentUser?.email?.charAt(0).toUpperCase()}
                            </div>
                            <span className="topbar-username">{currentUser?.email?.split('@')[0]}</span>
                        </div>
                    </div>
                </header>

                <main className="dashboard-content">
                    {error && <div className="premium-error-banner">{error}</div>}

                    <div className="workspace-header">
                        <div className="title-section">
                            <h1>My Workspace</h1>
                            <p>You have {filteredNotes.length} active notes across your workspace.</p>
                        </div>
                    </div>

                    {/* Rich Note Cards Grid */}
                    <div className="premium-notes-grid">
                        {filteredNotes.map(note => {
                            const isOwner = note.ownerId === currentUserId;
                            const categories = ['Strategy', 'Personal', 'Ideas', 'Project'];
                            const category = categories[(note.title || '').length % categories.length];
                            const previewText = (note.content || '').replace(/<[^>]*>?/gm, '').substring(0, 95);

                            return (
                                <div key={note.id} className="premium-note-card" onClick={() => navigate(`/note/${note.id}`)}>
                                    <div className="card-top-row">
                                        <span className="category-pill">{isOwner ? category : 'Shared'}</span>
                                        {isOwner ? (
                                            <button 
                                                className="card-delete-icon" 
                                                onClick={(e) => deleteNote(e, note.id)} 
                                                title="Delete Note"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        ) : (
                                            <Share2 size={14} className="shared-indicator" title="Shared with me" />
                                        )}
                                    </div>

                                    <div className="card-body">
                                        <h3 className="card-title">{note.title || 'Untitled Note'}</h3>
                                        <p className="card-preview">
                                            {previewText ? previewText + (previewText.length >= 95 ? '...' : '') : 'Empty note content...'}
                                        </p>
                                    </div>

                                    <div className="card-footer">
                                        <span className="time-ago">{getTimeAgo(note.updatedAt || note.createdAt)}</span>
                                        <div className="card-avatars">
                                            <span className="mini-avatar owner" title={isOwner ? 'Me' : note.ownerEmail}>
                                                {(isOwner ? currentUser.email : note.ownerEmail || 'U')?.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Special Create Blank Note card matching mockup dashed container exactly */}
                        <div className="premium-create-card" onClick={createNote}>
                            <div className="create-plus-circle">
                                <Plus size={24} />
                            </div>
                            <span className="create-title">Create blank note</span>
                            <span className="create-sub">or click here</span>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
