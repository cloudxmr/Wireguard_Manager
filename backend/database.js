const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    const dbPath = path.join(__dirname, 'wireguard_peers.db');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Failed to connect to SQLite database:', err.message);
      } else {
        console.log('✅ Connected to SQLite database:', dbPath);
        this.initializeTables();
      }
    });
  }

  initializeTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS peer_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mikrotik_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        private_key TEXT NOT NULL,
        preshared_key TEXT,
        allowed_ips TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.run(createTableSQL, (err) => {
      if (err) {
        console.error('❌ Failed to create peer_keys table:', err.message);
      } else {
        console.log('✅ Peer keys table is ready');
      }
    });
  }

  // Save or update peer keys
  savePeerKeys(peerData) {
    return new Promise((resolve, reject) => {
      const { mikrotik_id, name, private_key, preshared_key, allowed_ips } = peerData;
      
      const insertSQL = `
        INSERT OR REPLACE INTO peer_keys 
        (mikrotik_id, name, private_key, preshared_key, allowed_ips, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      this.db.run(insertSQL, [mikrotik_id, name, private_key, preshared_key, allowed_ips], function(err) {
        if (err) {
          console.error('Failed to save peer keys:', err.message);
          reject(err);
        } else {
          console.log(`✅ Saved keys for peer: ${name} (ID: ${mikrotik_id})`);
          resolve(this.lastID);
        }
      });
    });
  }

// Get peer keys by MikroTik ID
getPeerKeys(mikrotik_id) {
  return new Promise((resolve, reject) => {
    const selectSQL = 'SELECT * FROM peer_keys WHERE mikrotik_id = ?';
    
    console.log(`Looking for peer keys with MikroTik ID: ${mikrotik_id}`);
    
    this.db.get(selectSQL, [mikrotik_id], (err, row) => {
      if (err) {
        console.error('Failed to get peer keys:', err.message);
        reject(err);
      } else {
        console.log('Database query result:', row ? 'Found' : 'Not found');
        if (row) {
          console.log(`Peer keys found - Name: "${row.name}", ID: ${row.mikrotik_id}`);
        }
        resolve(row);
      }
    });
  });
}



  // Update preshared key only
  updatePresharedKey(mikrotik_id, preshared_key) {
    return new Promise((resolve, reject) => {
      const updateSQL = `
        UPDATE peer_keys 
        SET preshared_key = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE mikrotik_id = ?
      `;

      this.db.run(updateSQL, [preshared_key, mikrotik_id], function(err) {
        if (err) {
          console.error('Failed to update preshared key:', err.message);
          reject(err);
        } else {
          console.log(`✅ Updated preshared key for peer ID: ${mikrotik_id}`);
          resolve(this.changes);
        }
      });
    });
  }

  // Delete peer keys
  deletePeerKeys(mikrotik_id) {
    return new Promise((resolve, reject) => {
      const deleteSQL = 'DELETE FROM peer_keys WHERE mikrotik_id = ?';
      
      this.db.run(deleteSQL, [mikrotik_id], function(err) {
        if (err) {
          console.error('Failed to delete peer keys:', err.message);
          reject(err);
        } else {
          console.log(`✅ Deleted keys for peer ID: ${mikrotik_id}`);
          resolve(this.changes);
        }
      });
    });
  }

  // Get all peers with key availability status
  getAllPeersKeyStatus() {
    return new Promise((resolve, reject) => {
      const selectSQL = 'SELECT mikrotik_id, name, allowed_ips, created_at FROM peer_keys';
      
      this.db.all(selectSQL, [], (err, rows) => {
        if (err) {
          console.error('Failed to get peers key status:', err.message);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Close database connection
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
          reject(err);
        } else {
          console.log('✅ Database connection closed');
          resolve();
        }
      });
    });
  }
}

module.exports = new Database();
