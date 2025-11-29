/**
 * Vercel Serverless Function: Homey API with Redis Cloud Caching
 * 
 * Compatible with your existing Redis Cloud database
 * Uses REDIS_URL environment variable (already configured)
 * 
 * Environment variables required:
 * - REDIS_URL (already set by Vercel Redis Cloud)
 * - HOMEY_CLIENT_ID
 * - HOMEY_CLIENT_SECRET
 * - HOMEY_USERNAME
 * - HOMEY_PASSWORD
 * - HOMEY_DEVICE_ID_TEMP
 * - HOMEY_DEVICE_ID_HUMIDITY (optional)
 */

const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');
const { createClient } = require('redis');

const CACHE_KEY = 'homey_current';
const HISTORY_KEY = 'homey_history';
const CACHE_DURATION = 15 * 60; // 15 minutes in seconds
const MAX_HISTORY_POINTS = 12;

// Redis client (reused across invocations)
let redisClient = null;
let cachedHomeyApi = null;
let cacheTimestamp = null;
const API_CACHE_DURATION = 5 * 60 * 1000;

async function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) return new Error('Max retries reached');
          return Math.min(retries * 100, 3000);
        }
      }
    });
    
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    await redisClient.connect();
    console.log('✅ Connected to Redis Cloud');
  }
  return redisClient;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requiredEnvVars = [
      'HOMEY_CLIENT_ID',
      'HOMEY_CLIENT_SECRET',
      'HOMEY_USERNAME',
      'HOMEY_PASSWORD',
      'HOMEY_DEVICE_ID_TEMP'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      return res.status(500).json({
        error: 'Configuration error',
        message: `Missing environment variables: ${missingVars.join(', ')}`
      });
    }

    const hasRedis = process.env.REDIS_URL;

    if (!hasRedis) {
      console.log('Redis not configured, fetching fresh data only');
      const freshData = await fetchHomeyData();
      return res.status(200).json({
        current: freshData,
        history: []
      });
    }

    // Try to get cached data
    const cachedData = await getCachedData();
    
    if (cachedData) {
      console.log('Returning cached Homey data');
      return res.status(200).json(cachedData);
    }

    // No cache, fetch fresh data
    console.log('Cache miss, fetching fresh Homey data');
    const freshData = await fetchHomeyData();
    
    // Get existing history and update it
    const history = await getTemperatureHistory();
    const updatedHistory = await updateHistory(history, freshData.temperature);
    
    const responseData = {
      current: freshData,
      history: updatedHistory,
      timestamp: new Date().toISOString()
    };
    
    // Cache the data
    await setCachedData(responseData);
    
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('Homey API Error:', error);
    
    // Try to return stale cache if available
    const staleData = await getCachedData(true);
    if (staleData) {
      console.log('Returning stale cache due to error');
      return res.status(200).json({
        ...staleData,
        warning: 'Using cached data due to API error'
      });
    }
    
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function getCachedData(ignoreExpiry = false) {
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(CACHE_KEY);
    
    if (!cached) {
      return null;
    }

    const cachedData = JSON.parse(cached);
    
    if (!ignoreExpiry) {
      const cacheAge = (Date.now() - new Date(cachedData.timestamp).getTime()) / 1000;
      if (cacheAge > CACHE_DURATION) {
        console.log(`Cache expired (${Math.round(cacheAge)}s old)`);
        return null;
      }
    }
    
    return cachedData;
  } catch (error) {
    console.error('Error getting cached data:', error);
    return null;
  }
}

async function setCachedData(data) {
  try {
    const redis = await getRedisClient();
    await redis.setEx(CACHE_KEY, CACHE_DURATION * 2, JSON.stringify(data));
    console.log('Homey data cached successfully');
  } catch (error) {
    console.error('Error caching data:', error);
  }
}

async function getTemperatureHistory() {
  try {
    const redis = await getRedisClient();
    const history = await redis.get(HISTORY_KEY);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    console.error('Error getting history:', error);
    return [];
  }
}

async function updateHistory(currentHistory, newTemperature) {
  if (newTemperature === null || newTemperature === undefined) {
    return currentHistory;
  }

  const now = new Date();
  const newPoint = {
    time: now.toISOString(),
    temperature: parseFloat(newTemperature),
    label: now.toLocaleTimeString('en-NO', { hour: '2-digit', minute: '2-digit' })
  };

  let updatedHistory = [...currentHistory, newPoint];
  const shouldKeep = updatedHistory.length % 4 === 0 || updatedHistory.length <= MAX_HISTORY_POINTS;
  
  if (!shouldKeep && updatedHistory.length > 1) {
    updatedHistory.splice(-2, 1);
  }

  if (updatedHistory.length > MAX_HISTORY_POINTS) {
    updatedHistory = updatedHistory.slice(-MAX_HISTORY_POINTS);
  }

  try {
    const redis = await getRedisClient();
    await redis.setEx(HISTORY_KEY, 24 * 60 * 60, JSON.stringify(updatedHistory));
    console.log(`History updated: ${updatedHistory.length} points`);
  } catch (error) {
    console.error('Error saving history:', error);
  }

  return updatedHistory;
}

async function getHomeyApi() {
  const now = Date.now();
  
  if (cachedHomeyApi && cacheTimestamp && (now - cacheTimestamp) < API_CACHE_DURATION) {
    console.log('Using cached Homey API connection');
    return cachedHomeyApi;
  }
  
  console.log('Creating new Homey API connection...');
  const cloudApi = new AthomCloudAPI({
    clientId: process.env.HOMEY_CLIENT_ID,
    clientSecret: process.env.HOMEY_CLIENT_SECRET,
  });

  await cloudApi.authenticateWithUsernamePassword({
    username: process.env.HOMEY_USERNAME,
    password: process.env.HOMEY_PASSWORD,
  });

  const user = await cloudApi.getAuthenticatedUser();
  const homey = await user.getFirstHomey();
  const homeyApi = await homey.authenticate();
  
  cachedHomeyApi = homeyApi;
  cacheTimestamp = now;
  
  console.log('Homey API connection established');
  return homeyApi;
}

async function getDeviceData(homeyApi, deviceId) {
  const device = await homeyApi.devices.getDevice({ id: deviceId });
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
}

async function fetchHomeyData() {
  const homeyApi = await getHomeyApi();
  
  const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
  const tempData = await getDeviceData(homeyApi, tempDeviceId);
  
  let humidityData = tempData;
  const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
  
  if (humidityDeviceId && humidityDeviceId !== tempDeviceId) {
    try {
      humidityData = await getDeviceData(homeyApi, humidityDeviceId);
    } catch (error) {
      console.warn('Using temp sensor for humidity:', error.message);
    }
  }
  
  return {
    temperature: tempData.temperature !== undefined ? parseFloat(tempData.temperature.toFixed(1)) : null,
    humidity: (humidityData.humidity || tempData.humidity) !== undefined ? 
      Math.round(humidityData.humidity || tempData.humidity) : null,
    source: 'homey-pro'
  };
}
