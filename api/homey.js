// api/homey.js - Enhanced version with detailed debugging

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const debugLog = [];
    
    function log(message, data = null) {
        const logEntry = { timestamp: new Date().toISOString(), message };
        if (data) logEntry.data = data;
        debugLog.push(logEntry);
        console.log(`[Homey API] ${message}`, data || '');
    }

    try {
        log('=== Homey API Request Started ===');
        
        // Get Homey configuration from environment variables
        const HOMEY_LOCAL_URL = process.env.HOMEY_LOCAL_URL;
        const HOMEY_BEARER_TOKEN = process.env.HOMEY_BEARER_TOKEN;
        const HOMEY_CLOUD_URL = process.env.HOMEY_CLOUD_URL || 'https://api.athom.com';
        const HOMEY_ACCESS_TOKEN = process.env.HOMEY_ACCESS_TOKEN;
        const HOMEY_ID = process.env.HOMEY_ID;
        const OUTDOOR_TEMP_DEVICE_ID = process.env.OUTDOOR_TEMP_DEVICE_ID;
        const OUTDOOR_HUMIDITY_DEVICE_ID = process.env.OUTDOOR_HUMIDITY_DEVICE_ID || OUTDOOR_TEMP_DEVICE_ID;

        log('Environment variables check', {
            hasLocalUrl: !!HOMEY_LOCAL_URL,
            localUrl: HOMEY_LOCAL_URL ? HOMEY_LOCAL_URL : 'NOT SET',
            hasBearerToken: !!HOMEY_BEARER_TOKEN,
            bearerTokenLength: HOMEY_BEARER_TOKEN ? HOMEY_BEARER_TOKEN.length : 0,
            hasCloudUrl: !!HOMEY_CLOUD_URL,
            cloudUrl: HOMEY_CLOUD_URL,
            hasAccessToken: !!HOMEY_ACCESS_TOKEN,
            accessTokenLength: HOMEY_ACCESS_TOKEN ? HOMEY_ACCESS_TOKEN.length : 0,
            hasHomeyId: !!HOMEY_ID,
            homeyId: HOMEY_ID || 'NOT SET',
            hasTempDeviceId: !!OUTDOOR_TEMP_DEVICE_ID,
            tempDeviceId: OUTDOOR_TEMP_DEVICE_ID || 'NOT SET',
            hasHumidityDeviceId: !!OUTDOOR_HUMIDITY_DEVICE_ID,
            humidityDeviceId: OUTDOOR_HUMIDITY_DEVICE_ID || 'NOT SET'
        });

        // Validate configuration
        if (!OUTDOOR_TEMP_DEVICE_ID) {
            log('ERROR: Device ID not configured');
            return res.status(500).json({ 
                error: 'Homey device ID not configured',
                debugLog,
                temperature: null,
                humidity: null 
            });
        }

        let deviceData = null;
        let apiUsed = 'none';
        let lastError = null;

        // Try local API first if configured
        if (HOMEY_LOCAL_URL && HOMEY_BEARER_TOKEN) {
            try {
                log('Attempting Local API', {
                    url: HOMEY_LOCAL_URL,
                    deviceId: OUTDOOR_TEMP_DEVICE_ID
                });
                
                deviceData = await fetchHomeyLocal(
                    HOMEY_LOCAL_URL, 
                    HOMEY_BEARER_TOKEN, 
                    OUTDOOR_TEMP_DEVICE_ID,
                    OUTDOOR_HUMIDITY_DEVICE_ID,
                    log
                );
                apiUsed = 'local';
                log('Local API SUCCESS', deviceData);
            } catch (localError) {
                lastError = localError.message;
                log('Local API FAILED', { error: localError.message });
            }
        } else {
            log('Local API not configured - skipping');
        }

        // Try cloud API if local failed or not configured
        if (!deviceData && HOMEY_ACCESS_TOKEN) {
            try {
                log('Attempting Cloud API', {
                    url: HOMEY_CLOUD_URL,
                    hasHomeyId: !!HOMEY_ID,
                    deviceId: OUTDOOR_TEMP_DEVICE_ID
                });
                
                if (!HOMEY_ID) {
                    throw new Error('HOMEY_ID not configured for Cloud API');
                }
                
                deviceData = await fetchHomeyCloud(
                    HOMEY_CLOUD_URL,
                    HOMEY_ACCESS_TOKEN,
                    HOMEY_ID,
                    OUTDOOR_TEMP_DEVICE_ID,
                    OUTDOOR_HUMIDITY_DEVICE_ID,
                    log
                );
                apiUsed = 'cloud';
                log('Cloud API SUCCESS', deviceData);
            } catch (cloudError) {
                lastError = cloudError.message;
                log('Cloud API FAILED', { error: cloudError.message });
            }
        } else if (!HOMEY_ACCESS_TOKEN) {
            log('Cloud API not configured - skipping');
        }

        if (!deviceData) {
            log('ERROR: All APIs failed', { lastError });
            return res.status(500).json({ 
                error: 'Unable to fetch Homey data from any API',
                lastError,
                debugLog,
                temperature: null,
                humidity: null
            });
        }

        log('=== Success - Returning Data ===', deviceData);

        return res.status(200).json({
            temperature: deviceData.temperature,
            humidity: deviceData.humidity,
            apiUsed: apiUsed,
            timestamp: new Date().toISOString(),
            debugLog
        });

    } catch (error) {
        log('FATAL ERROR', { error: error.message, stack: error.stack });
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message,
            debugLog,
            temperature: null,
            humidity: null
        });
    }
}

// Fetch from Homey Local API
async function fetchHomeyLocal(localUrl, bearerToken, tempDeviceId, humidityDeviceId, log) {
    log('Fetching from Local API', { url: `${localUrl}/api/manager/devices/device/${tempDeviceId}` });
    
    const tempResponse = await fetch(`${localUrl}/api/manager/devices/device/${tempDeviceId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json'
        }
    });

    log('Local API response', { 
        status: tempResponse.status, 
        statusText: tempResponse.statusText,
        ok: tempResponse.ok
    });

    if (!tempResponse.ok) {
        const errorText = await tempResponse.text();
        log('Local API error response', { status: tempResponse.status, body: errorText });
        throw new Error(`Local API temperature fetch failed: ${tempResponse.status} - ${errorText}`);
    }

    const tempDevice = await tempResponse.json();
    log('Local API device data received', { 
        deviceName: tempDevice.name,
        deviceClass: tempDevice.class,
        hasCapabilitiesObj: !!tempDevice.capabilitiesObj,
        capabilityKeys: tempDevice.capabilitiesObj ? Object.keys(tempDevice.capabilitiesObj) : []
    });
    
    const data = extractSensorData(tempDevice, log);

    // If humidity device is different, fetch it separately
    if (humidityDeviceId && humidityDeviceId !== tempDeviceId && !data.humidity) {
        try {
            log('Fetching separate humidity device', { deviceId: humidityDeviceId });
            const humidityResponse = await fetch(`${localUrl}/api/manager/devices/device/${humidityDeviceId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${bearerToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (humidityResponse.ok) {
                const humidityDevice = await humidityResponse.json();
                const humidityData = extractSensorData(humidityDevice, log);
                if (humidityData.humidity !== undefined) {
                    data.humidity = humidityData.humidity;
                    log('Humidity fetched from separate device', { humidity: data.humidity });
                }
            }
        } catch (error) {
            log('Humidity fetch failed', { error: error.message });
        }
    }

    return data;
}

// Fetch from Homey Cloud API
async function fetchHomeyCloud(cloudUrl, accessToken, homeyId, tempDeviceId, humidityDeviceId, log) {
    log('Fetching from Cloud API', { url: `${cloudUrl}/homey/${homeyId}/device/${tempDeviceId}` });
    
    const tempResponse = await fetch(`${cloudUrl}/homey/${homeyId}/device/${tempDeviceId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    log('Cloud API response', { 
        status: tempResponse.status, 
        statusText: tempResponse.statusText,
        ok: tempResponse.ok
    });

    if (!tempResponse.ok) {
        const errorText = await tempResponse.text();
        log('Cloud API error response', { status: tempResponse.status, body: errorText });
        throw new Error(`Cloud API temperature fetch failed: ${tempResponse.status} - ${errorText}`);
    }

    const tempDevice = await tempResponse.json();
    log('Cloud API device data received', { 
        deviceName: tempDevice.name,
        deviceClass: tempDevice.class,
        hasCapabilitiesObj: !!tempDevice.capabilitiesObj,
        capabilityKeys: tempDevice.capabilitiesObj ? Object.keys(tempDevice.capabilitiesObj) : []
    });
    
    const data = extractSensorData(tempDevice, log);

    // If humidity device is different, fetch it separately
    if (humidityDeviceId && humidityDeviceId !== tempDeviceId && !data.humidity) {
        try {
            log('Fetching separate humidity device', { deviceId: humidityDeviceId });
            const humidityResponse = await fetch(`${cloudUrl}/homey/${homeyId}/device/${humidityDeviceId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (humidityResponse.ok) {
                const humidityDevice = await humidityResponse.json();
                const humidityData = extractSensorData(humidityDevice, log);
                if (humidityData.humidity !== undefined) {
                    data.humidity = humidityData.humidity;
                    log('Humidity fetched from separate device', { humidity: data.humidity });
                }
            }
        } catch (error) {
            log('Humidity fetch failed', { error: error.message });
        }
    }

    return data;
}

// Extract sensor data from Homey device object
function extractSensorData(device, log) {
    log('Extracting sensor data from device', { deviceName: device.name });
    
    const data = {
        temperature: null,
        humidity: null
    };

    if (device.capabilitiesObj) {
        log('Device has capabilitiesObj', { capabilities: Object.keys(device.capabilitiesObj) });
        
        // Try different temperature capability names
        const tempCapabilities = ['measure_temperature', 'temperature', 'temp'];
        for (const cap of tempCapabilities) {
            if (device.capabilitiesObj[cap]) {
                log(`Found temperature capability: ${cap}`, device.capabilitiesObj[cap]);
                if (device.capabilitiesObj[cap].value !== undefined) {
                    data.temperature = device.capabilitiesObj[cap].value;
                    log(`Temperature extracted: ${data.temperature}°C`);
                    break;
                }
            }
        }

        // Try different humidity capability names
        const humidityCapabilities = ['measure_humidity', 'humidity', 'hum'];
        for (const cap of humidityCapabilities) {
            if (device.capabilitiesObj[cap]) {
                log(`Found humidity capability: ${cap}`, device.capabilitiesObj[cap]);
                if (device.capabilitiesObj[cap].value !== undefined) {
                    data.humidity = device.capabilitiesObj[cap].value;
                    log(`Humidity extracted: ${data.humidity}%`);
                    break;
                }
            }
        }
    } else if (device.capabilities) {
        log('Device has direct capabilities (no capabilitiesObj)', { capabilities: device.capabilities });
        
        // Alternative structure
        if (device.capabilities.temperature !== undefined) {
            data.temperature = device.capabilities.temperature;
            log(`Temperature extracted (direct): ${data.temperature}°C`);
        }
        if (device.capabilities.humidity !== undefined) {
            data.humidity = device.capabilities.humidity;
            log(`Humidity extracted (direct): ${data.humidity}%`);
        }
    } else {
        log('WARNING: Device has neither capabilitiesObj nor capabilities', { 
            deviceStructure: Object.keys(device) 
        });
    }

    log('Final extracted data', data);
    return data;
}
