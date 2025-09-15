import React, { useState, useEffect } from 'react';
import axios from 'axios';
import PeerList from './components/PeerList';
import PeerForm from './components/PeerForm';
import Modal from 'react-modal';
import './App.css';

Modal.setAppElement('#root');

function App() {
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPeer, setEditingPeer] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);

  useEffect(() => {
    fetchPeers();
    fetchServerInfo();
  }, []);

  const fetchPeers = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/peers');
      setPeers(response.data);
      setError(null);
    } catch (error) {
      setError('Failed to fetch peers: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchServerInfo = async () => {
    try {
      console.log('Fetching server info...');
      const response = await axios.get('/api/server-info');
      console.log('Server info received:', response.data);
      setServerInfo(response.data);
    } catch (error) {
      console.error('Failed to fetch server info:', error);
      setServerInfo({
        publicKey: null,
        endpoint: 'Not configured',
        port: 51820,
        allowedIPs: '0.0.0.0/0'
      });
    }
  };

  const handleCreatePeer = async (peerData) => {
    try {
      const response = await axios.post('/api/peers', peerData);
      setPeers([...peers, response.data]);
      setShowAddForm(false);
      
      // Auto-download config for new peer
      setTimeout(() => {
        downloadPeerConfig(response.data.id, response.data.name);
      }, 500);
      
      alert(`Peer "${response.data.name}" created successfully! Configuration file will be downloaded automatically.`);
    } catch (error) {
      alert('Failed to create peer: ' + error.response?.data?.error || error.message);
    }
  };

  const handleUpdatePeer = async (id, peerData) => {
    try {
      const response = await axios.put(`/api/peers/${id}`, peerData);
      setPeers(peers.map(peer => peer.id === id ? response.data : peer));
      setEditingPeer(null);
      
      // Auto-download config if keys were regenerated
      if (response.data.regenerated || response.data.newPresharedKey) {
        setTimeout(() => {
          downloadPeerConfig(response.data.id, response.data.name);
        }, 500);
        
        const message = response.data.regenerated 
          ? `Peer completely regenerated! New configuration will be downloaded.` 
          : `Peer updated with new preshared key! Updated configuration will be downloaded.`;
        alert(message);
      } else {
        alert('Peer updated successfully!');
      }
    } catch (error) {
      alert('Failed to update peer: ' + error.response?.data?.error || error.message);
    }
  };

  const handleDeletePeer = async (id) => {
    const peer = peers.find(p => p.id === id);
    if (!window.confirm(`Are you sure you want to delete "${peer?.name}"? This will also remove all stored keys.`)) {
      return;
    }

    try {
      await axios.delete(`/api/peers/${id}`);
      setPeers(peers.filter(peer => peer.id !== id));
      alert('Peer deleted successfully!');
    } catch (error) {
      alert('Failed to delete peer: ' + error.response?.data?.error || error.message);
    }
  };

// Download config using database-stored keys - FIXED to use server filename
const downloadPeerConfig = async (peerId, peerName) => {
  try {
    console.log('downloadPeerConfig called with:', {
      peerId: peerId,
      peerIdType: typeof peerId,
      peerName: peerName,
      peerNameType: typeof peerName
    });
    
    // Fix: Ensure peerId is a string
    let actualPeerId = peerId;
    if (typeof peerId === 'object') {
      console.warn('Peer ID is an object:', peerId);
      actualPeerId = peerId.id || peerId['.id'] || String(peerId);
    }
    actualPeerId = String(actualPeerId);
    
    console.log(`Downloading config for peer ID: ${actualPeerId}`);
    
    const response = await axios.get(`/api/peers/${actualPeerId}/config`, {
      responseType: 'blob'
    });
    
    // Extract filename from Content-Disposition header if available
    let fileName = 'peer.conf'; // default fallback
    const contentDisposition = response.headers['content-disposition'];
    if (contentDisposition) {
      const matches = contentDisposition.match(/filename="(.+)"/);
      if (matches && matches[1]) {
        fileName = matches[1];
        console.log(`Using server-provided filename: ${fileName}`);
      }
    }
    
    // If no server filename, use the peer name as fallback
    if (fileName === 'peer.conf' && peerName && peerName !== 'undefined') {
      fileName = `${peerName.replace(/[^a-zA-Z0-9-_]/g, '_')}.conf`;
      console.log(`Using fallback filename: ${fileName}`);
    }
    
    // Create download link
    const blob = new Blob([response.data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`✅ Configuration downloaded as: ${fileName}`);
  } catch (error) {
    console.error('Failed to download config:', error);
    
    if (error.response?.status === 404) {
      alert(`Configuration not available for "${peerName}". Keys may not be stored for this peer. Try recreating the peer.`);
    } else if (error.response?.status === 500) {
      try {
        const errorText = await error.response.data.text();
        const errorData = JSON.parse(errorText);
        alert(`Server error: ${errorData.error}`);
      } catch {
        alert(`Server error generating configuration. Check server logs for details.`);
      }
    } else {
      alert(`Failed to download configuration: ${error.message}`);
    }
  }
};
// Add cleanup function
const handleCleanupOrphaned = async () => {
  if (!window.confirm('Clean up database entries for peers that no longer exist on MikroTik router?')) {
    return;
  }

  try {
    const response = await axios.post('/api/cleanup-orphaned-peers');
    alert(`Cleanup completed: ${response.data.message}`);
    fetchPeers(); // Refresh the list
  } catch (error) {
    alert('Cleanup failed: ' + error.response?.data?.error || error.message);
  }
};

// Add this function to the App component
const handleTogglePeer = async (peerId, peerName, currentStatus) => {
  const action = currentStatus ? 'disable' : 'enable';
  
  if (!window.confirm(`Are you sure you want to ${action} "${peerName}"?`)) {
    return;
  }

  try {
    const response = await axios.patch(`/api/peers/${peerId}/toggle`);
    
    // Update the peer in the local state
    setPeers(peers.map(peer => 
      peer.id === peerId 
        ? { ...peer, enabled: response.data.enabled }
        : peer
    ));
    
    alert(response.data.message);
  } catch (error) {
    console.error('Failed to toggle peer:', error);
    alert('Failed to toggle peer: ' + (error.response?.data?.error || error.message));
  }
};

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
		<header className="app-header">
		  <h1>WireGuard Peer Manager</h1>
		  <div className="header-actions">
			<button 
			  className="btn btn-secondary"
			  onClick={fetchPeers}
			  title="Refresh peer list"
			>
			  🔄 Refresh
			</button>
			<button 
			  className="btn btn-warning"
			  onClick={handleCleanupOrphaned}
			  title="Clean up orphaned database entries"
			>
			  🧹 Cleanup
			</button>
			<button 
			  className="btn btn-primary"
			  onClick={() => setShowAddForm(true)}
			>
			  Add New Peer
			</button>
		  </div>
		</header>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={fetchPeers}>Retry</button>
        </div>
      )}

      <main className="app-main">
        <PeerList 
          peers={peers}
          onEdit={setEditingPeer}
          onDelete={handleDeletePeer}
          onShowConfig={downloadPeerConfig}
		  onToggle={handleTogglePeer}
        />
      </main>

      <Modal
        isOpen={showAddForm}
        onRequestClose={() => setShowAddForm(false)}
        className="modal"
        overlayClassName="modal-overlay"
      >
        <div className="modal-header">
          <h2>Add New Peer</h2>
          <button 
            className="modal-close"
            onClick={() => setShowAddForm(false)}
          >
            ×
          </button>
        </div>
        <PeerForm 
          onSubmit={handleCreatePeer}
          onCancel={() => setShowAddForm(false)}
        />
      </Modal>

      <Modal
        isOpen={!!editingPeer}
        onRequestClose={() => setEditingPeer(null)}
        className="modal"
        overlayClassName="modal-overlay"
      >
        <div className="modal-header">
          <h2>Edit Peer</h2>
          <button 
            className="modal-close"
            onClick={() => setEditingPeer(null)}
          >
            ×
          </button>
        </div>
        {editingPeer && (
          <PeerForm 
            peer={editingPeer}
            onSubmit={(data) => handleUpdatePeer(editingPeer.id, data)}
            onCancel={() => setEditingPeer(null)}
            isEditing
          />
        )}
      </Modal>
    </div>
  );
}

export default App;
