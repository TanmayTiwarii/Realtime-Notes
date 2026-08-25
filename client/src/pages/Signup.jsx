import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Mail, Lock, Layers, AlertCircle } from 'lucide-react';

export default function Signup() {
    const emailRef = useRef();
    const passwordRef = useRef();
    const passwordConfirmRef = useRef();
    const { signup } = useAuth();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();

        if (passwordRef.current.value !== passwordConfirmRef.current.value) {
            return setError('Passwords do not match');
        }

        try {
            setError('');
            setLoading(true);
            await signup(emailRef.current.value, passwordRef.current.value);
            navigate('/');
        } catch (err) {
            setError('Failed to create an account: ' + err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-page-wrapper">
            <div className="auth-minimal-card">
                <div className="auth-logo-mark">
                    <div className="auth-logo-icon">
                        <Layers size={24} />
                    </div>
                    <span className="auth-logo-text">NoteSync</span>
                </div>

                {error && (
                    <div className="error">
                        <AlertCircle size={18} style={{ flexShrink: 0 }} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <div className="input-wrapper">
                            <input 
                                type="email" 
                                ref={emailRef} 
                                required 
                                placeholder="Email" 
                            />
                            <Mail size={18} className="input-icon" />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="input-wrapper">
                            <input 
                                type="password" 
                                ref={passwordRef} 
                                required 
                                placeholder="Password" 
                            />
                            <Lock size={18} className="input-icon" />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="input-wrapper">
                            <input 
                                type="password" 
                                ref={passwordConfirmRef} 
                                required 
                                placeholder="Confirm password" 
                            />
                            <Lock size={18} className="input-icon" />
                        </div>
                    </div>

                    <button 
                        disabled={loading} 
                        type="submit" 
                        className="premium-auth-btn"
                    >
                        <UserPlus size={18} />
                        <span>{loading ? 'Creating...' : 'Create Account'}</span>
                    </button>
                </form>

                <div className="auth-footer-link">
                    <Link to="/login">Sign in instead</Link>
                </div>
            </div>
        </div>
    );
}
