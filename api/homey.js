/**
 * Vercel Serverless Function: Homey API with Long-Term OAuth Authentication
 * 
 * This uses OAuth refresh tokens which never expire (unless revoked or 6 months inactive)
 * Environment variables required in Vercel:
 * - HOMEY_CLIENT_ID (from HomeyScript OAuth app - NOT Web App)
 * - HOMEY_CLIENT_SECRET
 * - HOMEY_REFRESH_TOKEN (obtained once, then stored)
 * - HOMEY_DEVICE_ID_TEMP
 * - HOMEY_DEVICE_ID_HUMIDITY (optional)
 */

const fetch = require('node-fetch');

// Token cache (persists across function invocations in same container)
let cachedAccessToken = null;
let tokenExpiry = null;

/**
 * Get fresh access token using refresh token
 * Refresh tokens never expire (unless revoked or 6 months inactive)
 */
async function getAccessToken() {
  // Return cached token if still valid (with 5 minute buffer)
  const now = Date.now();
  if (cachedAccessToken && tokenExpiry && (tokenExpiry - now) > 5 * 60 * 1000) {
    console.log('Using cached access token');
    return cachedAccessToken;
  }

  console.log('Refreshing access token...');
  
  try {
    // Exchange refresh token for new access token
    const response = await fetch('https://api.athom.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.HOMEY_CLIENT_ID}:${process.env.HOMEY_CLIENT_SECRET}`
        ).toString('base64')
      },
      body: `grant_type=refresh_token&refresh_token=${process.env.HOMEY_REFRESH_TOKEN}`
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    
    // Cache the new access token
    cachedAccessToken = tokenData.access_token;
    tokenExpiry = now + (tokenData.expires_in * 1000); // Convert seconds to ms
    
    console.log('Access token refreshed successfully');
    return cachedAccessToken;
    
  } catch (error) {
    console.error('Error refreshing token:', error.message);
    throw error;
  }
}

/**
 * Get delegation token for Homey access
 */
async function getDelegationToken(accessToken) {
  try {
    const response = await fetch('https://api.athom.com/delegation/token?audience=homey', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Delegation token failed: ${response.status}`);
    }

    return await response.text(); // Returns JWT string
    
  } catch (error) {
    console.error('Error getting delegation token:', error.message);
    throw error;
  }
}

/**
 * Get user info and Homey details
 */
async function getHomeyInfo(accessToken) {
  try {
    const response = await fetch('https://api.athom.com/user/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    const userData = await response.json();
    
    // Get first Homey
    if (!userData.homeys || userData.homeys.length === 0) {
      throw new Error('No Homeys found for this account');
    }

    const homey = userData.homeys[0];
    return {
      homeyId: homey._id,
      remoteUrl: homey.remoteUrl || homey.remoteUrlSecure
    };
    
  } catch (error) {
    console.error('Error getting Homey info:', error.message);
    throw error;
  }
}

/**
 * Create session on Homey
 */
async function createHomeySession(delegationToken, remoteUrl) {
  try {
    const response = await fetch(`${remoteUrl}/api/manager/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: delegationToken })
    });

    if (!response.ok) {
      throw new Error(`Homey session creation failed: ${response.status}`);
    }

    return await response.text(); // Returns session token
    
  } catch (error) {
    console.error('Error creating Homey session:', error.message);
    throw error;
  }
}

/**
 * Get device data from Homey
 */
async function getDeviceData(sessionToken, remoteUrl, deviceId) {
  try {
    const response = await fetch(`${remoteUrl}/api/manager/devices/device/${deviceId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get device: ${response.status}`);
    }

    const device = await response.json();
    
    // Extract sensor values
    const caps = device.capabilitiesObj || device.capabilities || {};
    const data = {};
    
    if (caps.measure_temperature) {
      data.temperature = caps.measure_temperature.value;
    } else if (caps.temperature) {
      data.temperature = caps.temperature.value;
    }
    
    if (caps.measure_humidity) {
      data.humidity = caps.measure_humidity.value;
    } else if (caps.humidity) {
      data.humidity = caps.humidity.value;
    }
    
    return data;
    
  } catch (error) {
    console.error(`Error getting device ${deviceId}:`, error.message);
    throw error;
  }
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate environment variables
    const requiredEnvVars = [
      'HOMEY_CLIENT_ID',
      'HOMEY_CLIENT_SECRET',
      'HOMEY_REFRESH_TOKEN',
      'HOMEY_DEVICE_ID_TEMP'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      return res.status(500).json({
        error: 'Configuration error',
        message: `Missing environment variables: ${missingVars.join(', ')}`,
        note: 'Run the initial setup to get your refresh token'
      });
    }

    console.log('Starting OAuth flow with refresh token...');
    
    // Step 1: Get fresh access token using refresh token
    const accessToken = await getAccessToken();
    
    // Step 2: Get Homey info
    const { remoteUrl } = await getHomeyInfo(accessToken);
    
    // Step 3: Get delegation token
    const delegationToken = await getDelegationToken(accessToken);
    
    // Step 4: Create Homey session
    const sessionToken = await createHomeySession(delegationToken, remoteUrl);
    
    // Step 5: Fetch temperature data
    const tempData = await getDeviceData(
      sessionToken,
      remoteUrl,
      process.env.HOMEY_DEVICE_ID_TEMP
    );
    
    // Step 6: Fetch humidity data (may be same or different device)
    let humidityData = tempData;
    const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
    
    if (humidityDeviceId && humidityDeviceId !== process.env.HOMEY_DEVICE_ID_TEMP) {
      try {
        humidityData = await getDeviceData(sessionToken, remoteUrl, humidityDeviceId);
      } catch (error) {
        console.warn('Could not fetch separate humidity sensor:', error.message);
      }
    }
    
    // Return combined data
    const responseData = {
      temperature: tempData.temperature,
      humidity: humidityData.humidity || tempData.humidity,
      timestamp: new Date().toISOString(),
      source: 'homey-oauth-longterm'
    };
    
    console.log('Successfully fetched sensor data:', responseData);
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Homey OAuth API Error:', error);
    
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
