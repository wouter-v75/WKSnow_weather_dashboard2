/**
 * Vercel Serverless Function: Weather Data Cache with Fnugg API
 * 
 * FINAL VERSION - Uses api.fnugg.no for Hafjell data
 * 
 * Environment variables required in Vercel:
 * - REDIS_URL (Redis Cloud connection string)
 * - CACHE_AUTH_TOKEN (optional - for manual refresh endpoint)
 */

const redis = require('redis');

// Cache configuration
const CACHE_KEY = 'wk:weather:cache';
const CACHE_TTL = 900; // 15 minutes
const HAFJELL_RESORT_ID = 12;

let redisClient = null;

async function getRedisClient() {
  if (redisClient) return redisClient;
  
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL not set');
    return null;
  }
  
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true, rejectUnauthorized: false }
  });
  
  redisClient.on('error', (err) => console.error('Redis Error:', err));
  await redisClient.connect();
  return redisClient;
}

// ========== FNUGG API ==========

async function getFnuggData() {
  console.log('📡 Fetching from Fnugg API...');
  
  const response = await fetch(`https://api.fnugg.no/search?id=${HAFJELL_RESORT_ID}`, {
    headers: { 'User-Agent': 'WKWeatherDashboard/1.0' }
  });
  
  if (!response.ok) throw new Error(`Fnugg API: ${response.status}`);
  
  const data = await response.json();
  const resort = data.hits?.hits?.[0]?._source;
  
  if (!resort) throw new Error('No resort data');
  
  return {
    top: {
      temperature: resort.conditions?.combined?.top?.temperature?.value?.toString() || '--',
      condition: resort.conditions?.combined?.top?.condition_description || 'Loading...',
      wind: resort.conditions?.combined?.top?.wind?.mps?.toString() || '0.0',
      snow: resort.conditions?.combined?.top?.snow?.depth_terrain?.toString() || '0',
      snowLastDay: resort.conditions?.combined?.top?.snow?.today?.toString() || '0',
      snowWeek: resort.conditions?.combined?.top?.snow?.week?.toString() || '15'
    },
    bottom: {
      temperature: resort.conditions?.combined?.bottom?.temperature?.value?.toString() || '--',
      condition: resort.conditions?.combined?.bottom?.condition_description || 'Loading...',
      wind: resort.conditions?.combined?.bottom?.wind?.mps?.toString() || '0.0',
      snow: resort.conditions?.combined?.bottom?.snow?.depth_terrain?.toString() || '0',
      snowLastDay: resort.conditions?.combined?.bottom?.snow?.today?.toString() || '0'
    },
    lifts: parseLiftStatus(resort.lifts),
    timestamp: new Date().toISOString()
  };
}

function parseLiftStatus(liftsData) {
  const lifts = {};
  const mappings = {
    'backyardheisen': ['Backyardheisen', 'N. Backyardheisen'],
    'hafjell360': ['Hafjell 360', 'O. Hafjell 360'],
    'gondolen': ['Gondolen', 'L. Gondolen'],
    'vidsynexpressen': ['Vidsynexpressen', 'H. Vidsynexpressen'],
    'hafjellheis1': ['Hafjellheis 1', 'C. Hafjellheis 1'],
    'hafjellheis2': ['Hafjellheis 2', 'E. Hafjellheis 2'],
    'kjusheisen': ['Kjusheisen', 'D. Kjusheisen']
  };
  
  if (!liftsData?.list) return lifts;
  
  liftsData.list.forEach(lift => {
    const status = lift.status === '1' || lift.status === 1 ? 'open' : 'closed';
    for (const [id, names] of Object.entries(mappings)) {
      if (names.some(n => lift.name.includes(n.replace(/^[A-Z]\. /, '')))) {
        lifts[id] = status;
        break;
      }
    }
  });
  
  return lifts;
}

// ========== YR.NO ==========

async function getYrForecast() {
  console.log('📡 Fetching YR.no...');
  
  const response = await fetch(
    'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=61.2344&lon=10.4488',
    { headers: { 'User-Agent': 'WKWeatherDashboard/1.0 (wk@example.com)' } }
  );
  
  if (!response.ok) throw new Error(`YR.no: ${response.status}`);
  
  const data = await response.json();
  return {
    timeseries: data.properties.timeseries.slice(0, 48),
    timestamp: new Date().toISOString()
  };
}

// ========== HOMEY ==========

async function getHomeyData() {
  console.log('📡 Fetching Homey...');
  
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/homey`);
    if (!response.ok) throw new Error(`Homey: ${response.status}`);
    
    const data = await response.json();
    return {
      temperature: data.temperature || null,
      humidity: data.humidity || null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Homey error:', error.message);
    return {
      temperature: null,
      humidity: null,
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

// ========== CACHE REFRESH ==========

async function refreshCache() {
  console.log('🔄 Refreshing cache...');
  
  const [fnuggData, yrData, homeyData] = await Promise.all([
    getFnuggData(),
    getYrForecast(),
    getHomeyData()
  ]);
  
  const cacheData = {
    hafjell: fnuggData,
    yr: yrData,
    homey: homeyData,
    lastUpdate: new Date().toISOString(),
    nextUpdate: new Date(Date.now() + CACHE_TTL * 1000).toISOString()
  };
  
  const client = await getRedisClient();
  if (client) {
    await client.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(cacheData));
    console.log('✅ Cache updated');
  }
  
  return cacheData;
}

// ========== HANDLER ==========

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  try {
    const { action, token } = req.query;
    
    // Manual refresh endpoint
    if (action === 'refresh') {
      if (process.env.CACHE_AUTH_TOKEN && token !== process.env.CACHE_AUTH_TOKEN) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      const data = await refreshCache();
      return res.status(200).json({
        success: true,
        message: 'Cache refreshed',
        data,
        timestamp: new Date().toISOString()
      });
    }
    
    // Normal fetch
    const client = await getRedisClient();
    
    if (!client) {
      console.log('⚠️ Redis unavailable, fetching fresh');
      const data = await refreshCache();
      return res.status(200).json(data);
    }
    
    const cachedData = await client.get(CACHE_KEY);
    
    if (cachedData) {
      console.log('✅ Serving from cache');
      return res.status(200).json(JSON.parse(cachedData));
    }
    
    console.log('⚠️ Cache miss, refreshing');
    const data = await refreshCache();
    return res.status(200).json(data);
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
