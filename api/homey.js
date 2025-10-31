// api/homey.js
// Vercel Serverless Function - Secure Homey API Proxy
// This keeps your Homey tokens SERVER-SIDE (not visible in browser)

export default async function handler(req, res) {
    // Enable CORS for your frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Get credentials from Vercel Environment Variables
    const HOMEY_ACCESS_TOKEN = process.env.HOMEY_ACCESS_TOKEN;
    const HOMEY_DEVICE_ID = process.env.HOMEY_DEVICE_ID;
    const HOMEY_HUMIDITY_DEVICE_ID = process.env.HOMEY_HUMIDITY_DEVICE_ID || HOMEY_DEVICE_ID;
    
    // Check if credentials are configured
    if (!HOMEY_ACCESS_TOKEN || !HOMEY_DEVICE_ID) {
        console.error('Missing Homey credentials in environment variables');
        return res.status(500).json({ 
            error: 'Homey not configured',
            message: 'Please add HOMEY_ACCESS_TOKEN and HOMEY_DEVICE_ID to Vercel environment variables'
        });
    }
    
    try {
        console.log('📡 Fetching data from Homey Cloud API...');
        
        // Fetch temperature sensor data
        const tempResponse = await fetch(
            `https://api.athom.com/device/${HOMEY_DEVICE_ID}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${HOMEY_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!tempResponse.ok) {
            throw new Error(`Homey API error: ${tempResponse.status} ${tempResponse.statusText}`);
        }
        
        const tempDevice = await tempResponse.json();
        console.log('✅ Temperature device data received');
        
        // Extract temperature and humidity
        const data = {
            temperature: null,
            humidity: null,
            deviceName: tempDevice.name || 'Unknown',
            lastUpdated: new Date().toISOString()
        };
        
        // Try to find temperature capability
        if (tempDevice.capabilitiesObj) {
            const tempCapabilities = ['measure_temperature', 'temperature', 'temp'];
            for (const cap of tempCapabilities) {
                if (tempDevice.capabilitiesObj[cap] && tempDevice.capabilitiesObj[cap].value !== undefined) {
                    data.temperature = tempDevice.capabilitiesObj[cap].value;
                    console.log(`✅ Found temperature: ${data.temperature}°C`);
                    break;
                }
            }
            
            // Try to find humidity capability
            const humidityCapabilities = ['measure_humidity', 'humidity', 'hum'];
            for (const cap of humidityCapabilities) {
                if (tempDevice.capabilitiesObj[cap] && tempDevice.capabilitiesObj[cap].value !== undefined) {
                    data.humidity = tempDevice.capabilitiesObj[cap].value;
                    console.log(`✅ Found humidity: ${data.humidity}%`);
                    break;
                }
            }
        }
        
        // Return the data
        console.log('✅ Returning data to frontend');
        return res.status(200).json({
            success: true,
            data: data
        });
        
    } catch (error) {
        console.error('❌ Error fetching Homey data:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to fetch data from Homey Cloud API'
        });
    }
}
