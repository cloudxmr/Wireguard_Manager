const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MikrotikAPI } = require('./mikrotik-api');
const database = require('./database');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Load configuration
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (error) {
  console.error('Config file not found or invalid. Please create backend/config.json');
  process.exit(1);
}

const mikrotik = new MikrotikAPI(config.mikrotik);

// Enhanced key generation with validation
const generateKeys = (includePresharedKey = false) => {
  // Enhanced WireGuard path detection
  const findWireGuardPath = () => {
    const possiblePaths = [
      'wg', // Try direct command first
      'wg.exe', // Windows with extension
      'C:\\Program Files\\WireGuard\\wg.exe',
      'C:\\Program Files (x86)\\WireGuard\\wg.exe',
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'WireGuard', 'wg.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'WireGuard', 'wg.exe')
    ];

    // Also check PATH environment variable
    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter);
    
    for (const dir of pathDirs) {
      if (dir.trim()) {
        possiblePaths.push(path.join(dir, 'wg.exe'));
        possiblePaths.push(path.join(dir, 'wg'));
      }
    }

    console.log('Searching for WireGuard in these locations:');
    
    for (const wgPath of possiblePaths) {
      try {
        console.log(`  Trying: ${wgPath}`);
        
        // Try to execute the command
        execSync(`"${wgPath}" --version`, { 
          stdio: 'pipe',
          timeout: 5000 
        });
        
        console.log(`✅ Found WireGuard at: ${wgPath}`);
        return wgPath;
      } catch (error) {
        // Continue to next path
        continue;
      }
    }
    return null;
  };

  try {
    const wgPath = findWireGuardPath();
    
    if (wgPath) {
      console.log(`✅ Using WireGuard tools at: ${wgPath}`);
      
      // Generate proper cryptographic key pair
      const privateKey = execSync(`"${wgPath}" genkey`, { 
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000
      }).trim();
      
      // CRITICAL: Derive public key from private key
      const publicKey = execSync(`echo ${privateKey} | "${wgPath}" pubkey`, { 
        encoding: 'utf8',
        shell: true,
        windowsHide: true,
        timeout: 10000
      }).trim();
      
      const keys = { privateKey, publicKey };
      
      if (includePresharedKey) {
        const presharedKey = execSync(`"${wgPath}" genpsk`, { 
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000
        }).trim();
        keys.presharedKey = presharedKey;
      }
      
      console.log(`✅ Generated proper WireGuard key pair`);
      console.log(`Private key: ${privateKey.substring(0, 8)}...`);
      console.log(`Public key:  ${publicKey.substring(0, 8)}...`);
      
      return keys;
    }
  } catch (error) {
    console.warn('Error using WireGuard tools:', error.message);
  }

  // If WireGuard tools not found, use crypto fallback
  console.warn('⚠️  WireGuard tools not detected, using Node.js crypto fallback');
  return generateKeysFallback(includePresharedKey);
};

// Fallback key generation using Node.js crypto
const generateKeysFallback = (includePresharedKey = false) => {
  try {
    // Install tweetnacl: npm install tweetnacl
    const nacl = require('tweetnacl');
    
    // Generate proper Curve25519 key pair
    const keyPair = nacl.box.keyPair();
    
    const privateKey = Buffer.from(keyPair.secretKey).toString('base64');
    const publicKey = Buffer.from(keyPair.publicKey).toString('base64');
    
    const keys = { privateKey, publicKey };
    
    if (includePresharedKey) {
      const presharedKey = crypto.randomBytes(32).toString('base64');
      keys.presharedKey = presharedKey;
    }
    
    console.log(`✅ Generated proper cryptographic key pair using Node.js crypto`);
    return keys;
  } catch (error) {
    console.error('❌ Crypto fallback failed:', error.message);
    console.error('Please install: npm install tweetnacl');
    throw new Error('Both WireGuard tools and crypto fallback unavailable');
  }
};

const isValidWireGuardKey = (key) => {
  if (!key || typeof key !== 'string') return false;
  if (key.length !== 44) return false;
  const base64Regex = /^[A-Za-z0-9+/]{43}=$/;
  return base64Regex.test(key);
};

const getNextAvailableIP = async () => {
  try {
    const peers = await mikrotik.getPeers();
    const usedIPs = peers.map(peer => {
      const allowedIPs = peer['allowed-address'] || '';
      return allowedIPs.split('/')[0];
    }).filter(ip => ip);

    const baseIP = config.wireguard.clientSubnet || '172.16.0';
    for (let i = 2; i < 255; i++) {
      const testIP = `${baseIP}.${i}`;
      if (!usedIPs.includes(testIP)) {
        return `${testIP}/32`;
      }
    }
    throw new Error('No available IP addresses');
  } catch (error) {
    throw new Error(`Failed to get next available IP: ${error.message}`);
  }
};

// API Routes
// Function to clean up orphaned database entries
const cleanupOrphanedPeers = async () => {
  try {
    console.log('🧹 Cleaning up orphaned database entries...');
    
    // Get all peers from MikroTik
    const mikrotikPeers = await mikrotik.getPeers();
    const activePeerIds = mikrotikPeers.map(peer => String(peer['.id']));
    
    // Get all stored keys from database
    const storedKeys = await database.getAllPeersKeyStatus();
    
    // Find orphaned entries
    const orphanedEntries = storedKeys.filter(stored => 
      !activePeerIds.includes(stored.mikrotik_id)
    );
    
    if (orphanedEntries.length > 0) {
      console.log(`Found ${orphanedEntries.length} orphaned database entries:`);
      orphanedEntries.forEach(entry => {
        console.log(`- "${entry.name}" (ID: ${entry.mikrotik_id})`);
      });
      
      // Delete orphaned entries
      for (const entry of orphanedEntries) {
        await database.deletePeerKeys(entry.mikrotik_id);
        console.log(`✅ Cleaned up orphaned entry: ${entry.name}`);
      }
      
      console.log(`🧹 Cleanup completed: removed ${orphanedEntries.length} orphaned entries`);
    } else {
      console.log('✅ No orphaned entries found');
    }
    
    return orphanedEntries.length;
  } catch (error) {
    console.error('Error during cleanup:', error);
    return 0;
  }
};

// Update the GET /api/peers route to include cleanup
app.get('/api/peers', async (req, res) => {
  try {
    // Optional: Add cleanup parameter
    const cleanup = req.query.cleanup === 'true';
    
    if (cleanup) {
      await cleanupOrphanedPeers();
    }
    
    const peers = await mikrotik.getPeers();
    const storedKeys = await database.getAllPeersKeyStatus();
    
    const formattedPeers = peers.map(peer => {
      const peerId = String(peer['.id']);
      const storedKey = storedKeys.find(sk => sk.mikrotik_id === peerId);
      const peerName = peer.comment || 'Unnamed';
      
      console.log(`Formatting peer - MikroTik ID: ${peerId}, Name: "${peerName}", Has stored keys: ${!!storedKey}`);
      
      return {
        id: peerId,
        name: peerName,
        publicKey: peer['public-key'],
        allowedIPs: peer['allowed-address'],
        endpoint: peer.endpoint || '',
        enabled: peer.disabled !== 'true',
        lastHandshake: peer['last-handshake'] || peer['last-seen'] || 'Never',
        transferRx: peer['rx'] || peer['rx-bytes'] || '0',
        transferTx: peer['tx'] || peer['tx-bytes'] || '0',
        hasPresharedKey: !!(peer['preshared-key']),
        hasStoredKeys: !!storedKey,
        keyCreatedAt: storedKey?.created_at || null
      };
    });
    
    res.json(formattedPeers);
  } catch (error) {
    console.error('Error fetching peers:', error);
    res.status(500).json({ error: error.message });
  }
});
// Manual cleanup route
app.post('/api/cleanup-orphaned-peers', async (req, res) => {
  try {
    const cleanedCount = await cleanupOrphanedPeers();
    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} orphaned entries`,
      cleanedCount 
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});


// NEW: Get peer configuration file - FIXED filename
app.get('/api/peers/:id/config', async (req, res) => {
  try {
    let { id } = req.params;
    
    console.log(`Config route called with ID: "${id}" (type: ${typeof id})`);
    
    // Ensure ID is a string and clean it
    id = String(id).trim();
    
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ error: 'Invalid peer ID provided' });
    }
    
    console.log(`Generating config for peer ID: ${id}`);
    
    // Get peer keys from database
    const storedKeys = await database.getPeerKeys(id);
    console.log('Stored keys found:', !!storedKeys);
    
    if (!storedKeys) {
      const allKeys = await database.getAllPeersKeyStatus();
      console.log('Available peer IDs in database:', allKeys.map(k => k.mikrotik_id));
      
      return res.status(404).json({ 
        error: 'Peer configuration not found. Keys may not be stored for this peer.',
        requestedId: id,
        availableIds: allKeys.map(k => k.mikrotik_id)
      });
    }
    
    // Debug: Log the stored peer name
    console.log(`Stored peer name: "${storedKeys.name}"`);
    
    // Get server info
    const serverInfo = await mikrotik.getServerInfo();
    console.log('Server info retrieved:', !!serverInfo['public-key']);
    
    if (!serverInfo['public-key']) {
      return res.status(500).json({ 
        error: 'Server public key not configured. Please check WireGuard interface setup.' 
      });
    }
    
    // Generate configuration
    let configContent = `[Interface]
PrivateKey = ${storedKeys.private_key}
Address = ${storedKeys.allowed_ips}
DNS = 172.16.0.1

[Peer]
PublicKey = ${serverInfo['public-key']}
Endpoint = ${config.wireguard.serverEndpoint}
AllowedIPs = ${config.wireguard.allowedIPs}`;

    if (storedKeys.preshared_key) {
      configContent += `\nPresharedKey = ${storedKeys.preshared_key}`;
    }

    configContent += `\nPersistentKeepalive = 25`;

    // Use stored name, with fallback to "peer"
    const fileName = (storedKeys.name && storedKeys.name.trim()) ? 
                    storedKeys.name.replace(/[^a-zA-Z0-9-_]/g, '_') : 'peer';
    
    console.log(`Setting filename to: ${fileName}.conf`);

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.conf"`);
    res.send(configContent);
    
    console.log(`✅ Config generated successfully for: ${storedKeys.name} (file: ${fileName}.conf)`);
    
  } catch (error) {
    console.error('Error generating config:', error);
    res.status(500).json({ error: error.message });
  }
});


// Create new peer - Updated with default preshared key
app.post('/api/peers', async (req, res) => {
  try {
    const { name, allowedIPs, usePresharedKey = true } = req.body; // Default to true
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Peer name is required' });
    }

    const interfaceName = config.wireguard?.interfaceName || await mikrotik.getWireGuardInterface();
    
    // Always generate preshared key by default (enhanced security)
    const keys = generateKeys(usePresharedKey);
    
    if (!isValidWireGuardKey(keys.publicKey)) {
      throw new Error('Generated invalid public key');
    }
    
    if (keys.presharedKey && !isValidWireGuardKey(keys.presharedKey)) {
      throw new Error('Generated invalid preshared key');
    }
    
    const finalAllowedIPs = allowedIPs || await getNextAvailableIP();

    const peerData = {
      'interface': interfaceName,
      'public-key': keys.publicKey,
      'allowed-address': finalAllowedIPs,
      comment: name.trim(),
      disabled: 'false'
    };

    // Add preshared key (now default)
    if (keys.presharedKey) {
      peerData['preshared-key'] = keys.presharedKey;
    }

    console.log(`Creating peer "${name.trim()}" with${keys.presharedKey ? ' enhanced' : ''} security`);
    const mikrotikId = await mikrotik.createPeer(peerData);
    
    if (!mikrotikId || mikrotikId === '') {
      throw new Error('Failed to get valid MikroTik peer ID');
    }
    
    console.log('Got MikroTik ID:', mikrotikId, 'for peer:', name.trim());
    
    // Save keys to database
    try {
      const dbData = {
        mikrotik_id: String(mikrotikId),
        name: name.trim(),
        private_key: keys.privateKey,
        preshared_key: keys.presharedKey || null,
        allowed_ips: finalAllowedIPs
      };
      
      console.log('Saving to database:', {
        mikrotik_id: dbData.mikrotik_id,
        name: `"${dbData.name}"`,
        allowed_ips: dbData.allowed_ips,
        has_private_key: !!dbData.private_key,
        has_preshared_key: !!dbData.preshared_key,
        security_level: dbData.preshared_key ? 'Enhanced (PSK)' : 'Standard'
      });
      
      await database.savePeerKeys(dbData);
      console.log(`✅ Keys saved to database successfully for peer: "${dbData.name}"`);
      
    } catch (dbError) {
      console.error('Database save error:', dbError);
      try {
        await mikrotik.deletePeer(mikrotikId);
        console.log('Cleaned up MikroTik peer after database error');
      } catch (cleanupError) {
        console.error('Failed to cleanup peer after database error:', cleanupError);
      }
      throw new Error(`Failed to save peer keys: ${dbError.message}`);
    }
    
    res.json({
      id: String(mikrotikId),
      name: name.trim(),
      publicKey: keys.publicKey,
      allowedIPs: finalAllowedIPs,
      enabled: true,
      lastHandshake: 'Never',
      transferRx: '0',
      transferTx: '0',
      hasPresharedKey: !!keys.presharedKey,
      hasStoredKeys: true
    });
  } catch (error) {
    console.error('Error creating peer:', error);
    res.status(500).json({ error: error.message });
  }
});




// Update peer - Enhanced with default preshared key for complete regeneration
app.put('/api/peers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, allowedIPs, enabled, updatePresharedKey = false, regenerateCompletely = false } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Peer name is required' });
    }

    if (regenerateCompletely) {
      // Generate completely new keys WITH preshared key by default
      const newKeys = generateKeys(true); // Always include preshared key for complete regen
      
      if (!isValidWireGuardKey(newKeys.publicKey) || !isValidWireGuardKey(newKeys.presharedKey)) {
        throw new Error('Generated invalid keys');
      }
      
      // Delete old peer and create new one
      await mikrotik.deletePeer(id);
      await database.deletePeerKeys(id);
      
      const interfaceName = config.wireguard?.interfaceName || await mikrotik.getWireGuardInterface();
      const peerData = {
        'interface': interfaceName,
        'public-key': newKeys.publicKey,
        'allowed-address': allowedIPs,
        'preshared-key': newKeys.presharedKey, // Always include for complete regen
        comment: name.trim(),
        disabled: enabled ? 'false' : 'true'
      };
      
      const newId = await mikrotik.createPeer(peerData);
      
      // Save new keys to database
      await database.savePeerKeys({
        mikrotik_id: newId,
        name: name.trim(),
        private_key: newKeys.privateKey,
        preshared_key: newKeys.presharedKey,
        allowed_ips: allowedIPs
      });
      
      console.log(`✅ Peer "${name.trim()}" completely regenerated with enhanced security (PSK)`);
      
      res.json({
        id: newId,
        name: name.trim(),
        publicKey: newKeys.publicKey,
        allowedIPs: allowedIPs,
        enabled: enabled,
        lastHandshake: 'Never',
        transferRx: '0',
        transferTx: '0',
        hasPresharedKey: true,
        hasStoredKeys: true,
        regenerated: true
      });
    } else {
      // Regular update
      const updateData = {
        comment: name.trim(),
        'allowed-address': allowedIPs,
        disabled: enabled ? 'false' : 'true'
      };

      let newPresharedKey = null;
      if (updatePresharedKey) {
        const { presharedKey } = generateKeys(true);
        
        if (!isValidWireGuardKey(presharedKey)) {
          throw new Error('Generated invalid preshared key');
        }
        
        updateData['preshared-key'] = presharedKey;
        newPresharedKey = presharedKey;
        
        // Update preshared key in database
        await database.updatePresharedKey(id, presharedKey);
        console.log(`✅ Updated preshared key for peer: "${name.trim()}"`);
      }

      await mikrotik.updatePeer(id, updateData);
      
      res.json({
        id: id,
        name: name.trim(),
        allowedIPs: allowedIPs,
        enabled: enabled,
        lastHandshake: 'Never',
        transferRx: '0',
        transferTx: '0',
        hasPresharedKey: !!(newPresharedKey),
        hasStoredKeys: true,
        newPresharedKey: newPresharedKey
      });
    }
  } catch (error) {
    console.error('Error updating peer:', error);
    res.status(500).json({ error: error.message });
  }
});


// Enhanced delete peer route
app.delete('/api/peers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    try {
      // Try to delete from MikroTik first
      await mikrotik.deletePeer(id);
    } catch (mikrotikError) {
      console.warn(`Failed to delete peer from MikroTik (may already be deleted): ${mikrotikError.message}`);
      // Continue to clean up database even if MikroTik delete fails
    }
    
    // Always clean up from database
    await database.deletePeerKeys(id);
    
    res.json({ success: true, message: 'Peer deleted (including orphaned data if any)' });
  } catch (error) {
    console.error('Error deleting peer:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW: Get peer configuration file - FIXED with ID validation
app.get('/api/peers/:id/config', async (req, res) => {
  try {
    let { id } = req.params;
    
    // Debug: Log the received ID
    console.log(`Config route called with ID: "${id}" (type: ${typeof id})`);
    
    // Ensure ID is a string and clean it
    id = String(id).trim();
    
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ error: 'Invalid peer ID provided' });
    }
    
    console.log(`Generating config for peer ID: ${id}`);
    
    // Get peer keys from database
    const storedKeys = await database.getPeerKeys(id);
    console.log('Stored keys found:', !!storedKeys);
    
    if (!storedKeys) {
      // Debug: Let's see what IDs we have in the database
      const allKeys = await database.getAllPeersKeyStatus();
      console.log('Available peer IDs in database:', allKeys.map(k => k.mikrotik_id));
      
      return res.status(404).json({ 
        error: 'Peer configuration not found. Keys may not be stored for this peer.',
        requestedId: id,
        availableIds: allKeys.map(k => k.mikrotik_id)
      });
    }
    
    // Get server info
    const serverInfo = await mikrotik.getServerInfo();
    console.log('Server info retrieved:', !!serverInfo['public-key']);
    
    if (!serverInfo['public-key']) {
      return res.status(500).json({ 
        error: 'Server public key not configured. Please check WireGuard interface setup.' 
      });
    }
    
    // Generate configuration
    let configContent = `[Interface]
PrivateKey = ${storedKeys.private_key}
Address = ${storedKeys.allowed_ips}
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverInfo['public-key']}
Endpoint = ${config.wireguard.serverEndpoint}
AllowedIPs = ${config.wireguard.allowedIPs}`;

    if (storedKeys.preshared_key) {
      configContent += `\nPresharedKey = ${storedKeys.preshared_key}`;
    }

    configContent += `\nPersistentKeepalive = 25`;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${storedKeys.name}.conf"`);
    res.send(configContent);
    
    console.log(`✅ Config generated successfully for: ${storedKeys.name}`);
    
  } catch (error) {
    console.error('Error generating config:', error);
    res.status(500).json({ error: error.message });
  }
});



// Get server info
app.get('/api/server-info', async (req, res) => {
  try {
    console.log('Fetching server info from MikroTik...');
    const serverInfo = await mikrotik.getServerInfo();
    console.log('Raw server info from MikroTik:', serverInfo);
    
    const response = {
      publicKey: serverInfo['public-key'] || null,
      endpoint: config.wireguard.serverEndpoint || 'your.server.com:51820',
      port: serverInfo['listen-port'] || config.wireguard.serverPort || 51820,
      allowedIPs: config.wireguard.allowedIPs || '0.0.0.0/0',
      interfaceName: serverInfo.name || config.wireguard.interfaceName || 'wg0'
    };
    
    console.log('Formatted server info response:', response);
    
    if (!response.publicKey) {
      console.warn('⚠️  No server public key found. Please check WireGuard interface configuration.');
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching server info:', error);
    res.status(500).json({ 
      error: error.message,
      publicKey: null,
      endpoint: config.wireguard.serverEndpoint || 'your.server.com:51820',
      port: config.wireguard.serverPort || 51820,
      allowedIPs: config.wireguard.allowedIPs || '0.0.0.0/0'
    });
  }
});
// Debug route to check database contents
app.get('/api/debug/database-peers', async (req, res) => {
  try {
    const allPeers = await database.getAllPeersKeyStatus();
    res.json({
      count: allPeers.length,
      peers: allPeers.map(peer => ({
        mikrotik_id: peer.mikrotik_id,
        mikrotik_id_type: typeof peer.mikrotik_id,
        name: peer.name,
        allowed_ips: peer.allowed_ips,
        created_at: peer.created_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Toggle peer status (enable/disable)
app.patch('/api/peers/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Toggling status for peer ID: ${id}`);
    
    // First, get the current peer status
    const currentPeer = await mikrotik.getPeer(id);
    if (!currentPeer) {
      return res.status(404).json({ error: 'Peer not found' });
    }
    
    // Determine new status (toggle current status)
    const currentlyDisabled = currentPeer.disabled === 'true';
    const newDisabledStatus = currentlyDisabled ? 'false' : 'true';
    const newEnabledStatus = !currentlyDisabled;
    
    console.log(`Peer "${currentPeer.comment}" - Current: ${currentlyDisabled ? 'Disabled' : 'Enabled'}, New: ${newEnabledStatus ? 'Enabled' : 'Disabled'}`);
    
    // Update the peer status
    const updateData = {
      disabled: newDisabledStatus
    };
    
    await mikrotik.updatePeer(id, updateData);
    
    // Get updated peer info
    const updatedPeer = await mikrotik.getPeer(id);
    
    res.json({
      id: updatedPeer['.id'],
      name: updatedPeer.comment || 'Unnamed',
      enabled: updatedPeer.disabled !== 'true',
      message: `Peer ${newEnabledStatus ? 'enabled' : 'disabled'} successfully`
    });
    
  } catch (error) {
    console.error('Error toggling peer status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Graceful shutdown...');
  try {
    await database.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Frontend will be available at http://localhost:3000`);
  }
  
  // Test MikroTik connection on startup
  setTimeout(async () => {
    try {
      console.log('Testing MikroTik connection...');
      await mikrotik.connect();
      console.log('✅ MikroTik connection test successful');
    } catch (error) {
      console.log('❌ MikroTik connection test failed');
      console.log('Server will continue running, but peer management will not work until connection is fixed.');
    }
  }, 2000);
});
