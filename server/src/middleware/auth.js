import { admin } from '../firebase/admin.js';

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        console.log('Auth Success:', decodedToken.email);
        next();
    } catch (error) {
        console.error('Error verifying token:', error.code, error.message);
        res.status(403).json({ message: 'Unauthorized', error: error.message });
    }
};

export default verifyToken;
