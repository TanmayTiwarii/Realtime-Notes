import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Mail, Lock, Sparkles, Layers, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';

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
            <div className="auth-split-card">
                {/* Stunning Left Showcase Banner */}
                <div className="auth-hero-panel">
                    <div className="hero-brand">
                        <div className="hero-logo-icon">
                            <Layers size={22} />
                        </div>
                        <h3>NoteSync</h3>
                    </div>

                    <div className="hero-content">
                        <h1>Deploy Secure<br />Workspaces</h1>
                        <p>
                            Instantly orchestrate simultaneous absolute vector overlays alongside robust group chat streams and local state synchronization.
                        </p>
                        
                        <div className="hero-features">
                            <div className="feature-item">
                                <CheckCircle2 size={16} className="feature-icon" />
                                <span>Absolute Vector Layer Coordinate Persistence</span>
                            </div>
                            <div className="feature-item">
                                <Cpu size={16} className="feature-icon" />
                                <span>Autonomous Groq API Contextual LLM Participant</span>
                            </div>
                            <div className="feature-item">
                                <Sparkles size={16} className="feature-icon" />
                                <span>Zero Connection Droppage Engine Architecture</span>
                            </div>
                        </div>
                    </div>

                    <div className="hero-footer" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        Enterprise-Grade Multi-Client Broadcast State
                    </div>
                </div>

                {/* Highly Interactive Custom Registration Form */}
                <div className="auth-form-panel">
                    <h2>Create Account</h2>
                    <p className="auth-subtitle">Initialize your core authenticated developer identity</p>

                    {error && (
                        <div className="error">
                            <AlertCircle size={18} style={{ flexShrink: 0 }} />
                            <span>{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Email Address</label>
                            <div className="input-wrapper">
                                <input 
                                    type="email" 
                                    ref={emailRef} 
                                    required 
                                    placeholder="name@company.com" 
                                />
                                <Mail size={18} className="input-icon" />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Secure Password</label>
                            <div className="input-wrapper">
                                <input 
                                    type="password" 
                                    ref={passwordRef} 
                                    required 
                                    placeholder="••••••••••••" 
                                />
                                <Lock size={18} className="input-icon" />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Confirm Password</label>
                            <div className="input-wrapper">
                                <input 
                                    type="password" 
                                    ref={passwordConfirmRef} 
                                    required 
                                    placeholder="••••••••••••" 
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
                            <span>{loading ? 'Initializing Workspace...' : 'Register Account'}</span>
                        </button>
                    </form>

                    <div className="auth-footer-link" style={{ marginTop: '2.5rem' }}>
                        Already hold credentials? 
                        <Link to="/login">Sign in directly</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
