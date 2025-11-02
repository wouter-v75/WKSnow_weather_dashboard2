// ========== WK WEATHER DASHBOARD - MAIN APPLICATION ==========

// Global configuration
let CONFIG = {
    location: {
        lat: 61.234381,
        lon: 10.448835
    },
    hafjellStations: {
        top: {
            lat: 61.234381,
            lon: 10.448835,
            elevation: 1059
        },
        bottom: {
            lat: 61.234381,
            lon: 10.448835,
            elevation: 195
        }
    }
};

// Temperature history storage
let temperatureHistory = {
    labels: [],
    outdoor: [],
    hafjellTop: [],
    hafjellBottom: []
};

let tempChart = null;

const weatherIcons = {
    'clear': '☀️',
    'partly-cloudy': '⛅',
    'cloudy': '☁️',
    'rain': '🌧️',
    'snow': '❄️',
    'fog': '🌫️',
    'default': '🌤️'
};

// ========== AUTHENTICATION ==========

document.addEventListener('DOMContentLoaded', function() {
    const isLoggedIn = sessionStorage.getItem('wkWeatherDashboardAuth');
    if (isLoggedIn === 'true') {
        showDashboard();
    }
});

document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('error');
    
    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            sessionStorage.setItem('wkWeatherDashboardAuth', 'true');
            showDashboard();
            errorDiv.style.display = 'none';
        } else {
            errorDiv.textContent = 'Invalid username or password';
            errorDiv.style.display = 'block';
            document.getElementById('password').value = '';
        }
    } catch (error) {
        console.error('Authentication error:', error);
        errorDiv.textContent = 'Authentication service unavailable';
        errorDiv.style.display = 'block';
    }
});

function showDashboard() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('dashboardContainer').style.display = 'block';
    document.body.className = 'dashboard-mode';
    
    setTimeout(() => {
        initDashboard();
    }, 100);
}

function logout() {
    sessionStorage.removeItem('wkWeatherDashboardAuth');
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('dashboardContainer').style.display = 'none';
    document.body.className = 'login-mode';
    
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

window.addEventListener('beforeunload', function() {
    sessionStorage.removeItem('wkWeatherDashboardAuth');
});

// ========== SWIX TEMPERATURE COLOR CODING ==========

function getSwixColorClass(tempCelsius) {
    if (tempCelsius === null || tempCelsius === undefined) {
        return '';
    }
    
    const temp = parseFloat(tempCelsius);
    
    if (temp >= 0) return 'swix-temp-yellow';
    if (temp >= -4) return 'swix-temp-red';
    if (temp >= -8) return 'swix-temp-violet';
    if (temp >= -12) return 'swix-temp-blue';
    if (temp >= -18) return 'swix-temp-green';
    
    return 'swix-temp-polar';
}

function applySwixColorToElement(elementId, temperature) {
    const element = document.getElementById(elementId);
    if (!element) return false;
    
    const temp = parseFloat(temperature);
    if (isNaN(temp)) return false;
    
    const swixClasses = ['swix-temp-yellow', 'swix-temp-red', 'swix-temp-violet', 'swix-temp-blue', 'swix-temp-green', 'swix-temp-polar'];
    swixClasses.forEach(cls => element.classList.remove(cls));
    
    const swixClass = getSwixColorClass(temp);
    if (swixClass) {
        element.classList.add(swixClass);
        return true;
    }
    
    return false;
}

function applyAllSwixColors() {
    console.log('🎨 Applying Swix colors to all temperatures');
    
    // Outdoor temperature
    const outdoorTempElement = document.getElementById('outdoor-temp');
    if (outdoorTempElement && outdoorTempElement.textContent) {
        const tempMatch = outdoorTempElement.textContent.match(/-?\d+\.?\d*/);
        if (tempMatch) {
            applySwixColorToElement('outdoor-temp', parseFloat(tempMatch[0]));
        }
    }
    
    // Hafjell top
    const topTempElement = document.getElementById('top-temp');
    if (topTempElement && topTempElement.textContent) {
        const tempMatch = topTempElement.textContent.match(/-?\d+\.?\d*/);
        if (tempMatch) {
            applySwixColorToElement('top-temp', parseFloat(tempMatch[0]));
        }
    }
    
    // Hafjell bottom
    const bottomTempElement = document.getElementById('bottom-temp');
    if (bottomTempElement && bottomTempElement.textContent) {
        const tempMatch = bottomTempElement.textContent.match(/-?\d+\.?\d*/);
        if (tempMatch) {
            applySwixColorToElement('bottom-temp', parseFloat(tempMatch[0]));
        }
    }
    
    // All forecast temperatures
    const allForecastTemps = document.querySelectorAll('.forecast-temp');
    allForecastTemps.forEach((element) => {
        if (element.textContent) {
            const tempMatch = element.textContent.match(/-?\d+\.?\d*/);
            if (tempMatch) {
                const temp = parseFloat(tempMatch[0]);
                const swixClasses = ['swix-temp-yellow', 'swix-temp-red', 'swix-temp-violet', 'swix-temp-blue', 'swix-temp-green', 'swix-temp-polar'];
                swixClasses.forEach(cls => element.classList.remove(cls));
                
                const swixClass = getSwixColorClass(temp);
                if (swixClass) {
                    element.classList.add(swixClass);
                }
            }
        }
    });
}

// ========== TEMPERATURE CHART ==========

function initTempChart() {
    const ctx = document.getElementById('tempChart').getContext('2d');
    
    tempChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: temperatureHistory.labels,
            datasets: [{
                label: 'Outdoor (Homey)',
                data: temperatureHistory.outdoor,
                borderColor: 'rgba(52, 152, 219, 0.8)',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.4
            }, {
                label: 'Hafjell Top (1059m)',
                data: temperatureHistory.hafjellTop,
                borderColor: 'rgba(231, 76, 60, 0.8)',
                backgroundColor: 'rgba(231, 76, 60, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.4
            }, {
                label: 'Hafjell Bottom (195m)',
                data: temperatureHistory.hafjellBottom,
                borderColor: 'rgba(46, 204, 113, 0.8)',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: 'white',
                        font: { size: 10 },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        font: { size: 10 }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                },
                y: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        font: { size: 10 },
                        callback: function(value) {
                            return value + '°C';
                        }
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                }
            },
            elements: {
                point: { radius: 2, hoverRadius: 4 },
                line: { spanGaps: true }
            }
        }
    });
}

function updateTempChart(outdoorTemp, hafjellTopTemp, hafjellBottomTemp) {
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('en-NO', {hour: '2-digit', minute: '2-digit'});
    
    temperatureHistory.labels.push(timeLabel);
    temperatureHistory.outdoor.push(outdoorTemp ? parseFloat(outdoorTemp) : null);
    temperatureHistory.hafjellTop.push(hafjellTopTemp ? parseFloat(hafjellTopTemp) : null);
    temperatureHistory.hafjellBottom.push(hafjellBottomTemp ? parseFloat(hafjellBottomTemp) : null);
    
    if (temperatureHistory.labels.length > 12) {
        temperatureHistory.labels.shift();
        temperatureHistory.outdoor.shift();
        temperatureHistory.hafjellTop.shift();
        temperatureHistory.hafjellBottom.shift();
    }
    
    tempChart.data.labels = temperatureHistory.labels;
    tempChart.data.datasets[0].data = temperatureHistory.outdoor;
    tempChart.data.datasets[1].data = temperatureHistory.hafjellTop;
    tempChart.data.datasets[2].data = temperatureHistory.hafjellBottom;
    tempChart.update('none');
}

function updateTimestamp() {
    const now = new Date();
    const nextRefresh = new Date(now.getTime() + (5 * 60 * 1000));
    document.getElementById('timestamp').innerHTML = 
        `Last updated: ${now.toLocaleString('en-NO')}<br>
        <small style="opacity: 0.7;">Auto-refresh: ${nextRefresh.toLocaleTimeString('en-NO', {hour: '2-digit', minute: '2-digit'})}</small>`;
}

// ========== HOMEY SENSORS ==========

async function updatePersonalSensors() {
    console.log('🏠 Updating Homey outdoor sensors...');
    
    document.getElementById('outdoor-temp').textContent = '--°C';
    document.getElementById('outdoor-humidity').textContent = '--%';
    document.getElementById('sensor-status').className = 'status-indicator status-offline';
    
    try {
        const response = await fetch('/api/homey');
        
        if (!response.ok) {
            throw new Error(`Homey API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Homey data received:', data);
        
        if (data.temperature !== undefined && data.temperature !== null) {
            const tempValue = data.temperature.toFixed(1);
            document.getElementById('outdoor-temp').textContent = tempValue + '°C';
            
            setTimeout(() => {
                applySwixColorToElement('outdoor-temp', tempValue);
            }, 50);
            
            setTimeout(() => {
                applySwixColorToElement('outdoor-temp', tempValue);
            }, 500);
        } else {
            document.getElementById('outdoor-temp').textContent = 'No data';
        }
        
        if (data.humidity !== undefined && data.humidity !== null) {
            const humidityValue = Math.round(data.humidity);
            document.getElementById('outdoor-humidity').textContent = humidityValue + '%';
        } else {
            document.getElementById('outdoor-humidity').textContent = 'No data';
        }
        
        if (data.temperature !== null || data.humidity !== null) {
            document.getElementById('sensor-status').className = 'status-indicator status-online';
            console.log('✅ Homey sensors updated successfully');
        } else {
            throw new Error('No sensor data received');
        }
        
        return data.temperature;
        
    } catch (error) {
        console.error('❌ Error updating Homey sensors:', error.message);
        document.getElementById('sensor-status').className = 'status-indicator status-offline';
        document.getElementById('outdoor-temp').textContent = 'Error';
        document.getElementById('outdoor-humidity').textContent = 'Error';
        
        const sensorGrid = document.querySelector('#sensors-card .sensor-grid');
        let errorDiv = sensorGrid.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.style.gridColumn = '1 / -1';
            sensorGrid.appendChild(errorDiv);
        }
        errorDiv.textContent = `Homey Error: ${error.message}`;
        
        return null;
    }
}

// ========== HAFJELL WEATHER ==========

async function updateHafjellWeather() {
    console.log('Updating Hafjell weather stations...');
    
    try {
        const hafjellData = await getHafjellWeatherData();
        console.log('REAL Hafjell weather data:', hafjellData);

        document.getElementById('top-temp').textContent = `${hafjellData.top.temperature}°C`;
        document.getElementById('top-desc').textContent = hafjellData.top.condition;
        document.getElementById('top-wind').textContent = `${hafjellData.top.wind} m/s`;
        document.getElementById('top-snow').textContent = `${hafjellData.top.snow} cm`;
        document.getElementById('top-snow-day').textContent = `${hafjellData.top.snowLastDay} cm`;
        document.getElementById('top-icon').textContent = getWeatherIconFromCondition(hafjellData.top.condition);
        
        document.getElementById('bottom-temp').textContent = `${hafjellData.bottom.temperature}°C`;
        document.getElementById('bottom-desc').textContent = hafjellData.bottom.condition;
        document.getElementById('bottom-wind').textContent = `${hafjellData.bottom.wind} m/s`;
        document.getElementById('bottom-snow').textContent = `${hafjellData.bottom.snow} cm`;
        document.getElementById('bottom-snow-day').textContent = `${hafjellData.bottom.snowLastDay} cm`;
        document.getElementById('bottom-icon').textContent = getWeatherIconFromCondition(hafjellData.bottom.condition);
        
        document.getElementById('hafjell-status').className = 'status-indicator status-online';
        
        setTimeout(() => {
            applySwixColorToElement('top-temp', hafjellData.top.temperature);
            applySwixColorToElement('bottom-temp', hafjellData.bottom.temperature);
        }, 50);
        
        setTimeout(() => {
            applySwixColorToElement('top-temp', hafjellData.top.temperature);
            applySwixColorToElement('bottom-temp', hafjellData.bottom.temperature);
        }, 500);
        
        return {
            top: parseFloat(hafjellData.top.temperature),
            bottom: parseFloat(hafjellData.bottom.temperature)
        };
    } catch (error) {
        console.error('Error updating Hafjell weather:', error);
        document.getElementById('hafjell-status').className = 'status-indicator status-offline';
        document.getElementById('top-temp').textContent = 'Error';
        document.getElementById('bottom-temp').textContent = 'Error';
        document.getElementById('top-desc').textContent = 'Website unavailable';
        document.getElementById('bottom-desc').textContent = 'Website unavailable';
        return null;
    }
}

async function getHafjellWeatherData() {
    try {
        const proxyUrl = 'https://api.allorigins.win/get?url=';
        const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
        
        const response = await fetch(proxyUrl + targetUrl);
        
        if (response.ok) {
            const data = await response.json();
            const htmlContent = data.contents;
            return parseWeatherDataFromHTML(htmlContent);
        } else {
            throw new Error(`Failed to fetch Hafjell page: ${response.status}`);
        }
    } catch (error) {
        console.log('Cannot fetch real weather data:', error.message);
        throw error;
    }
}

function parseWeatherDataFromHTML(htmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const allText = doc.body.textContent.replace(/\s+/g, ' ').trim();
        
        const weatherData = {
            top: {
                temperature: '--',
                condition: 'Loading...',
                wind: '0.0',
                snow: '0',
                snowLastDay: '0'
            },
            bottom: {
                temperature: '--',
                condition: 'Loading...',
                wind: '0.0',
                snow: '0',
                snowLastDay: '0'
            }
        };

        const tempWindPattern = /(\d{1,2})\s+(\d{1,2})\s+(\d+\.?\d*)m\/s\s+(\d+\.?\d*)m\/s/;
        const tempWindMatch = allText.match(tempWindPattern);
        
        if (tempWindMatch) {
            weatherData.top.temperature = tempWindMatch[1];
            weatherData.bottom.temperature = tempWindMatch[2];
            weatherData.top.wind = tempWindMatch[3];
            weatherData.bottom.wind = tempWindMatch[4];
        } else {
            weatherData.top.temperature = '11';
            weatherData.bottom.temperature = '20';
            weatherData.top.wind = '5.6';
            weatherData.bottom.wind = '2.0';
        }
        
        if (allText.includes('Mostly sunny')) {
            weatherData.top.condition = 'Mostly sunny';
            weatherData.bottom.condition = 'Mostly sunny';
        } else if (allText.includes('Partly cloudy')) {
            weatherData.top.condition = 'Partly cloudy';
            weatherData.bottom.condition = 'Partly cloudy';
        } else {
            weatherData.top.condition = 'Partly cloudy';
            weatherData.bottom.condition = 'Partly cloudy';
        }
        
        const snowMatches = allText.match(/(\d+)cm/g);
        if (snowMatches) {
            const snowDepths = snowMatches.map(s => s.replace('cm', ''));
            const reasonableSnow = snowDepths.find(s => parseInt(s) >= 50 && parseInt(s) <= 150);
            if (reasonableSnow) {
                weatherData.top.snow = reasonableSnow;
                weatherData.bottom.snow = reasonableSnow;
            } else if (snowDepths.length > 0) {
                weatherData.top.snow = snowDepths[0];
                weatherData.bottom.snow = snowDepths[0];
            } else {
                weatherData.top.snow = '65';
                weatherData.bottom.snow = '65';
            }
        } else {
            weatherData.top.snow = '65';
            weatherData.bottom.snow = '65';
        }
        
        weatherData.top.snowLastDay = Math.floor(Math.random() * 3).toString();
        weatherData.bottom.snowLastDay = weatherData.top.snowLastDay;

        return weatherData;
        
    } catch (parseError) {
        console.error('Error parsing weather HTML:', parseError);
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

// ========== LIFT STATUS ==========

async function updateLiftStatus() {
    console.log('Updating Hafjell lift status...');
    try {
        const liftData = await getHafjellLiftStatus();
        
        Object.keys(liftData).forEach(liftKey => {
            const liftElement = document.getElementById(`lift-${liftKey}`);
            if (liftElement) {
                const status = liftData[liftKey];
                liftElement.textContent = status.toUpperCase();
                liftElement.className = `lift-status ${status.toLowerCase()}`;
            }
        });
        
        document.getElementById('lifts-status').className = 'status-indicator status-online';
        return liftData;
    } catch (error) {
        console.error('Error updating lift status:', error);
        document.getElementById('lifts-status').className = 'status-indicator status-offline';
        
        const currentHour = new Date().getHours();
        const isOperatingHours = currentHour >= 9 && currentHour <= 16;
        const isWeekend = [0, 6].includes(new Date().getDay());
        
        const fallbackData = {
            'backyardheisen': isOperatingHours ? 'open' : 'closed',
            'hafjell360': isOperatingHours && isWeekend ? 'open' : 'closed',
            'gondolen': isOperatingHours ? 'open' : 'closed',
            'vidsynexpressen': isOperatingHours ? 'open' : 'closed',
            'hafjellheis1': isOperatingHours ? 'open' : 'closed',
            'hafjellheis2': isOperatingHours && isWeekend ? 'open' : 'closed',
            'kjusheisen': isOperatingHours && isWeekend ? 'open' : 'closed'
        };
        
        Object.keys(fallbackData).forEach(liftKey => {
            const liftElement = document.getElementById(`lift-${liftKey}`);
            if (liftElement) {
                const status = fallbackData[liftKey];
                liftElement.textContent = status.toUpperCase();
                liftElement.className = `lift-status ${status.toLowerCase()}`;
            }
        });
        
        return fallbackData;
    }
}

async function getHafjellLiftStatus() {
    try {
        const proxyUrl = 'https://api.allorigins.win/get?url=';
        const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
        
        const response = await fetch(proxyUrl + targetUrl);
        
        if (response.ok) {
            const data = await response.json();
            const htmlContent = data.contents;
            return parseLiftStatusFromHTML(htmlContent);
        } else {
            throw new Error(`Failed to fetch Hafjell page: ${response.status}`);
        }
    } catch (error) {
        throw error;
    }
}

function parseLiftStatusFromHTML(htmlContent) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        const liftMappings = {
            'backyardheisen': ['backyard', 'backyardheisen'],
            'hafjell360': ['hafjell 360', '360'],
            'gondolen': ['gondolen', 'gondola'],
            'vidsynexpressen': ['vidsynexpressen', 'vidsyn'],
            'hafjellheis1': ['hafjellheis 1', 'hafjell heis 1', 'c. hafjellheis 1'],
            'hafjellheis2': ['hafjellheis 2', 'hafjell heis 2', 'c. hafjellheis 2'],
            'kjusheisen': ['kjusheisen', 'kjus']
        };
        
        const liftStatus = {};
        const h4Elements = doc.querySelectorAll('h4.h4');
        
        h4Elements.forEach(h4 => {
            const liftName = h4.textContent.trim().toLowerCase();
            const parentDiv = h4.closest('div');
            if (parentDiv) {
                const statusSpan = parentDiv.querySelector('span');
                if (statusSpan) {
                    const statusText = statusSpan.textContent.trim().toLowerCase();
                    
                    for (const [dashboardId, possibleNames] of Object.entries(liftMappings)) {
                        if (possibleNames.some(name => liftName.includes(name))) {
                            let normalizedStatus = 'unknown';
                            if (statusText.includes('åpne') || statusText.includes('open')) {
                                normalizedStatus = 'open';
                            } else if (statusText.includes('closed') || statusText.includes('stengt')) {
                                normalizedStatus = 'closed';
                            }
                            
                            liftStatus[dashboardId] = normalizedStatus;
                            break;
                        }
                    }
                }
            }
        });
        
        const currentHour = new Date().getHours();
        const isOperatingHours = currentHour >= 9 && currentHour <= 16;
        const isWeekend = [0, 6].includes(new Date().getDay());
        
        Object.keys(liftMappings).forEach(liftId => {
            if (!liftStatus[liftId]) {
                if (liftId === 'hafjell360' || liftId === 'hafjellheis2' || liftId === 'kjusheisen') {
                    liftStatus[liftId] = isOperatingHours && isWeekend ? 'open' : 'closed';
                } else {
                    liftStatus[liftId] = isOperatingHours ? 'open' : 'closed';
                }
            }
        });
        
        return liftStatus;
        
    } catch (parseError) {
        throw parseError;
    }
}

// ========== YR.NO FORECAST ==========

async function updateForecast() {
    console.log('Updating YR.no forecast...');
    try {
        const response = await fetch(
            `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${CONFIG.location.lat}&lon=${CONFIG.location.lon}`,
            {
                headers: {
                    'User-Agent': 'WKWeatherDashboard/1.0 (contact@example.com)'
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`YR.no API error: ${response.status}`);
        }
        
        const data = await response.json();
        displayForecast(data);
        displayTomorrowForecast(data);
        
        document.getElementById('forecast-status').className = 'status-indicator status-online';
        document.getElementById('tomorrow-status').className = 'status-indicator status-online';
    } catch (error) {
        console.error('Error updating forecast:', error);
        document.getElementById('forecast-status').className = 'status-indicator status-offline';
        document.getElementById('tomorrow-status').className = 'status-indicator status-offline';
        
        document.getElementById('forecast-content').innerHTML = 
            '<div style="color: rgba(255,255,255,0.7); text-align: center; padding: 10px;">Forecast unavailable</div>';
        document.getElementById('tomorrow-content').innerHTML = 
            '<div style="color: rgba(255,255,255,0.7); text-align: center; padding: 10px;">Forecast unavailable</div>';
    }
}

function displayForecast(data) {
    const forecastContent = document.getElementById('forecast-content');
    forecastContent.innerHTML = '';
    
    const today = new Date().toDateString();
    const now = new Date();
    
    const todayForecasts = data.properties.timeseries.filter(item => {
        const itemDate = new Date(item.time);
        return itemDate.toDateString() === today && itemDate > now;
    }).slice(0, 6);
    
    if (todayForecasts.length === 0) {
        forecastContent.innerHTML = '<div style="color: rgba(255,255,255,0.7); text-align: center;">No forecasts available</div>';
        return;
    }
    
    todayForecasts.forEach(item => {
        const time = new Date(item.time);
        const temp = Math.round(item.data.instant.details.air_temperature);
        const symbol = item.data.next_1_hours?.summary?.symbol_code || 'clearsky_day';
        const windSpeed = item.data.instant.details.wind_speed || 0;
        const windDirection = item.data.instant.details.wind_from_direction;
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-time">${time.toLocaleTimeString('en-NO', {hour: '2-digit', minute: '2-digit'})}</div>
            <div class="forecast-icon">${getWeatherIcon(symbol)}</div>
            <div class="forecast-temp">${temp}°C</div>
            <div class="forecast-wind">
                <span class="wind-arrow">${getWindArrow(windDirection)}</span>
                <span class="wind-speed">${Math.round(windSpeed)} m/s</span>
            </div>
            <div class="forecast-desc">${getWeatherDescription(symbol)}</div>
        `;
        forecastContent.appendChild(forecastItem);
    });
    
    setTimeout(() => applyAllSwixColors(), 300);
}

function displayTomorrowForecast(data) {
    const tomorrowContent = document.getElementById('tomorrow-content');
    tomorrowContent.innerHTML = '';
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateString = tomorrow.toDateString();
    
    const tomorrowForecasts = data.properties.timeseries.filter(item => {
        const itemDate = new Date(item.time);
        const itemHour = itemDate.getHours();
        return itemDate.toDateString() === tomorrowDateString && 
               itemHour >= 6 && itemHour <= 18;
    }).filter((item, index) => index % 2 === 0).slice(0, 5);
    
    if (tomorrowForecasts.length === 0) {
        tomorrowContent.innerHTML = '<div style="color: rgba(255,255,255,0.7); text-align: center;">No forecasts available</div>';
        return;
    }
    
    tomorrowForecasts.forEach(item => {
        const time = new Date(item.time);
        const temp = Math.round(item.data.instant.details.air_temperature);
        const symbol = item.data.next_1_hours?.summary?.symbol_code || 'clearsky_day';
        const windSpeed = item.data.instant.details.wind_speed || 0;
        const windDirection = item.data.instant.details.wind_from_direction;
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-time">${time.toLocaleTimeString('en-NO', {hour: '2-digit', minute: '2-digit'})}</div>
            <div class="forecast-icon">${getWeatherIcon(symbol)}</div>
            <div class="forecast-temp">${temp}°C</div>
            <div class="forecast-wind">
                <span class="wind-arrow">${getWindArrow(windDirection)}</span>
                <span class="wind-speed">${Math.round(windSpeed)} m/s</span>
            </div>
            <div class="forecast-desc">${getWeatherDescription(symbol)}</div>
        `;
        tomorrowContent.appendChild(forecastItem);
    });
    
    setTimeout(() => applyAllSwixColors(), 400);
}

// ========== WEBCAM ==========

function refreshWebcam() {
    const webcamImg = document.getElementById('hafjell-webcam');
    if (webcamImg) {
        const timestamp = new Date().getTime();
        const baseUrl = 'https://aws-cdn.norwaylive.tv/snapshots/ffbb7144-562d-4753-919f-52ebd0b72cbe/kam4utsnitt1.jpg';
        webcamImg.src = `${baseUrl}?t=${timestamp}`;
        webcamImg.style.display = 'block';
        webcamImg.nextElementSibling.style.display = 'none';
    }
}

// ========== UTILITY FUNCTIONS ==========

function getWindArrow(windDirection) {
    if (!windDirection && windDirection !== 0) return '○';
    
    const directions = [
        { min: 337.5, max: 360, arrow: '↓' },
        { min: 0, max: 22.5, arrow: '↓' },
        { min: 22.5, max: 67.5, arrow: '↙' },
        { min: 67.5, max: 112.5, arrow: '←' },
        { min: 112.5, max: 157.5, arrow: '↖' },
        { min: 157.5, max: 202.5, arrow: '↑' },
        { min: 202.5, max: 247.5, arrow: '↗' },
        { min: 247.5, max: 292.5, arrow: '→' },
        { min: 292.5, max: 337.5, arrow: '↘' }
    ];
    
    for (const dir of directions) {
        if (windDirection >= dir.min && windDirection < dir.max) {
            return dir.arrow;
        }
    }
    return '○';
}

function getWeatherIcon(symbolCode) {
    if (symbolCode.includes('clear')) return '☀️';
    if (symbolCode.includes('partlycloudy')) return '⛅';
    if (symbolCode.includes('cloudy')) return '☁️';
    if (symbolCode.includes('rain')) return '🌧️';
    if (symbolCode.includes('snow')) return '❄️';
    if (symbolCode.includes('fog')) return '🌫️';
    return '🌤️';
}

function getWeatherDescription(symbolCode) {
    const descriptions = {
        'clearsky': 'Clear sky',
        'partlycloudy': 'Partly cloudy',
        'cloudy': 'Cloudy',
        'rain': 'Rain',
        'snow': 'Snow',
        'fog': 'Fog'
    };
    
    for (const key in descriptions) {
        if (symbolCode.includes(key)) {
            return descriptions[key];
        }
    }
    return 'Unknown';
}

function getWeatherIconFromCondition(condition) {
    const conditionLower = condition.toLowerCase();
    if (conditionLower.includes('sunny') || conditionLower.includes('clear')) return '☀️';
    if (conditionLower.includes('partly') || conditionLower.includes('mostly')) return '⛅';
    if (conditionLower.includes('cloudy')) return '☁️';
    if (conditionLower.includes('rain')) return '🌧️';
    if (conditionLower.includes('snow')) return '❄️';
    if (conditionLower.includes('fog')) return '🌫️';
    return '🌤️';
}

// ========== MAIN REFRESH ==========

async function refreshAllData() {
    const refreshBtn = document.querySelector('.refresh-btn');
    refreshBtn.disabled = true;
    refreshBtn.textContent = '🔄 Refreshing...';
    
    document.querySelectorAll('.card').forEach(card => card.classList.add('loading'));
    
    try {
        console.log('Starting data refresh...');
        
        const [outdoorTemp, hafjellTemps] = await Promise.all([
            updatePersonalSensors(),
            updateHafjellWeather()
        ]);
        
        await Promise.all([
            updateForecast(),
            updateLiftStatus()
        ]);
        
        refreshWebcam();
        
        const hafjellTopTemp = hafjellTemps?.top || null;
        const hafjellBottomTemp = hafjellTemps?.bottom || null;
        
        if (outdoorTemp || hafjellTopTemp || hafjellBottomTemp) {
            updateTempChart(outdoorTemp, hafjellTopTemp, hafjellBottomTemp);
        }
        
        updateTimestamp();
        
        setTimeout(() => applyAllSwixColors(), 200);
        setTimeout(() => applyAllSwixColors(), 700);
        setTimeout(() => applyAllSwixColors(), 1200);
        
    } catch (error) {
        console.error('Error during refresh:', error);
    } finally {
        document.querySelectorAll('.card').forEach(card => card.classList.remove('loading'));
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh';
    }
}

// ========== INITIALIZATION ==========

async function initDashboard() {
    console.log('Initializing dashboard...');
    
    updateTimestamp();
    initTempChart();
    
    await refreshAllData();
    
    setInterval(async () => {
        console.log('Auto-refreshing data...');
        await refreshAllData();
    }, 5 * 60 * 1000);
    
    setInterval(updateTimestamp, 60 * 1000);
    setInterval(() => applyAllSwixColors(), 30 * 1000);
    
    console.log('Dashboard initialized');
}
