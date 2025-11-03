#!/usr/bin/env node

/**
 * Homey Pro Setup Script for Vercel Deployment
 * 
 * This script helps you:
 * 1. Authenticate with Homey
 * 2. Discover your temperature/humidity sensor device IDs
 * 3. Generate the environment variables for Vercel
 * 
 * Prerequisites:
 * 1. Register your app at https://tools.developer.athom.com/
 * 2. Note your Client ID and Client Secret
 * 3. Install dependencies: npm install
 */

const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n🏠 Homey Pro Setup for Vercel Deployment\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Get OAuth credentials
  console.log('📋 STEP 1: OAuth Credentials\n');
  console.log('Register your app at: https://tools.developer.athom.com/');
  console.log('You need to create a "Web App" type application.\n');
  
  const clientId = await question('Enter your Homey Client ID: ');
  const clientSecret = await question('Enter your Homey Client Secret: ');
  
  if (!clientId || !clientSecret) {
    console.error('❌ Client ID and Client Secret are required!');
    rl.close();
    return;
  }

  // Step 2: Authenticate
  console.log('\n🔐 STEP 2: Homey Account Authentication\n');
  
  const username = await question('Homey account email: ');
  const password = await question('Homey account password: ');

  try {
    // Create Cloud API instance
    console.log('\n📡 Connecting to Homey Cloud API...');
    const cloudApi = new AthomCloudAPI({
      clientId: clientId,
      clientSecret: clientSecret,
    });

    // Authenticate
    console.log('🔑 Authenticating...');
    await cloudApi.authenticateWithUsernamePassword({ username, password });
    
    // Get user
    const user = await cloudApi.getAuthenticatedUser();
    console.log(`✅ Authenticated as: ${user.fullname || user.email}`);

    // Get Homeys
    console.log('\n🏠 Fetching your Homey devices...');
    const homeys = await user.getHomeys();
    
    if (homeys.length === 0) {
      console.error('❌ No Homey devices found!');
      rl.close();
      return;
    }

    // Select Homey
    console.log('\n📱 Available Homey devices:');
    homeys.forEach((homey, index) => {
      console.log(`${index + 1}. ${homey.name} (${homey.modelName || 'Homey Pro'})`);
    });

    let selectedHomey;
    if (homeys.length === 1) {
      selectedHomey = homeys[0];
      console.log(`\n✅ Using: ${selectedHomey.name}`);
    } else {
      const selection = await question('\nSelect Homey number: ');
      const index = parseInt(selection) - 1;
      if (index < 0 || index >= homeys.length) {
        console.error('❌ Invalid selection!');
        rl.close();
        return;
      }
      selectedHomey = homeys[index];
    }

    // Connect to Homey
    console.log('\n🔗 Connecting to Homey...');
    const homeyApi = await selectedHomey.authenticate();
    console.log('✅ Connected!');

    // Step 3: Find sensors
    console.log('\n🌡️  STEP 3: Discover Temperature/Humidity Sensors\n');
    console.log('Fetching available devices...');
    
    const devices = await homeyApi.devices.getDevices();
    const deviceList = Object.values(devices);
    
    console.log(`Found ${deviceList.length} total devices\n`);

    // Filter temperature/humidity sensors
    const sensors = deviceList.filter(device => {
      const caps = device.capabilitiesObj || device.capabilities || {};
      return caps.measure_temperature || caps.temperature || 
             caps.measure_humidity || caps.humidity;
    });

    if (sensors.length === 0) {
      console.log('⚠️  No temperature/humidity sensors found.');
      console.log('\n📋 All available devices:');
      deviceList.forEach((device, index) => {
        console.log(`${index + 1}. ${device.name} [${device.id}]`);
      });
      rl.close();
      return;
    }

    console.log('🌡️  Available sensors:\n');
    sensors.forEach((device, index) => {
      const caps = device.capabilitiesObj || device.capabilities || {};
      const hasTemp = caps.measure_temperature || caps.temperature;
      const hasHumidity = caps.measure_humidity || caps.humidity;
      
      let indicators = [];
      if (hasTemp) indicators.push('🌡️  Temp');
      if (hasHumidity) indicators.push('💧 Humidity');
      
      // Show current values if available
      let values = [];
      if (hasTemp) {
        const tempVal = (caps.measure_temperature || caps.temperature).value;
        if (tempVal !== undefined) values.push(`${tempVal}°C`);
      }
      if (hasHumidity) {
        const humVal = (caps.measure_humidity || caps.humidity).value;
        if (humVal !== undefined) values.push(`${humVal}%`);
      }
      
      const valueStr = values.length > 0 ? ` (${values.join(', ')})` : '';
      console.log(`${index + 1}. ${device.name}${valueStr}`);
      console.log(`   ${indicators.join(', ')}`);
      console.log(`   ID: ${device.id}\n`);
    });

    // Select outdoor sensor
    console.log('📝 Select your OUTDOOR sensor:\n');
    const tempSelection = await question('Select sensor number for temperature: ');
    
    if (!tempSelection || parseInt(tempSelection) < 1 || parseInt(tempSelection) > sensors.length) {
      console.error('❌ Invalid selection!');
      rl.close();
      return;
    }
    
    const tempIndex = parseInt(tempSelection) - 1;
    const selectedTempSensor = sensors[tempIndex];
    
    console.log(`✅ Temperature sensor: ${selectedTempSensor.name}`);
    console.log(`   Device ID: ${selectedTempSensor.id}`);

    // Check if same sensor has humidity
    let humiditySensorId = '';
    const caps = selectedTempSensor.capabilitiesObj || selectedTempSensor.capabilities || {};
    
    if (caps.measure_humidity || caps.humidity) {
      const useSame = await question('\nUse same sensor for humidity? (y/n): ');
      if (useSame.toLowerCase() === 'y') {
        humiditySensorId = selectedTempSensor.id;
        console.log(`✅ Using same sensor for humidity`);
      } else {
        const humSelection = await question('Select sensor number for humidity: ');
        const humIndex = parseInt(humSelection) - 1;
        if (humIndex >= 0 && humIndex < sensors.length) {
          humiditySensorId = sensors[humIndex].id;
          console.log(`✅ Humidity sensor: ${sensors[humIndex].name}`);
        }
      }
    } else {
      const humSelection = await question('Select sensor number for humidity (or press Enter to skip): ');
      if (humSelection) {
        const humIndex = parseInt(humSelection) - 1;
        if (humIndex >= 0 && humIndex < sensors.length) {
          humiditySensorId = sensors[humIndex].id;
          console.log(`✅ Humidity sensor: ${sensors[humIndex].name}`);
        }
      }
    }

    // Test the sensors
    console.log('\n🧪 Testing sensor connection...\n');
    try {
      const testDevice = await homeyApi.devices.getDevice({ id: selectedTempSensor.id });
      const testCaps = testDevice.capabilitiesObj || testDevice.capabilities || {};
      
      console.log(`Device: ${testDevice.name}`);
      if (testCaps.measure_temperature) {
        console.log(`  Temperature: ${testCaps.measure_temperature.value}°C`);
      }
      if (testCaps.measure_humidity) {
        console.log(`  Humidity: ${testCaps.measure_humidity.value}%`);
      }
      console.log('\n✅ Sensor test successful!');
    } catch (error) {
      console.log(`⚠️  Could not fetch test data: ${error.message}`);
    }

    // Generate environment variables
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📋 VERCEL ENVIRONMENT VARIABLES');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Copy these values to your Vercel project settings:');
    console.log('(Project Settings → Environment Variables)\n');
    console.log('-----------------------------------------------------------');
    console.log(`HOMEY_CLIENT_ID=${clientId}`);
    console.log(`HOMEY_CLIENT_SECRET=${clientSecret}`);
    console.log(`HOMEY_USERNAME=${username}`);
    console.log(`HOMEY_PASSWORD=${password}`);
    console.log(`HOMEY_DEVICE_ID_TEMP=${selectedTempSensor.id}`);
    if (humiditySensorId) {
      console.log(`HOMEY_DEVICE_ID_HUMIDITY=${humiditySensorId}`);
    }
    console.log('-----------------------------------------------------------\n');

    // Save to .env.local for local testing
    const envContent = `# Homey Pro Environment Variables
# Generated: ${new Date().toISOString()}
# 
# For Vercel: Copy these to Project Settings → Environment Variables
# For local testing: This file is used by Vercel dev server

HOMEY_CLIENT_ID=${clientId}
HOMEY_CLIENT_SECRET=${clientSecret}
HOMEY_USERNAME=${username}
HOMEY_PASSWORD=${password}
HOMEY_DEVICE_ID_TEMP=${selectedTempSensor.id}
${humiditySensorId ? `HOMEY_DEVICE_ID_HUMIDITY=${humiditySensorId}` : '# HOMEY_DEVICE_ID_HUMIDITY='}
`;

    const envPath = path.join(__dirname, '.env.local');
    fs.writeFileSync(envPath, envContent);
    console.log(`💾 Saved to .env.local for local testing`);

    // Update .gitignore
    const gitignorePath = path.join(__dirname, '.gitignore');
    let gitignoreContent = '';
    
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }

    const entriesToAdd = ['.env.local', '.env', 'node_modules', '.vercel'];
    let updated = false;

    entriesToAdd.forEach(entry => {
      if (!gitignoreContent.includes(entry)) {
        gitignoreContent += `\n${entry}`;
        updated = true;
      }
    });

    if (updated) {
      fs.writeFileSync(gitignorePath, gitignoreContent.trim() + '\n');
      console.log(`✅ Updated .gitignore`);
    }

    // Instructions
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🚀 DEPLOYMENT INSTRUCTIONS');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('1️⃣  Install Vercel CLI (if not installed):');
    console.log('   npm install -g vercel\n');
    console.log('2️⃣  Test locally:');
    console.log('   vercel dev\n');
    console.log('3️⃣  Deploy to Vercel:');
    console.log('   vercel --prod\n');
    console.log('4️⃣  Set environment variables in Vercel:');
    console.log('   - Go to your project dashboard on vercel.com');
    console.log('   - Settings → Environment Variables');
    console.log('   - Add each variable from above');
    console.log('   - Set scope to: Production, Preview, and Development\n');
    console.log('5️⃣  Redeploy after setting variables:');
    console.log('   vercel --prod\n');
    console.log('⚠️  SECURITY: Never commit .env.local or credentials to Git!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Verify your Client ID and Client Secret');
    console.error('2. Check your Homey account credentials');
    console.error('3. Ensure Homey is online and accessible');
    console.error('4. Run: npm install homey-api');
  }

  rl.close();
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
