/**
 * Vercel Serverless Function: Weather Data Cache (NO REDIS - TEMPORARY)
 * 
 * This version works WITHOUT Redis to unblock deployment
 * Always fetches fresh data
 * Includes in-memory temperature history for 12-hour trend
 */

const HAFJELL_RESORT_ID = 12;

// In-memory temperature history (persists during function warm state)
// Note: This resets when function goes cold (~15 min idle)
let temperatureHistory = [];
const MAX_HISTORY_POINTS = 144; // 12 hours at 5-min intervals

function addToHistory(homeyTemp, topTemp, bottomTemp) {
  const entry = {
    ts: new Date().toISOString(),
    h: homeyTemp ? parseFloat(homeyTemp) : null,
    t: topTemp ? parseFloat(topTemp) : null,
    b: bottomTemp ? parseFloat(bottomTemp) : null
  };
  
  temperatureHistory.push(entry);
  
  // Keep only last 144 points (12 hours)
  if (temperatureHistory.length > MAX_HISTORY_POINTS) {
    temperatureHistory.shift();
  }
  
  console.log(`📊 History: ${temperatureHistory.length} points`);
  return temperatureHistory;
}

// ========== FNUGG API ==========

async function getFnuggData() {
  console.log('📡 Fetching from Fnugg API...');
  
  try {
    const url = 'https://api.fnugg.no/search?size=150';
    
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'WKWeatherDashboard/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const hits = data.hits?.hits || [];
    const total = data.hits?.total || 0;
    
    console.log(`✅ Received ${hits.length} resorts out of ${total} total`);
    
    const hafjellHit = hits.find(hit => {
      const id = hit._source?.id;
      const name = hit._source?.name || '';
      return id === HAFJELL_RESORT_ID || 
             id === '12' || 
             name.toLowerCase().includes('hafjell');
    });
    
    if (!hafjellHit) {
      throw new Error('Hafjell not found in API results');
    }
    
    const resort = hafjellHit._source;
    console.log(`✅ Found Hafjell: ${resort.name} (ID: ${resort.id})`);
    
    // Extract complete snow data
    const topSnow = resort.conditions?.combined?.top?.snow || {};
    const bottomSnow = resort.conditions?.combined?.bottom?.snow || {};
    
    return {
      top: {
        temperature: resort.conditions?.combined?.top?.temperature?.value?.toString() || '--',
        condition: resort.conditions?.combined?.top?.condition_description || 'Loading...',
        wind: resort.conditions?.combined?.top?.wind?.mps?.toString() || '0.0',
        snow: {
          depth_terrain: topSnow.depth_terrain?.toString() || '0',
          depth_slope: topSnow.depth_slope?.toString() || '0',
          today: topSnow.today?.toString() || '0',
          week: topSnow.week?.toString() || '0',
          season: topSnow.season?.toString() || '0'
        }
      },
      bottom: {
        temperature: resort.conditions?.combined?.bottom?.temperature?.value?.toString() || '--',
        condition: resort.conditions?.combined?.bottom?.condition_description || 'Loading...',
        wind: resort.conditions?.combined?.bottom?.wind?.mps?.toString() || '0.0',
        snow: {
          depth_terrain: bottomSnow.depth_terrain?.toString() || '0',
          depth_slope: bottomSnow.depth_slope?.toString() || '0',
          today: bottomSnow.today?.toString() || '0',
          week: bottomSnow.week?.toString() || '0',
          season: bottomSnow.season?.toString() || '0'
        }
      },
      lifts: parseLiftStatus(resort.lifts),
      timestamp: new Date().toISOString()
    };
    
  } catch (err) {
    console.error(`❌ Fnugg error:`, err.message);
    throw err;
  }
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
  console.log('📡 Fetching YR.no for Mosetertoppen Skistadion (813m)...');
  
  // Mosetertoppen Skistadion coordinates - 813m elevation
  // This is the cross-country ski stadium, NOT the gondola top station
  const response = await fetch(
    'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=61.2430&lon=10.4900',
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
    const homeyUrl = process.env.HOMEY_API_URL || 'https://wksnowdashboard.wvsailing.co.uk/api/homey.js';
    const response = await fetch(homeyUrl);
    
    if (!response.ok) {
      console.log('⚠️ Homey unavailable');
      return { temperature: null, humidity: null };
    }
    
    const data = await response.json();
    return {
      temperature: data.temperature?.toString() || null,
      humidity: data.humidity?.toString() || null,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.log('⚠️ Homey error:', err.message);
    return { temperature: null, humidity: null };
  }
}

// ========== FETCH ALL ==========

async function fetchAllData() {
  console.log('🔄 Fetching all data sources...');
  
  const [fnugg, yr, homey] = await Promise.all([
    getFnuggData(),
    getYrForecast(),
    getHomeyData()
  ]);
  
  return {
    hafjell: fnugg,
    yr: yr,
    homey: homey,
    lastUpdate: new Date().toISOString(),
    tempHistory: addToHistory(
      homey.temperature,
      fnugg.top.temperature,
      fnugg.bottom.temperature
    )
  };
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
    
    // Check auth for manual refresh
    if (action === 'refresh') {
      const authHeader = req.headers.authorization;
      const expectedToken = process.env.CACHE_AUTH_TOKEN;
      const providedToken = authHeader?.replace('Bearer ', '') || token;
      
      if (expectedToken && providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }
    
    console.log('✅ Fetching fresh data...');
    const data = await fetchAllData();
    
    return res.status(200).json({
      success: true,
      data,
      cached: false,
      note: 'Redis disabled - fetching fresh data'
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
