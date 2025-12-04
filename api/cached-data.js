/**
 * Vercel Serverless Function: Optimized Cache Handler with Fnugg API
 * 
 * Handles cached weather data with Fnugg API integration for Hafjell
 * 
 * Environment variables required:
 * - REDIS_URL (Redis Cloud connection string)
 * - HOMEY_CLIENT_ID, HOMEY_CLIENT_SECRET
 * - HOMEY_USERNAME, HOMEY_PASSWORD
 * - HOMEY_DEVICE_ID_TEMP, HOMEY_DEVICE_ID_HUMIDITY
 * - CACHE_AUTH_TOKEN (for refresh endpoint security)
 */

const redis = require('redis');
const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');

const CACHE_KEY = 'wk:weather:cache';
const CACHE_TTL = 900; // 15 minutes

// Mosetertoppen Skistadion coordinates (813m elevation)
const FORECAST_LAT = 61.2430;
const FORECAST_LON = 10.4900;

// Hafjell resort ID for Fnugg API
const HAFJELL_RESORT_ID = 18; // Hafjell's ID in Fnugg API

let redisClient = null;

// ========== REDIS CONNECTION ==========

async function getRedisClient() {
  if (redisClient) return redisClient;
  
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 10000,
      reconnectStrategy: (retries) => {
        if (retries > 3) return new Error('Max retries reached');
        return Math.min(retries * 100, 3000);
      }
    }
  });
  
  redisClient.on('error', (err) => console.error('Redis Client Error:', err));
  
  await redisClient.connect();
  console.log('✅ Redis connected');
  
  return redisClient;
}

// ========== HOMEY API ==========

async function getHomeyData() {
  console.log('📡 Fetching Homey data...');
  
  try {
    const cloudApi = new AthomCloudAPI({
      clientId: process.env.HOMEY_CLIENT_ID,
      clientSecret: process.env.HOMEY_CLIENT_SECRET,
    });

    await cloudApi.authenticateWithUsernamePassword({
      username: process.env.HOMEY_USERNAME,
      password: process.env.HOMEY_PASSWORD,
    });

    const user = await cloudApi.getAuthenticatedUser();
    const homeys = await user.getHomeys();
    
    if (homeys.length === 0) {
      throw new Error('No Homey devices found');
    }
    
    const homeyApi = await homeys[0].authenticate();
    
    // Get temperature device
    const tempDevice = await homeyApi.devices.getDevice({ 
      id: process.env.HOMEY_DEVICE_ID_TEMP 
    });
    
    const tempCaps = tempDevice.capabilitiesObj || tempDevice.capabilities || {};
    const temp = (tempCaps.measure_temperature || tempCaps.temperature)?.value;
    
    // Get humidity (may be from same or different device)
    let hum = (tempCaps.measure_humidity || tempCaps.humidity)?.value;
    
    if (!hum && process.env.HOMEY_DEVICE_ID_HUMIDITY && 
        process.env.HOMEY_DEVICE_ID_HUMIDITY !== process.env.HOMEY_DEVICE_ID_TEMP) {
      const humDevice = await homeyApi.devices.getDevice({ 
        id: process.env.HOMEY_DEVICE_ID_HUMIDITY 
      });
      const humCaps = humDevice.capabilitiesObj || humDevice.capabilities || {};
      hum = (humCaps.measure_humidity || humCaps.humidity)?.value;
    }
    
    console.log(`✅ Homey: ${temp}°C, ${hum}%`);
    
    return {
      temp: temp ? parseFloat(temp).toFixed(1) : null,
      hum: hum ? Math.round(hum) : null,
      ts: Date.now()
    };
  } catch (error) {
    console.error('❌ Homey error:', error.message);
    return { temp: null, hum: null, ts: Date.now() };
  }
}

// ========== FNUGG API FOR HAFJELL ==========

async function getHafjellDataFromFnugg() {
  console.log('📡 Fetching Hafjell data from Fnugg API...');
  
  try {
    const response = await fetch(`https://api.fnugg.no/resort/${HAFJELL_RESORT_ID}`);
    
    if (!response.ok) {
      throw new Error(`Fnugg API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Fnugg API response received');
    
    // Extract weather conditions
    const conditions = data.conditions || {};
    const topConditions = conditions.top || {};
    const bottomConditions = conditions.bottom || {};
    
    // Extract lift status
    const lifts = data.lifts || [];
    const liftStatus = {};
    
    // Map Fnugg lift names to our dashboard IDs
    const liftMappings = {
      'backyardheisen': ['Backyardheisen'],
      'hafjell360': ['Hafjell 360'],
      'gondolen': ['Gondolen'],
      'vidsynexpressen': ['Vidsynexpressen'],
      'hafjellheis1': ['Hafjellheis 1', 'C. Hafjellheis 1'],
      'hafjellheis2': ['Hafjellheis 2', 'E. Hafjellheis 2'],
      'kjusheisen': ['Kjusheisen', 'D. Kjusheisen']
    };
    
    lifts.forEach(lift => {
      const liftName = lift.name || '';
      for (const [dashboardId, possibleNames] of Object.entries(liftMappings)) {
        if (possibleNames.some(name => liftName.includes(name))) {
          // Fnugg uses true/false for open/closed
          liftStatus[dashboardId] = lift.status?.isOpen ? 1 : 0;
          break;
        }
      }
    });
    
    // Ensure all lifts have a status
    Object.keys(liftMappings).forEach(liftId => {
      if (!(liftId in liftStatus)) {
        liftStatus[liftId] = 0; // Default to closed
      }
    });
    
    const hafjellData = {
      top: {
        temp: topConditions.temperature?.value?.toString() || null,
        cond: topConditions.weather?.description || 'Unknown',
        wind: topConditions.wind?.speed?.toString() || null,
        snow: topConditions.snow?.depth?.toString() || null,
        snowDay: topConditions.snow?.lastDay?.toString() || null
      },
      bottom: {
        temp: bottomConditions.temperature?.value?.toString() || null,
        cond: bottomConditions.weather?.description || 'Unknown',
        wind: bottomConditions.wind?.speed?.toString() || null,
        snow: bottomConditions.snow?.depth?.toString() || null,
        snowDay: bottomConditions.snow?.lastDay?.toString() || null
      },
      ts: Date.now()
    };
    
    console.log('✅ Hafjell from Fnugg:', hafjellData);
    console.log('✅ Lifts from Fnugg:', liftStatus);
    
    return { hafjellData, liftStatus };
  } catch (error) {
    console.error('❌ Fnugg API error:', error.message);
    
    // Return null values on error
    return {
      hafjellData: {
        top: { temp: null, cond: 'Unknown', wind: null, snow: null, snowDay: null },
        bottom: { temp: null, cond: 'Unknown', wind: null, snow: null, snowDay: null },
        ts: Date.now()
      },
      liftStatus: {
        backyardheisen: 0,
        hafjell360: 0,
        gondolen: 0,
        vidsynexpressen: 0,
        hafjellheis1: 0,
        hafjellheis2: 0,
        kjusheisen: 0
      }
    };
  }
}

// ========== YR.NO FORECAST ==========

async function getYrForecast() {
  console.log('📡 Fetching YR.no forecast...');
  
  try {
    const response = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${FORECAST_LAT}&lon=${FORECAST_LON}`,
      {
        headers: {
          'User-Agent': 'WKWeatherDashboard/2.0 ([email protected])'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`YR.no API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Keep only next 48 hours
    const now = new Date();
    const next48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    const timeseries = data.properties?.timeseries || [];
    const filteredTimeseries = timeseries.filter(item => {
      const itemDate = new Date(item.time);
      return itemDate >= now && itemDate <= next48h;
    });
    
    console.log(`✅ YR.no: ${filteredTimeseries.length} forecast entries`);
    
    return {
      data: {
        properties: {
          timeseries: filteredTimeseries
        }
      },
      ts: Date.now()
    };
  } catch (error) {
    console.error('❌ YR.no error:', error.message);
    return { data: { properties: { timeseries: [] } }, ts: Date.now() };
  }
}

// ========== TEMPERATURE HISTORY ==========

async function updateTempHistory(client, outdoor, hafjellTop, hafjellBottom) {
  try {
    const historyKey = 'wk:weather:history';
    
    // Get existing history
    let history = [];
    const existingHistory = await client.get(historyKey);
    if (existingHistory) {
      history = JSON.parse(existingHistory);
    }
    
    // Add new entry
    history.push({
      ts: Date.now(),
      h: outdoor,
      t: hafjellTop,
      b: hafjellBottom
    });
    
    // Keep last 48 entries (12 hours at 15-min intervals)
    if (history.length > 48) {
      history = history.slice(-48);
    }
    
    // Save back to Redis
    await client.set(historyKey, JSON.stringify(history), { EX: 86400 }); // 24 hour TTL
    
    console.log(`✅ Temperature history updated (${history.length} entries)`);
    
    return history;
  } catch (error) {
    console.error('❌ History update error:', error.message);
    return [];
  }
}

// ========== MAIN HANDLER ==========

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  const action = req.query.action || 'get';

  try {
    const client = await getRedisClient();

    // ========== GET CACHED DATA ==========
    if (action === 'get') {
      const cached = await client.get(CACHE_KEY);
      
      if (cached) {
        const data = JSON.parse(cached);
        return res.status(200).json({
          success: true,
          data: data,
          cached: true,
          timestamp: new Date().toISOString()
        });
      } else {
        return res.status(200).json({
          success: false,
          message: 'No cached data available',
          cached: false
        });
      }
    }

    // ========== REFRESH CACHE ==========
    if (action === 'refresh') {
      // Check authorization
      const authHeader = req.headers.authorization;
      const expectedAuth = `Bearer ${process.env.CACHE_AUTH_TOKEN}`;
      
      if (!authHeader || authHeader !== expectedAuth) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      console.log('🔄 Refreshing all data sources...');

      // Fetch all data in parallel
      const [homeyData, fnuggData, forecastData] = await Promise.all([
        getHomeyData(),
        getHafjellDataFromFnugg(),
        getYrForecast()
      ]);

      // Extract Hafjell and lift data from Fnugg
      const { hafjellData, liftStatus } = fnuggData;

      // Update temperature history
      const tempHistory = await updateTempHistory(
        client,
        homeyData.temp ? parseFloat(homeyData.temp) : null,
        hafjellData.top.temp ? parseFloat(hafjellData.top.temp) : null,
        hafjellData.bottom.temp ? parseFloat(hafjellData.bottom.temp) : null
      );

      // Build optimized cache object
      const cacheData = {
        homey: homeyData,
        hafjell: hafjellData,
        forecast: forecastData,
        lifts: {
          lifts: liftStatus,
          ts: Date.now()
        },
        tempHistory: tempHistory,
        lastUpdate: new Date().toISOString()
      };

      // Save to Redis
      await client.set(CACHE_KEY, JSON.stringify(cacheData), { EX: CACHE_TTL });

      console.log('✅ Cache refreshed successfully');

      return res.status(200).json({
        success: true,
        message: 'Cache refreshed',
        data: cacheData,
        timestamp: new Date().toISOString()
      });
    }

    // Invalid action
    return res.status(400).json({
      success: false,
      error: 'Invalid action',
      message: 'Use action=get or action=refresh'
    });

  } catch (error) {
    console.error('❌ Handler error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
