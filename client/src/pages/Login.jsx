import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Mail, Lock, Layers, AlertCircle } from 'lucide-react';

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

                    <button 
                        disabled={loading} 
                        type="submit" 
                        className="premium-auth-btn"
                    >
                        <LogIn size={18} />
                        <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                    </button>
                </form>

                <button 
                    type="button" 
                    className="demo-fill-btn" 
                    onClick={handleFillDemo}
                >
                    Try Demo
                </button>

                <div className="auth-footer-link">
                    <Link to="/signup">Create account</Link>
                </div>
            </div>
        </div>
    );
}
