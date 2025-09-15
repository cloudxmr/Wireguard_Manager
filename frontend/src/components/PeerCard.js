import React from 'react';

function PeerCard({ peer, onEdit, onDelete, onShowConfig, onToggle }) {
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const parseMikroTikDuration = (durationStr) => {
    if (!durationStr || durationStr === '0' || durationStr === '') return 'Never';
    
    const matches = durationStr.match(/(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?/);
    if (!matches) return durationStr;
    
    const parts = [];
    if (matches[1]) parts.push(matches[1]);
    if (matches[2]) parts.push(matches[2]);
    if (matches[3]) parts.push(matches[3]);
    if (matches[4]) parts.push(matches[4]);
    if (matches[5]) parts.push(matches[5]);
    
    if (parts.length === 0) return durationStr;
    return `${parts.join(' ')} ago`;
  };

  const formatLastHandshake = (timestamp) => {
    if (!timestamp || timestamp === 'Never' || timestamp === '' || timestamp === '0') {
      return 'Never';
    }
    
    if (typeof timestamp === 'string' && timestamp.match(/[wdhms]/)) {
      return parseMikroTikDuration(timestamp);
    }
    
    if (typeof timestamp === 'string' && (timestamp.includes('/') || timestamp.includes('-'))) {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toLocaleString();
      }
    }
    
    if (typeof timestamp === 'number' || (typeof timestamp === 'string' && !isNaN(timestamp))) {
      const num = Number(timestamp);
      if (num > 0) {
        const date = new Date(num * 1000);
        const now = new Date();
        const diffYears = Math.abs(now.getFullYear() - date.getFullYear());
        
        if (diffYears < 50) {
          return date.toLocaleString();
        }
      }
    }
    
    return timestamp.toString();
  };

  const formatKeyCreatedDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return null;
    }
  };

  return (
    <div className={`peer-card ${peer.enabled ? 'peer-enabled' : 'peer-disabled'}`}>
      <h3>
        {peer.name || 'Unnamed Peer'}
        <div className="peer-indicators">
          {peer.hasPresharedKey && (
            <div className="peer-psk-indicator" title="Uses preshared key">🔒</div>
          )}
          {peer.hasStoredKeys && (
            <div className="peer-config-indicator" title="Configuration available">📄</div>
          )}
          <div className={`peer-status ${peer.enabled ? 'enabled' : 'disabled'}`}></div>
        </div>
      </h3>
      
      <div className="peer-info">
        <p><strong>IP Address:</strong> {peer.allowedIPs}</p>
        <p><strong>Public Key:</strong> {peer.publicKey?.substring(0, 20)}...</p>
        <p><strong>Status:</strong> 
          <span className={`status-badge ${peer.enabled ? 'status-enabled' : 'status-disabled'}`}>
            {peer.enabled ? '🟢 Enabled' : '🔴 Disabled'}
          </span>
        </p>
        <p><strong>Security:</strong> 
		  <span className={peer.hasPresharedKey ? 'security-level-enhanced' : 'security-level-standard'}>
			{peer.hasPresharedKey ? '🔒 Enhanced (PSK)' : '⚠️ Standard'}
		  </span>
		  {peer.hasPresharedKey && <span className="peer-security-enhanced">Quantum Resistant</span>}
		</p>
        <p><strong>Last Handshake:</strong> {formatLastHandshake(peer.lastHandshake)}</p>
        <p><strong>Transfer:</strong> ↓{formatBytes(parseInt(peer.transferRx || 0))} ↑{formatBytes(parseInt(peer.transferTx || 0))}</p>
        
        {peer.hasStoredKeys && peer.keyCreatedAt && (
          <p style={{ color: '#28a745', fontSize: '12px', fontStyle: 'italic' }}>
            Keys stored since: {formatKeyCreatedDate(peer.keyCreatedAt)}
          </p>
        )}
        
        {!peer.hasStoredKeys && (
          <p style={{ color: '#856404', fontSize: '12px', fontStyle: 'italic' }}>
            Config not available (keys not stored)
          </p>
        )}
      </div>

      <div className="peer-actions">
        {/* Toggle Button - Changes based on current status */}
        <button 
          className={`btn ${peer.enabled ? 'btn-warning' : 'btn-success'}`}
          onClick={onToggle}
          title={peer.enabled ? 'Disable this peer' : 'Enable this peer'}
        >
          {peer.enabled ? '⏸️ Disable' : '▶️ Enable'}
        </button>
        
        <button className="btn btn-secondary" onClick={onEdit}>
          ✏️ Edit
        </button>
        
        <button 
          className={`btn ${peer.hasStoredKeys ? 'btn-info' : 'btn-disabled'}`} 
          onClick={() => peer.hasStoredKeys && onShowConfig()}
          disabled={!peer.hasStoredKeys}
          title={peer.hasStoredKeys ? 'Download configuration' : 'Configuration not available'}
        >
          📄 Config
        </button>
        
        <button className="btn btn-danger" onClick={onDelete}>
          🗑️ Delete
        </button>
      </div>
    </div>
  );
}

export default PeerCard;
