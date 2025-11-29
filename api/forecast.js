/**
 * Vercel Serverless Function: YR.no Forecast with Redis Cloud Caching
 * 
 * Compatible with your existing Redis Cloud database
 * Uses REDIS_URL environment variable (already configured)
 */

const { createClient } = require('redis');

const CACHE_KEY = 'yrno_forecast';
const CACHE_DURATION = 15 * 60; // 15 minutes

const HAFJELL_LAT = 61.234381;
const HAFJELL_LON = 10.448835;

let redisClient = null;

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
    if (!process.env.REDIS_URL) {
      console.log('Redis not configured, fetching fresh data');
      const freshData = await fetchYRnoData();
      return res.status(200).json(freshData);
    }

    const cachedData = await getCachedData();
    
    if (cachedData) {
      console.log('Returning cached YR.no forecast data');
      return res.status(200).json(cachedData);
    }

    console.log('Cache miss, fetching fresh YR.no data');
    const freshData = await fetchYRnoData();
    await setCachedData(freshData);
    
    return res.status(200).json(freshData);

  } catch (error) {
    console.error('Forecast API Error:', error);
    
    const staleData = await getCachedData(true);
    if (staleData) {
      console.log('Returning stale cache due to error');
      return res.status(200).json({
        ...staleData,
        warning: 'Using cached data due to API error'
      });
    }
    
    return res.status(500).json({
      error: 'Failed to fetch forecast data',
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
      const cacheAge = (Date.now() - new Date(cachedData.cachedAt).getTime()) / 1000;
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
    const cacheData = {
      ...data,
      cachedAt: new Date().toISOString()
    };

    const redis = await getRedisClient();
    await redis.setEx(CACHE_KEY, CACHE_DURATION * 2, JSON.stringify(cacheData));
    console.log('YR.no data cached successfully');
  } catch (error) {
    console.error('Error caching data:', error);
  }
}

async function fetchYRnoData() {
  const response = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HAFJELL_LAT}&lon=${HAFJELL_LON}`,
    {
      headers: {
        'User-Agent': 'WKWeatherDashboard/1.0 (wk@example.com)'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`YR.no API error: ${response.status}`);
  }

  const fullData = await response.json();
  const optimizedData = extractEssentialData(fullData);
  
  return optimizedData;
}

function extractEssentialData(fullData) {
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString();
  
  const todayForecasts = fullData.properties.timeseries
    .filter(item => {
      const itemDate = new Date(item.time);
      return itemDate.toDateString() === today && itemDate > now;
    })
    .slice(0, 6)
    .map(item => ({
      time: item.time,
      temperature: Math.round(item.data.instant.details.air_temperature),
      symbol: item.data.next_1_hours?.summary?.symbol_code || 'clearsky_day',
      windSpeed: Math.round(item.data.instant.details.wind_speed || 0),
      windDirection: item.data.instant.details.wind_from_direction
    }));

  const tomorrowForecasts = fullData.properties.timeseries
    .filter(item => {
      const itemDate = new Date(item.time);
      const itemHour = itemDate.getHours();
      return itemDate.toDateString() === tomorrow && 
             itemHour >= 6 && itemHour <= 18;
    })
    .filter((item, index) => index % 2 === 0)
    .slice(0, 5)
    .map(item => ({
      time: item.time,
      temperature: Math.round(item.data.instant.details.air_temperature),
      symbol: item.data.next_1_hours?.summary?.symbol_code || 'clearsky_day',
      windSpeed: Math.round(item.data.instant.details.wind_speed || 0),
      windDirection: item.data.instant.details.wind_from_direction
    }));

  return {
    today: todayForecasts,
    tomorrow: tomorrowForecasts,
    timestamp: new Date().toISOString(),
    source: 'yr.no'
  };
}
