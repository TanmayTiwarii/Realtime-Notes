import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { Plus, LogOut, FileText, Trash2 } from 'lucide-react';

export default function Dashboard() {
    const [notes, setNotes] = useState([]);
    const { currentUser, logout } = useAuth();
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const API_URL = import.meta.env.VITE_BACKEND_URL;

    useEffect(() => {
        fetchNotes();
    }, []);

    async function fetchNotes() {
        try {
            const token = await currentUser.getIdToken();
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
            const token = await currentUser.getIdToken();
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
            const token = await currentUser.getIdToken();
            await axios.delete(`${API_URL}/api/notes/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setNotes(notes.filter(n => n.id !== id));
        } catch (err) {
            console.error("Failed to delete note", err);
            setError("Failed to delete note (Only owner can delete)");
        }
    }

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <h1>My Notes</h1>
                <div className="user-info">
                    <span>{currentUser.email}</span>
                    <button onClick={handleLogout} className="btn-icon" title="Logout">
                        <LogOut size={20} />
                    </button>
                </div>
            </header>

            {error && <div className="error-banner">{error}</div>}

            <div className="notes-grid">
                <div className="note-card create-card" onClick={createNote}>
                    <Plus size={40} />
                    <span>Create New Note</span>
                </div>

                {notes.map(note => (
                    <div key={note.id} className="note-card" onClick={() => navigate(`/note/${note.id}`)}>
                        <div className="note-icon">
                            <FileText size={30} />
                        </div>
                        <div className="note-content">
                            <h3>{note.title || 'Untitled'}</h3>
                            <p>{new Date(note.updatedAt || note.createdAt).toLocaleDateString()}</p>
                        </div>
                        {note.ownerId === currentUser.uid && (
                            <button className="delete-btn" onClick={(e) => deleteNote(e, note.id)}>
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
