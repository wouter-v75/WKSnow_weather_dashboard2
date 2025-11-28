/**
 * Background Data Refresh with Redis
 * Access via: /api/refresh-data.js?manual=true
 */

import Redis from 'ioredis';

const CACHE_TTL = 300;
const HAFJELL_COORDS = { lat: 61.234381, lon: 10.448835 };

// Token cache (persists across invocations)
let cachedAccessToken = null;
let tokenExpiry = null;

function createRedisClient() {
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10000
  });
}

/**
 * Get fresh access token using refresh token (SAME AS api/homey.js)
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && tokenExpiry && (tokenExpiry - now) > 5 * 60 * 1000) {
    console.log('Using cached access token');
    return cachedAccessToken;
  }
  
  console.log('Refreshing access token...');
  
  try {
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
      const error = await response.text();
      throw new Error(`OAuth token refresh failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    cachedAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    console.log('Access token refreshed, expires in', data.expires_in, 'seconds');
    return cachedAccessToken;
    
  } catch (error) {
    console.error('Token refresh error:', error);
    throw error;
  }
}

async function fetchForecastData(redis) {
  console.log('📊 Fetching forecast...');
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HAFJELL_COORDS.lat}&lon=${HAFJELL_COORDS.lon}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WKWeatherDashboard/1.0 (wksnowdashboard.wvsailing.co.uk)' }
    });
    if (!response.ok) throw new Error(`Met.no: ${response.status}`);
    const data = await response.json();
    await redis.setex('forecast_data', CACHE_TTL, JSON.stringify({
      data, timestamp: new Date().toISOString(), source: 'yr.no'
    }));
    console.log('✅ Forecast cached');
    return { success: true, service: 'forecast' };
  } catch (error) {
    console.error('❌ Forecast:', error.message);
    return { success: false, service: 'forecast', error: error.message };
  }
}

async function fetchHomeyData(redis) {
  console.log('🏠 Fetching Homey...');
  
  if (!process.env.HOMEY_REFRESH_TOKEN) {
    console.log('⚠️ Homey not configured');
    return { success: false, service: 'homey', error: 'Not configured' };
  }
  
  try {
    // Get fresh access token
    const accessToken = await getAccessToken();
    
    // Get user info to find Homey ID
    console.log('Getting user info...');
    const userResponse = await fetch('https://api.athom.com/user/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!userResponse.ok) {
      throw new Error(`User API error: ${userResponse.status}`);
    }
    
    const userData = await userResponse.json();
    console.log('User:', userData.email);
    
    // Get Homey devices
    console.log('Getting Homeys...');
    const homeysResponse = await fetch('https://api.athom.com/homey', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!homeysResponse.ok) {
      throw new Error(`Homeys API error: ${homeysResponse.status}`);
    }
    
    const homeys = await homeysResponse.json();
    if (!homeys || homeys.length === 0) {
      throw new Error('No Homey devices found');
    }
    
    const homeyId = homeys[0]._id;
    console.log('Using Homey:', homeys[0].name, homeyId);
    
    // Create delegation token for this Homey
    console.log('Creating delegation token...');
    const delegationResponse = await fetch(`https://api.athom.com/delegation/token?audience=homey`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ homey: homeyId })
    });
    
    if (!delegationResponse.ok) {
      throw new Error(`Delegation token error: ${delegationResponse.status}`);
    }
    
    const delegationData = await delegationResponse.json();
    const homeyToken = delegationData.token;
    
    // Get device data from Homey local API
    console.log('Getting device data...');
    const deviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const deviceResponse = await fetch(`https://${homeyId}.connect.athom.com/api/device/${deviceId}`, {
      headers: { 'Authorization': `Bearer ${homeyToken}` }
    });
    
    if (!deviceResponse.ok) {
      throw new Error(`Device API error: ${deviceResponse.status}`);
    }
    
    const device = await deviceResponse.json();
    const caps = device.capabilitiesObj || device.capabilities || {};
    
    const sensorData = {
      temperature: caps.measure_temperature?.value || caps.temperature?.value,
      humidity: caps.measure_humidity?.value || caps.humidity?.value,
      timestamp: new Date().toISOString(),
      source: 'homey-pro'
    };
    
    console.log('Sensor data:', sensorData);
    
    await redis.setex('homey_data', CACHE_TTL, JSON.stringify(sensorData));
    console.log('✅ Homey cached');
    return { success: true, service: 'homey' };
    
  } catch (error) {
    console.error('❌ Homey error:', error.message);
    return { success: false, service: 'homey', error: error.message };
  }
}

async function fetchHafjellData(redis) {
  console.log('🏔️ Fetching Hafjell...');
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    const response = await fetch(proxyUrl + targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`Hafjell: ${response.status}`);
    const data = await response.json();
    await redis.setex('hafjell_html', CACHE_TTL, JSON.stringify({
      html: data.contents, timestamp: new Date().toISOString()
    }));
    console.log('✅ Hafjell cached');
    return { success: true, service: 'hafjell' };
  } catch (error) {
    console.error('❌ Hafjell:', error.message);
    return { success: false, service: 'hafjell', error: error.message };
  }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production' && !req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('🔄 Starting refresh...');
  const startTime = Date.now();
  let redis = null;
  
  try {
    redis = createRedisClient();
    await redis.connect();
    console.log('✅ Redis connected');
    
    const results = await Promise.allSettled([
      fetchForecastData(redis),
      fetchHomeyData(redis),
      fetchHafjellData(redis)
    ]);

    const duration = Date.now() - startTime;
    const summary = {
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      results: results.map((r, i) => 
        r.status === 'fulfilled' ? r.value : {
          success: false,
          service: ['forecast', 'homey', 'hafjell'][i],
          error: r.reason?.message
        }
      )
    };

    const successCount = summary.results.filter(r => r.success).length;
    console.log(`✅ Complete: ${successCount}/3 in ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      message: 'Background refresh completed',
      summary
    });
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({ error: 'Refresh failed', message: error.message });
  } finally {
    if (redis) {
      try { await redis.quit(); } catch (e) {}
    }
  }
}
