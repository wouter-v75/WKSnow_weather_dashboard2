// api/auth.js - Vercel Serverless Function for Authentication

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { username, password } = req.body;

        // Get credentials from environment variables
        const validUsername = process.env.AUTH_USERNAME || 'WK';
        const validPassword = process.env.AUTH_PASSWORD || 'winter2025';

        // Check credentials
        if (username === validUsername && password === validPassword) {
            return res.status(200).json({ 
                success: true,
                message: 'Authentication successful'
            });
        } else {
            return res.status(401).json({ 
                success: false,
                message: 'Invalid credentials'
            });
        }
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(500).json({ 
            success: false,
            error: 'Internal server error' 
        });
    }
}
