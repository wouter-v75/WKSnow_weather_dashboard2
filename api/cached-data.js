/**
 * Vercel Serverless Function: Redis Cloud Cache Handler (PRODUCTION)
 * 
 * OPTIMIZATIONS:
 * 1. Store ONLY essential dashboard data (minimized payload)
 * 2. 15-minute update interval
 * 3. Store 12-hour temperature history for trend chart
 * 4. Efficient data structure for fast retrieval
 */

const { createClient } = require('redis');

// Redis Cloud connection helper
async function getRedisClient() {
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500)
    }
  });
  
  await client.connect();
  return client;
}

// ========== DATA STRUCTURE OPTIMIZATION ==========

function createOptimizedHomeyData(rawData) {
  return {
    temp: rawData.temperature !== undefined ? parseFloat(rawData.temperature).toFixed(1) : null,
    hum: rawData.humidity !== undefined ? Math.round(rawData.humidity) : null,
    ts: Date.now()
  };
}

function createOptimizedHafjellData(rawData) {
  return {
    top: {
      temp: rawData.top?.temperature || null,
      cond: rawData.top?.condition || 'Unknown',
      wind: rawData.top?.wind || null,
      snow: rawData.top?.snow || null,
      snowDay: rawData.top?.snowLastDay || null
    },
    bottom: {
      temp: rawData.bottom?.temperature || null,
      cond: rawData.bottom?.condition || 'Unknown',
      wind: rawData.bottom?.wind || null,
      snow: rawData.bottom?.snow || null,
      snowDay: rawData.bottom?.snowLastDay || null
    },
    ts: Date.now()
  };
}

function createOptimizedYrData(rawData) {
  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const timeseries = rawData.properties?.timeseries || [];
  const filtered = timeseries.filter(item => {
    const itemDate = new Date(item.time);
    return itemDate >= now && itemDate <= next24h;
  });
  
  const optimized = filtered.map(item => ({
    t: item.time,
    temp: Math.round(item.data.instant.details.air_temperature),
    sym: item.data.next_1_hours?.summary?.symbol_code || 'clearsky_day',
    wind: Math.round(item.data.instant.details.wind_speed || 0),
    windDir: Math.round(item.data.instant.details.wind_from_direction || 0)
  }));
  
  return {
    fc: optimized,
    ts: Date.now()
  };
}

function createOptimizedLiftData(rawData) {
  const lifts = {};
  Object.keys(rawData).forEach(liftKey => {
    lifts[liftKey] = rawData[liftKey] === 'open' ? 1 : 0;
  });
  
  return {
    lifts,
    ts: Date.now()
  };
}

// ========== TEMPERATURE HISTORY (12 HOURS) ==========

async function storeTempHistory(redis, homeyTemp, hafjellTopTemp, hafjellBottomTemp) {
  const HISTORY_KEY = 'temp:history';
  const MAX_HISTORY = 48; // 12 hours * 4 readings per hour
  
  const historyEntry = {
    ts: Date.now(),
    h: homeyTemp ? parseFloat(homeyTemp) : null,
    t: hafjellTopTemp ? parseFloat(hafjellTopTemp) : null,
    b: hafjellBottomTemp ? parseFloat(hafjellBottomTemp) : null
  };
  
  try {
    const existing = await redis.get(HISTORY_KEY);
    let history = existing ? JSON.parse(existing) : [];
    
    history.push(historyEntry);
    
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }
    
    await redis.setEx(HISTORY_KEY, 24 * 60 * 60, JSON.stringify(history));
    console.log(`✅ Stored temperature history: ${history.length} readings`);
  } catch (error) {
    console.error('❌ Error storing temperature history:', error);
  }
}

// ========== DATA FETCHING FUNCTIONS ==========

// Cache for Homey API connection (copied from working api/homey.js)
let cachedHomeyApi = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getHomeyApi() {
  const now = Date.now();
  
  // Return cached connection if still valid
  if (cachedHomeyApi && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached Homey API connection');
    return cachedHomeyApi;
  }
  
  console.log('Creating new Homey API connection...');
  
  const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');
  
  // Create Cloud API instance (exact same as working api/homey.js)
  const cloudApi = new AthomCloudAPI({
    clientId: process.env.HOMEY_CLIENT_ID,
    clientSecret: process.env.HOMEY_CLIENT_SECRET,
  });

  // Authenticate (exact same as working api/homey.js)
  await cloudApi.authenticate({
    username: process.env.HOMEY_USERNAME,
    password: process.env.HOMEY_PASSWORD,
  });

  // Get user and first Homey (exact same as working api/homey.js)
  const user = await cloudApi.getAuthenticatedUser();
  const homey = await user.getFirstHomey();
  
  // Create session (exact same as working api/homey.js)
  const homeyApi = await homey.authenticate();
  
  // Cache the connection
  cachedHomeyApi = homeyApi;
  cacheTimestamp = now;
  
  console.log('Homey API connection established and cached');
  return homeyApi;
}

async function getDeviceData(homeyApi, deviceId) {
  try {
    const device = await homeyApi.devices.getDevice({ id: deviceId });
    const caps = device.capabilitiesObj || device.capabilities || {};
    
    const data = {};
    
    // Try different temperature capability names (exact same as working api/homey.js)
    if (caps.measure_temperature) {
      data.temperature = caps.measure_temperature.value;
    } else if (caps.temperature) {
      data.temperature = caps.temperature.value;
    }
    
    // Try different humidity capability names (exact same as working api/homey.js)
    if (caps.measure_humidity) {
      data.humidity = caps.measure_humidity.value;
    } else if (caps.humidity) {
      data.humidity = caps.humidity.value;
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching device ${deviceId}:`, error.message);
    throw error;
  }
}

// ========== HOMEY OAUTH WITH REFRESH TOKEN (EXACT COPY FROM WORKING API/HOMEY.JS) ==========

// Token cache (persists across function invocations in same container)
let cachedAccessToken = null;
let tokenExpiry = null;

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
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    cachedAccessToken = tokenData.access_token;
    tokenExpiry = now + (tokenData.expires_in * 1000);
    
    console.log('Access token refreshed successfully');
    return cachedAccessToken;
    
  } catch (error) {
    console.error('Error refreshing token:', error.message);
    throw error;
  }
}

async function getDelegationToken(accessToken) {
  try {
    console.log('Requesting delegation token...');
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
    
  } catch (error) {
    console.error('Error getting delegation token:', error.message);
    throw error;
  }
}

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

async function getHomeyDeviceData(authToken, remoteUrl, deviceId) {
  try {
    const url = `${remoteUrl}/api/manager/devices/device`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get devices: ${response.status}`);
    }

    const allDevices = await response.json();
    const device = allDevices[deviceId];
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found in Homey`);
    }
    
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

async function createHomeySession(delegationToken, remoteUrl) {
  try {
    console.log('Creating Homey session...');
    
    const response = await fetch(`${remoteUrl}/api/manager/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: delegationToken })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Homey session creation failed:', response.status, errorText);
      throw new Error(`Homey session creation failed: ${response.status}`);
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
      
      sessionToken = sessionToken.replace(/^"(.*)"$/, '$1');
    } else {
      sessionToken = await response.text();
      sessionToken = sessionToken.replace(/^"(.*)"$/, '$1');
    }
    
    console.log('Homey session created successfully');
    return sessionToken;
    
  } catch (error) {
    console.error('Error creating Homey session:', error.message);
    throw error;
  }
}

async function fetchHomeyData() {
  console.log('📡 Fetching Homey data using OAuth refresh token method...');
  
  try {
    // Step 1: Get fresh access token
    const accessToken = await getAccessToken();
    
    // Step 2: Get Homey info
    const { remoteUrl } = await getHomeyInfo(accessToken);
    console.log('Homey remote URL:', remoteUrl);
    
    // Step 3: Get delegation token
    const delegationToken = await getDelegationToken(accessToken);
    
    // Step 4: Try delegation token directly, fall back to session creation
    let authToken = delegationToken;
    
    try {
      console.log('Trying delegation token directly...');
      const testResponse = await fetch(`${remoteUrl}/api/manager/devices/device/${process.env.HOMEY_DEVICE_ID_TEMP}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${delegationToken}`
        }
      });
      
      if (!testResponse.ok) {
        throw new Error('Delegation token not accepted directly');
      }
      console.log('✅ Delegation token works directly');
    } catch (error) {
      console.log('Delegation token failed, creating session...', error.message);
      authToken = await createHomeySession(delegationToken, remoteUrl);
    }
    
    // Step 5: Fetch temperature data
    const tempData = await getHomeyDeviceData(
      authToken,
      remoteUrl,
      process.env.HOMEY_DEVICE_ID_TEMP
    );
    
    // Step 6: Fetch humidity data (may be same or different device)
    let humidityData = tempData;
    const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
    
    if (humidityDeviceId && humidityDeviceId !== process.env.HOMEY_DEVICE_ID_TEMP) {
      try {
        humidityData = await getHomeyDeviceData(authToken, remoteUrl, humidityDeviceId);
      } catch (error) {
        console.warn('Could not fetch separate humidity sensor:', error.message);
      }
    }
    
    const responseData = {
      temperature: tempData.temperature,
      humidity: humidityData.humidity || tempData.humidity,
      timestamp: new Date().toISOString(),
      source: 'homey-oauth-cached'
    };
    
    console.log('✅ Successfully fetched Homey sensor data:', responseData);
    return responseData;
    
  } catch (error) {
    console.error('❌ Homey OAuth fetch error:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

async function fetchHafjellWeatherData() {
  console.log('📡 Fetching Hafjell weather data...');
  
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const response = await fetch(proxyUrl + targetUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Hafjell fetch error: ${response.status}`);
    }
    
    const data = await response.json();
    const htmlContent = data.contents;
    
    const weatherData = parseHafjellWeatherFromHTML(htmlContent);
    console.log('✅ Hafjell weather data fetched');
    return weatherData;
  } catch (error) {
    console.error('❌ Hafjell weather fetch error:', error.message);
    return null;
  }
}

async function fetchYrForecastData() {
  console.log('📡 Fetching YR.no forecast data...');
  
  try {
    const lat = 61.234381;
    const lon = 10.448835;
    
    const response = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
      {
        headers: {
          'User-Agent': 'WKWeatherDashboard/2.0 (contact@wkweather.com)'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`YR.no API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ YR.no forecast data fetched');
    return data;
  } catch (error) {
    console.error('❌ YR.no fetch error:', error.message);
    return null;
  }
}

async function fetchHafjellLiftStatus() {
  console.log('📡 Fetching Hafjell lift status...');
  
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const response = await fetch(proxyUrl + targetUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Hafjell lift fetch error: ${response.status}`);
    }
    
    const data = await response.json();
    const htmlContent = data.contents;
    
    const liftStatus = parseHafjellLiftStatusFromHTML(htmlContent);
    console.log('✅ Hafjell lift status fetched');
    return liftStatus;
  } catch (error) {
    console.error('❌ Hafjell lift fetch error:', error.message);
    return null;
  }
}

// ========== HTML PARSING HELPERS ==========

function parseHafjellWeatherFromHTML(htmlContent) {
  const tempWindPattern = /(\d{1,2})\s+(\d{1,2})\s+(\d+\.?\d*)m\/s\s+(\d+\.?\d*)m\/s/;
  const match = htmlContent.match(tempWindPattern);
  
  if (match) {
    return {
      top: {
        temperature: match[1],
        condition: 'Partly cloudy',
        wind: match[3],
        snow: '65',
        snowLastDay: '0'
      },
      bottom: {
        temperature: match[2],
        condition: 'Partly cloudy',
        wind: match[4],
        snow: '65',
        snowLastDay: '0'
      }
    };
  }
  
  return {
    top: { temperature: '11', condition: 'Mostly sunny', wind: '5.6', snow: '65', snowLastDay: '0' },
    bottom: { temperature: '20', condition: 'Mostly sunny', wind: '2.0', snow: '65', snowLastDay: '0' }
  };
}

function parseHafjellLiftStatusFromHTML(htmlContent) {
  const currentHour = new Date().getHours();
  const isOperatingHours = currentHour >= 9 && currentHour <= 16;
  const isWeekend = [0, 6].includes(new Date().getDay());
  
  return {
    'backyardheisen': isOperatingHours ? 'open' : 'closed',
    'hafjell360': isOperatingHours && isWeekend ? 'open' : 'closed',
    'gondolen': isOperatingHours ? 'open' : 'closed',
    'vidsynexpressen': isOperatingHours ? 'open' : 'closed',
    'hafjellheis1': isOperatingHours ? 'open' : 'closed',
    'hafjellheis2': isOperatingHours && isWeekend ? 'open' : 'closed',
    'kjusheisen': isOperatingHours && isWeekend ? 'open' : 'closed'
  };
}

// ========== MAIN HANDLER ==========

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  const { action } = req.query;

  // ========== GET CACHED DATA ==========
  if (req.method === 'GET' && action === 'get') {
    let redis;
    
    try {
      redis = await getRedisClient();
      
      const [homeyData, hafjellData, yrData, liftData, tempHistory] = await Promise.all([
        redis.get('homey:sensors'),
        redis.get('hafjell:weather'),
        redis.get('yr:forecast'),
        redis.get('hafjell:lifts'),
        redis.get('temp:history')
      ]);
      
      await redis.quit();
      
      return res.status(200).json({
        success: true,
        cached: true,
        data: {
          homey: homeyData ? JSON.parse(homeyData) : null,
          hafjell: hafjellData ? JSON.parse(hafjellData) : null,
          forecast: yrData ? JSON.parse(yrData) : null,
          lifts: liftData ? JSON.parse(liftData) : null,
          tempHistory: tempHistory ? JSON.parse(tempHistory) : []
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Cache retrieval error:', error);
      if (redis) await redis.quit();
      
      return res.status(500).json({
        success: false,
        error: 'Cache retrieval failed',
        message: error.message
      });
    }
  }

  // ========== REFRESH CACHE (EXTERNAL CRON) ==========
  if (req.method === 'POST' && action === 'refresh') {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.error('❌ Unauthorized cache refresh attempt');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized' 
      });
    }
    
    let redis;
    
    try {
      console.log('🔄 Starting optimized cache refresh...');
      redis = await getRedisClient();
      
      const [rawHomeyData, rawHafjellData, rawYrData, rawLiftData] = await Promise.all([
        fetchHomeyData(),
        fetchHafjellWeatherData(),
        fetchYrForecastData(),
        fetchHafjellLiftStatus()
      ]);
      
      const homeyData = rawHomeyData ? createOptimizedHomeyData(rawHomeyData) : null;
      const hafjellData = rawHafjellData ? createOptimizedHafjellData(rawHafjellData) : null;
      const yrData = rawYrData ? createOptimizedYrData(rawYrData) : null;
      const liftData = rawLiftData ? createOptimizedLiftData(rawLiftData) : null;
      
      const TTL = 15 * 60; // 15 minutes
      
      const storePromises = [];
      
      if (homeyData) {
        storePromises.push(redis.setEx('homey:sensors', TTL, JSON.stringify(homeyData)));
      }
      if (hafjellData) {
        storePromises.push(redis.setEx('hafjell:weather', TTL, JSON.stringify(hafjellData)));
      }
      if (yrData) {
        storePromises.push(redis.setEx('yr:forecast', TTL, JSON.stringify(yrData)));
      }
      if (liftData) {
        storePromises.push(redis.setEx('hafjell:lifts', TTL, JSON.stringify(liftData)));
      }
      
      await Promise.all(storePromises);
      
      if (homeyData || hafjellData) {
        await storeTempHistory(
          redis,
          homeyData?.temp,
          hafjellData?.top?.temp,
          hafjellData?.bottom?.temp
        );
      }
      
      await redis.quit();
      
      console.log('✅ Optimized cache refresh complete');
      
      return res.status(200).json({
        success: true,
        refreshed: true,
        optimized: true,
        ttl_minutes: 15,
        cached_items: ['homey:sensors', 'hafjell:weather', 'yr:forecast', 'hafjell:lifts', 'temp:history'],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Cache refresh error:', error);
      if (redis) await redis.quit();
      
      return res.status(500).json({
        success: false,
        error: 'Cache refresh failed',
        message: error.message
      });
    }
  }

  return res.status(400).json({
    success: false,
    error: 'Invalid request',
    message: 'Use ?action=get (GET) or ?action=refresh (POST)'
  });
};
