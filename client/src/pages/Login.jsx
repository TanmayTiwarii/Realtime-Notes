import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Mail, Lock, Sparkles, Layers, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Login() {
    const emailRef = useRef();
    const passwordRef = useRef();
    const { login } = useAuth();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();

        try {
            setError('');
            setLoading(true);
            await login(emailRef.current.value, passwordRef.current.value);
            navigate('/');
        } catch (err) {
            setError('Failed to log in: ' + err.message);
        } finally {
            setLoading(false);
        }
    }

    const handleFillDemo = () => {
        if (emailRef.current && passwordRef.current) {
            emailRef.current.value = 'demo@gmail.com';
            passwordRef.current.value = '123456';
        }
    };

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
                        <h1>Real-Time<br />Workspace Engine</h1>
                        <p>
                            Simultaneous absolute-mapped text editing paired with deep multiplayer vector drawing streams and continuous Sub-second AI logic pipelines.
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
                                <span>Robust Fan-out Broadcast & Latency Benchmarks</span>
                            </div>
                        </div>
                    </div>

                    <div className="hero-footer" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        Secured via Enterprise State Synchronization Engines
                    </div>
                </div>

                {/* Highly Interactive Custom Right Form */}
                <div className="auth-form-panel">
                    <h2>Welcome back</h2>
                    <p className="auth-subtitle">Enter your details to access the collaboration network</p>

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
                            <label>Account Password</label>
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

                        <button 
                            disabled={loading} 
                            type="submit" 
                            className="premium-auth-btn"
                        >
                            <LogIn size={18} />
                            <span>{loading ? 'Authenticating...' : 'Sign In to Dashboard'}</span>
                        </button>
                    </form>

                    {/* Sophisticated Demo Autofill Component */}
                    <div className="demo-autofill-box">
                        <div className="demo-details">
                            <strong>Instant Sandbox Access</strong>
                            <span>Try the editor instantly with our demo credentials.</span>
                        </div>
                        <button 
                            type="button" 
                            className="demo-fill-btn" 
                            onClick={handleFillDemo}
                            title="Click to automatically fill demo details"
                        >
                            Auto-Fill Demo
                        </button>
                    </div>

                    <div className="auth-footer-link">
                        New to NoteSync? 
                        <Link to="/signup">Create workspace account</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
