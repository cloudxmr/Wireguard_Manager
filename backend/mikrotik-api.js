const { RouterOSAPI } = require('node-routeros');

class MikrotikAPI {
  constructor(config) {
    this.config = config;
    this.conn = null;
    this.isConnected = false;
    this.wireguardInterface = null;
  }

  async connect() {
    if (this.conn && this.isConnected) return this.conn;
    
    try {
      console.log(`Connecting to MikroTik at ${this.config.host}:${this.config.port || 8728}...`);
      
      this.conn = new RouterOSAPI({
        host: this.config.host,
        user: this.config.username,
        password: this.config.password,
        port: this.config.port || 8728,
        timeout: 15000
      });

      await this.conn.connect();
      this.isConnected = true;
      console.log('✅ Connected to MikroTik router successfully');
      return this.conn;
    } catch (error) {
      this.isConnected = false;
      console.error('❌ Failed to connect to MikroTik:', error.message);
      throw error;
    }
  }

  async ensureConnection() {
    if (!this.conn || !this.isConnected) {
      await this.connect();
    }
  }

  async getWireGuardInterface() {
    if (this.wireguardInterface) return this.wireguardInterface;
    
    try {
      await this.ensureConnection();
      const interfaces = await this.conn.write('/interface/wireguard/print');
      
      if (interfaces.length === 0) {
        throw new Error('No WireGuard interfaces found. Please create a WireGuard interface first.');
      }
      
      // Use configured interface name or first available
      const targetInterface = this.config.wireguard?.interfaceName;
      
      if (targetInterface) {
        const found = interfaces.find(iface => iface.name === targetInterface);
        if (!found) {
          throw new Error(`WireGuard interface '${targetInterface}' not found. Available: ${interfaces.map(i => i.name).join(', ')}`);
        }
        this.wireguardInterface = targetInterface;
      } else {
        this.wireguardInterface = interfaces[0].name;
        console.log(`Using WireGuard interface: ${this.wireguardInterface}`);
      }
      
      return this.wireguardInterface;
    } catch (error) {
      throw new Error(`Failed to get WireGuard interface: ${error.message}`);
    }
  }

  async getPeer(id) {
    await this.ensureConnection();
    try {
      console.log(`Getting peer with ID: ${id}`);
      
      // Get all peers and filter manually since MikroTik API filtering is inconsistent
      const allPeers = await this.conn.write('/interface/wireguard/peers/print');
      const peer = allPeers.find(p => p['.id'] === id);
      
      if (!peer) {
        console.log(`Peer with ID ${id} not found. Available IDs:`, allPeers.map(p => p['.id']));
        throw new Error('Peer not found');
      }
      
      console.log(`Found peer:`, peer);
      return peer;
    } catch (error) {
      throw new Error(`Failed to get peer: ${error.message}`);
    }
  }

  async getPeers() {
	  await this.ensureConnection();
	  try {
		// Get all WireGuard peers
		const peers = await this.conn.write('/interface/wireguard/peers/print');
		
		// Debug: Log the raw peer data
		console.log('Raw peer data from MikroTik:', JSON.stringify(peers, null, 2));
		
		// Filter by interface in JavaScript if needed
		const interfaceName = await this.getWireGuardInterface();
		return peers.filter(peer => peer.interface === interfaceName || !peer.interface);
	  } catch (error) {
		if (error.message.includes('no such item') || error.message.includes('not found')) {
		  console.log('No WireGuard peers found or WireGuard not properly configured.');
		  return [];
		}
		throw new Error(`Failed to get peers: ${error.message}`);
	  }
  }

  async createPeer(peerData) {
  await this.ensureConnection();
  
  try {
    if (!peerData.interface) {
      peerData.interface = await this.getWireGuardInterface();
    }
    
    const command = ['/interface/wireguard/peers/add'];
    Object.entries(peerData).forEach(([key, value]) => {
      command.push(`=${key}=${value}`);
    });
    
    console.log('Creating peer with command:', command);
    const result = await this.conn.write(command);
    console.log('MikroTik createPeer result:', result);
    
    // Handle different response formats
    let mikrotikId = null;
    
    if (result && typeof result === 'object') {
      // Check for ret property first
      if (result.ret) {
        mikrotikId = result.ret;
      }
      // Check if result is an array with ID
      else if (Array.isArray(result) && result.length > 0 && result[0]['.id']) {
        mikrotikId = result[0]['.id'];
      }
      // Check if result has direct .id property
      else if (result['.id']) {
        mikrotikId = result['.id'];
      }
      // Check for after property (some MikroTik versions)
      else if (result.after) {
        mikrotikId = result.after;
      }
    }
    
    console.log('Extracted MikroTik ID:', mikrotikId);
    
    if (!mikrotikId) {
      // If no ID returned, try to find the peer we just created
      console.log('No ID returned, searching for newly created peer...');
      const peers = await this.getPeers();
      const newPeer = peers.find(peer => 
        peer['public-key'] === peerData['public-key'] &&
        peer.comment === peerData.comment
      );
      
      if (newPeer) {
        mikrotikId = newPeer['.id'];
        console.log('Found newly created peer with ID:', mikrotikId);
      } else {
        throw new Error('Failed to get ID for newly created peer');
      }
    }
    
    return mikrotikId;
  } catch (error) {
    throw new Error(`Failed to create peer: ${error.message}`);
  }
}


  async updatePeer(id, peerData) {
    await this.ensureConnection();
    try {
      const command = ['/interface/wireguard/peers/set', `=.id=${id}`];
      Object.entries(peerData).forEach(([key, value]) => {
        command.push(`=${key}=${value}`);
      });
      
      await this.conn.write(command);
    } catch (error) {
      throw new Error(`Failed to update peer: ${error.message}`);
    }
  }

  async deletePeer(id) {
    await this.ensureConnection();
    try {
      await this.conn.write('/interface/wireguard/peers/remove', [`=.id=${id}`]);
    } catch (error) {
      throw new Error(`Failed to delete peer: ${error.message}`);
    }
  }

  // Get server info
	async getServerInfo() {
    await this.ensureConnection();
    try {
      const interfaces = await this.conn.write('/interface/wireguard/print');
      return interfaces[0] || {};
    } catch (error) {
      throw new Error(`Failed to get server info: ${error.message}`);
    }
  }


}

module.exports = { MikrotikAPI };
