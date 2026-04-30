import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Find user in MongoDB
        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }
        
        // Attach MongoDB user object to req
        req.user = user;
        next();
    } catch (error) {
        console.error('Error verifying token:', error.message);
        res.status(403).json({ message: 'Unauthorized', error: error.message });
    }
};

export default verifyToken;
