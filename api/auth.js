/**
 * Vercel Serverless Function: Dashboard Authentication
 * 
 * This function handles secure login for the WK Weather Dashboard
 * Environment variables required in Vercel:
 * - DASHBOARD_USERNAME
 * - DASHBOARD_PASSWORD
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed' 
    });
  }

  try {
    // Validate environment variables
    if (!process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
      console.error('Dashboard credentials not configured in environment variables');
      return res.status(500).json({
        success: false,
        error: 'Authentication not configured',
        message: 'Please set DASHBOARD_USERNAME and DASHBOARD_PASSWORD in Vercel environment variables'
      });
    }

    // Get credentials from request body
    const { username, password } = req.body;

    // Validate request
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Username and password are required'
      });
    }

    // Check credentials against environment variables
    const validUsername = process.env.DASHBOARD_USERNAME;
    const validPassword = process.env.DASHBOARD_PASSWORD;

    if (username === validUsername && password === validPassword) {
      // Successful authentication
      console.log(`Successful login attempt for user: ${username}`);
      
      return res.status(200).json({
        success: true,
        message: 'Authentication successful',
        timestamp: new Date().toISOString()
      });
    } else {
      // Failed authentication
      console.log(`Failed login attempt for user: ${username}`);
      
      // Add a small delay to prevent brute force attacks
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Incorrect username or password'
      });
    }

  } catch (error) {
    console.error('Authentication error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
