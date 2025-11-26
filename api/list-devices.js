/**
 * Vercel Serverless Function: List All Homey Devices
 * 
 * This helper function lists all devices in your Homey
 * Use this to find the correct device ID for your temperature sensor
 * 
 * Visit: https://wksnowdashboard.wvsailing.co.uk/api/list-devices
 */

// Cache for access token
let cachedAccessToken = null;
let cacheTimestamp = null;
const CACHE_DURATION = 3600000; // 1 hour

/**
 * Get fresh access token using refresh token
 */
async function getAccessToken() {
  const now = Date.now();
  
  if (cachedAccessToken && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached access token');
    return cachedAccessToken;
  }
  
  console.log('Refreshing access token...');
  
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
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();
  cachedAccessToken = tokens.access_token;
  cacheTimestamp = now;
  
  return cachedAccessToken;
}

/**
 * Get delegation token
 */
async function getDelegationToken(accessToken) {
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

  const contentType = response.headers.get('content-type');
  let delegationToken;
  
  if (contentType && contentType.includes('application/json')) {
    const json = await response.json();
    delegationToken = json.token || json;
  } else {
    delegationToken = await response.text();
  }
  
  return delegationToken;
}

/**
 * Get Homey info
 */
async function getHomeyInfo(accessToken) {
  const response = await fetch('https://api.athom.com/user/me', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  const user = await response.json();
  
  if (!user.homeys || user.homeys.length === 0) {
    throw new Error('No Homey devices found');
  }
  
  const homey = user.homeys[0];
  return {
    homeyId: homey._id,
    homeyName: homey.name,
    remoteUrl: homey.remoteUrlSecure || homey.remoteUrl
  };
}

/**
 * Create Homey session
 */
async function createHomeySession(delegationToken, remoteUrl) {
  const response = await fetch(`${remoteUrl}/api/manager/users/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token: delegationToken })
  });

  if (!response.ok) {
    throw new Error(`Session creation failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type');
  let sessionToken;
  
  if (contentType && contentType.includes('application/json')) {
    const json = await response.json();
    if (json.token) {
      sessionToken = json.token;
    } else if (json.bearer_token) {
      sessionToken = json.bearer_token;
    } else if (typeof json === 'string') {
      sessionToken = json;
    } else {
      sessionToken = JSON.stringify(json);
    }
  } else {
    sessionToken = await response.text();
  }
  
  // Remove quotes if present
  sessionToken = sessionToken.replace(/^"(.*)"$/, '$1');
  
  return sessionToken;
}

/**
 * List all devices
 */
async function listAllDevices(sessionToken, remoteUrl) {
  const response = await fetch(`${remoteUrl}/api/manager/devices/device`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${sessionToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to list devices: ${response.status}`);
  }

  const devices = await response.json();
  return devices;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Listing all Homey devices...');
    
    // Get access token
    const accessToken = await getAccessToken();
    
    // Get Homey info
    const homeyInfo = await getHomeyInfo(accessToken);
    console.log('Homey:', homeyInfo.homeyName);
    
    // Get delegation token
    const delegationToken = await getDelegationToken(accessToken);
    
    // Create session
    const sessionToken = await createHomeySession(delegationToken, homeyInfo.remoteUrl);
    
    // List all devices
    const allDevices = await listAllDevices(sessionToken, homeyInfo.remoteUrl);
    
    // Filter and format devices with temperature/humidity
    const sensors = [];
    const otherDevices = [];
    
    for (const [deviceId, device] of Object.entries(allDevices)) {
      const caps = device.capabilitiesObj || device.capabilities || {};
      const hasTemp = caps.measure_temperature || caps.temperature;
      const hasHumidity = caps.measure_humidity || caps.humidity;
      
      const deviceInfo = {
        id: deviceId,
        name: device.name,
        zone: device.zoneName || 'Unknown Zone',
        class: device.class,
        capabilities: []
      };
      
      if (hasTemp) {
        const tempCap = caps.measure_temperature || caps.temperature;
        deviceInfo.capabilities.push({
          type: 'temperature',
          value: tempCap.value,
          units: tempCap.units || '°C'
        });
      }
      
      if (hasHumidity) {
        const humCap = caps.measure_humidity || caps.humidity;
        deviceInfo.capabilities.push({
          type: 'humidity',
          value: humCap.value,
          units: humCap.units || '%'
        });
      }
      
      if (hasTemp || hasHumidity) {
        sensors.push(deviceInfo);
      } else {
        deviceInfo.capabilities = Object.keys(caps).slice(0, 3); // Show first 3 caps
        otherDevices.push(deviceInfo);
      }
    }
    
    // Sort sensors by name
    sensors.sort((a, b) => a.name.localeCompare(b.name));
    
    return res.status(200).json({
      success: true,
      homey: {
        name: homeyInfo.homeyName,
        id: homeyInfo.homeyId
      },
      totalDevices: Object.keys(allDevices).length,
      sensors: sensors,
      otherDevices: otherDevices.slice(0, 10), // Show first 10 other devices
      message: 'Find your outdoor sensor in the "sensors" array and copy its "id" to HOMEY_DEVICE_ID_TEMP'
    });
    
  } catch (error) {
    console.error('Error listing devices:', error);
    
    return res.status(500).json({
      error: 'Failed to list devices',
      message: error.message
    });
  }
}
