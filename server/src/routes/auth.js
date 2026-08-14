import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';

const router = express.Router();

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

function generateAccessToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

async function generateRefreshToken(userId) {
    const token = crypto.randomBytes(40).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await RefreshToken.create({ token, userId, expiresAt });

    return token;
}

// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            email,
            password: hashedPassword
        });

        const accessToken = generateAccessToken(user._id);
        const refreshToken = await generateRefreshToken(user._id);

        res.status(201).json({
            accessToken,
            refreshToken,
            user: { id: user._id, email: user.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const accessToken = generateAccessToken(user._id);
        const refreshToken = await generateRefreshToken(user._id);

        res.json({
            accessToken,
            refreshToken,
            user: { id: user._id, email: user.email }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Refresh — exchange a valid refresh token for a new access token + rotated refresh token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ message: 'Refresh token is required' });
        }

        // Find and delete the used refresh token atomically (rotation)
        const storedToken = await RefreshToken.findOneAndDelete({ token: refreshToken });

        if (!storedToken) {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        // Check if the token has expired (belt-and-suspenders alongside TTL index)
        if (storedToken.expiresAt < new Date()) {
            return res.status(401).json({ message: 'Refresh token has expired' });
        }

        // Verify the user still exists
        const user = await User.findById(storedToken.userId).select('-password');
        if (!user) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        // Issue new token pair
        const newAccessToken = generateAccessToken(user._id);
        const newRefreshToken = await generateRefreshToken(user._id);

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Logout — revoke the refresh token
router.post('/logout', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            await RefreshToken.findOneAndDelete({ token: refreshToken });
        }

        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

export default router;
