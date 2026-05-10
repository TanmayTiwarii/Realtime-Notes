import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

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
        }

        setLoading(false);
    }

    return (
        <div className="auth-container">
            <h1 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--primary-color)', fontWeight: 'bold', fontSize: '2.5rem' }}>NoteSync</h1>
            <h2>Sign Up</h2>
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
                <div className="form-group">
                    <label>Password Confirmation</label>
                    <input type="password" ref={passwordConfirmRef} required />
                </div>
                <button disabled={loading} type="submit">Sign Up</button>
            </form>
            <div className="w-100 text-center mt-2">
                Already have an account? <Link to="/login">Log In</Link>
            </div>
        </div>
    );
}
