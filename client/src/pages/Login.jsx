import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

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
        }

        setLoading(false);
    }

    return (
        <div className="auth-container">
            <h1 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--primary-color)', fontWeight: 'bold', fontSize: '2.5rem' }}>NoteSync</h1>
            <h2>Log In</h2>
            {error && <div className="error">{error}</div>}
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Email</label>
                    <input type="email" ref={emailRef} required />
                </div>
                <div className="form-group">
                    <label>Password</label>
                    <input type="password" ref={passwordRef} required />
                </div>
                <button disabled={loading} type="submit">Log In</button>
            </form>
            <div className="w-100 text-center mt-2">
                Need an account? <Link to="/signup">Sign Up</Link>
            </div>
            <div className="demo-info text-center mt-3" style={{ fontSize: '0.9em', color: '#666' }}>
                <p className="mb-0"><strong>Demo Account:</strong></p>
                <p className="mb-0">Email: demo@gmail.com</p>
                <p className="mb-0">Password: 123456</p>
            </div>
        </div>
    );
}
