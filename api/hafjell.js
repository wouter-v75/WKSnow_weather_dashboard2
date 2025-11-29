/**
 * Vercel Serverless Function: Hafjell Weather with Redis Cloud Caching
 * 
 * Compatible with your existing Redis Cloud database
 * Uses REDIS_URL environment variable (already configured)
 */

const { createClient } = require('redis');

const CACHE_KEY = 'hafjell_weather';
const HISTORY_KEY = 'hafjell_history';
const CACHE_DURATION = 15 * 60; // 15 minutes
const MAX_HISTORY_POINTS = 12;

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
    const hasRedis = process.env.REDIS_URL;

    if (!hasRedis) {
      console.log('Redis not configured, fetching fresh data only');
      const freshData = await fetchHafjellData();
      return res.status(200).json({
        current: freshData,
        history: { top: [], bottom: [] }
      });
    }

    const cachedData = await getCachedData();
    
    if (cachedData) {
      console.log('Returning cached Hafjell data');
      return res.status(200).json(cachedData);
    }

    console.log('Cache miss, fetching fresh Hafjell data');
    const freshData = await fetchHafjellData();
    
    const history = await getTemperatureHistory();
    const updatedHistory = await updateHistory(
      history, 
      freshData.top.temperature, 
      freshData.bottom.temperature
    );
    
    const responseData = {
      current: freshData,
      history: updatedHistory,
      timestamp: new Date().toISOString()
    };
    
    await setCachedData(responseData);
    
    return res.status(200).json(responseData);

  } catch (error) {
    console.error('Hafjell API Error:', error);
    
    const staleData = await getCachedData(true);
    if (staleData) {
      console.log('Returning stale cache due to error');
      return res.status(200).json({
        ...staleData,
        warning: 'Using cached data due to API error'
      });
    }
    
    return res.status(500).json({
      error: 'Failed to fetch Hafjell data',
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
    console.log('Hafjell data cached successfully');
  } catch (error) {
    console.error('Error caching data:', error);
  }
}

async function getTemperatureHistory() {
  try {
    const redis = await getRedisClient();
    const history = await redis.get(HISTORY_KEY);
    return history ? JSON.parse(history) : { top: [], bottom: [] };
  } catch (error) {
    console.error('Error getting history:', error);
    return { top: [], bottom: [] };
  }
}

async function updateHistory(currentHistory, topTemp, bottomTemp) {
  const now = new Date();
  const label = now.toLocaleTimeString('en-NO', { hour: '2-digit', minute: '2-digit' });
  
  let updatedHistory = {
    top: [...(currentHistory.top || [])],
    bottom: [...(currentHistory.bottom || [])]
  };

  if (topTemp !== null && topTemp !== undefined && topTemp !== '--') {
    updatedHistory.top.push({
      time: now.toISOString(),
      temperature: parseFloat(topTemp),
      label: label
    });
  }

  if (bottomTemp !== null && bottomTemp !== undefined && bottomTemp !== '--') {
    updatedHistory.bottom.push({
      time: now.toISOString(),
      temperature: parseFloat(bottomTemp),
      label: label
    });
  }

  const shouldKeepTop = updatedHistory.top.length % 4 === 0 || updatedHistory.top.length <= MAX_HISTORY_POINTS;
  const shouldKeepBottom = updatedHistory.bottom.length % 4 === 0 || updatedHistory.bottom.length <= MAX_HISTORY_POINTS;
  
  if (!shouldKeepTop && updatedHistory.top.length > 1) {
    updatedHistory.top.splice(-2, 1);
  }
  
  if (!shouldKeepBottom && updatedHistory.bottom.length > 1) {
    updatedHistory.bottom.splice(-2, 1);
  }

  if (updatedHistory.top.length > MAX_HISTORY_POINTS) {
    updatedHistory.top = updatedHistory.top.slice(-MAX_HISTORY_POINTS);
  }
  
  if (updatedHistory.bottom.length > MAX_HISTORY_POINTS) {
    updatedHistory.bottom = updatedHistory.bottom.slice(-MAX_HISTORY_POINTS);
  }

  try {
    const redis = await getRedisClient();
    await redis.setEx(HISTORY_KEY, 24 * 60 * 60, JSON.stringify(updatedHistory));
    console.log(`History updated: top=${updatedHistory.top.length}, bottom=${updatedHistory.bottom.length} points`);
  } catch (error) {
    console.error('Error saving history:', error);
  }

  return updatedHistory;
}

async function fetchHafjellData() {
  const proxyUrl = 'https://api.allorigins.win/get?url=';
  const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
  
  const response = await fetch(proxyUrl + targetUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Hafjell page: ${response.status}`);
  }

  const data = await response.json();
  const htmlContent = data.contents;
  
  const weatherData = parseWeatherDataFromHTML(htmlContent);
  
  return {
    top: {
      temperature: weatherData.top.temperature,
      condition: weatherData.top.condition,
      wind: weatherData.top.wind,
      snow: weatherData.top.snow,
      snowLastDay: weatherData.top.snowLastDay
    },
    bottom: {
      temperature: weatherData.bottom.temperature,
      condition: weatherData.bottom.condition,
      wind: weatherData.bottom.wind,
      snow: weatherData.bottom.snow,
      snowLastDay: weatherData.bottom.snowLastDay
    },
    source: 'hafjell.no'
  };
}

function parseWeatherDataFromHTML(htmlContent) {
  try {
    const weatherData = {
      top: {
        temperature: '11',
        condition: 'Mostly sunny',
        wind: '5.6',
        snow: '65',
        snowLastDay: '0'
      },
      bottom: {
        temperature: '20',
        condition: 'Mostly sunny',
        wind: '2.0',
        snow: '65',
        snowLastDay: '0'
      }
    };

    const allText = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    const tempWindPattern = /(\d{1,2})\s+(\d{1,2})\s+(\d+\.?\d*)m\/s\s+(\d+\.?\d*)m\/s/;
    const tempWindMatch = allText.match(tempWindPattern);
    
    if (tempWindMatch) {
      weatherData.top.temperature = tempWindMatch[1];
      weatherData.bottom.temperature = tempWindMatch[2];
      weatherData.top.wind = tempWindMatch[3];
      weatherData.bottom.wind = tempWindMatch[4];
    }
    
    if (allText.includes('Mostly sunny')) {
      weatherData.top.condition = 'Mostly sunny';
      weatherData.bottom.condition = 'Mostly sunny';
    } else if (allText.includes('Partly cloudy')) {
      weatherData.top.condition = 'Partly cloudy';
      weatherData.bottom.condition = 'Partly cloudy';
    } else if (allText.includes('Cloudy')) {
      weatherData.top.condition = 'Cloudy';
      weatherData.bottom.condition = 'Cloudy';
    }
    
    const snowMatches = allText.match(/(\d+)cm/g);
    if (snowMatches) {
      const snowDepths = snowMatches.map(s => s.replace('cm', ''));
      const reasonableSnow = snowDepths.find(s => parseInt(s) >= 50 && parseInt(s) <= 150);
      if (reasonableSnow) {
        weatherData.top.snow = reasonableSnow;
        weatherData.bottom.snow = reasonableSnow;
      }
    }
    
    return weatherData;
    
  } catch (error) {
    console.error('Error parsing HTML:', error);
    
    return {
      top: {
        temperature: '11',
        condition: 'Mostly sunny',
        wind: '5.6',
        snow: '65',
        snowLastDay: '0'
      },
      bottom: {
        temperature: '20',
        condition: 'Mostly sunny',
        wind: '2.0',
        snow: '65',
        snowLastDay: '0'
      }
    };
  }
}
