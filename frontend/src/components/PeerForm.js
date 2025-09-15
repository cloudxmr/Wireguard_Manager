import React, { useState } from 'react';

function PeerForm({ peer, onSubmit, onCancel, isEditing = false }) {
  const [formData, setFormData] = useState({
    name: peer?.name || '',
    allowedIPs: peer?.allowedIPs || '',
    enabled: peer?.enabled !== false,
    usePresharedKey: peer?.hasPresharedKey !== false ? true : true, // Default to true
    updatePresharedKey: false,
    regenerateCompletely: false
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Peer name is required');
      return;
    }
    onSubmit(formData);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  return (
    <form className="peer-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="name">Peer Name *</label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="Enter peer name (e.g., John's Phone)"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="allowedIPs">Allowed IPs</label>
        <input
          type="text"
          id="allowedIPs"
          name="allowedIPs"
          value={formData.allowedIPs}
          onChange={handleChange}
          placeholder={isEditing ? "Current IP assignment" : "Leave empty for auto-assignment"}
          disabled={!isEditing && !formData.allowedIPs}
        />
        {!isEditing && (
          <small style={{ color: '#666', fontSize: '12px' }}>
            Leave empty to automatically assign the next available IP
          </small>
        )}
      </div>

      <div className="form-group">
        <label>
          <input
            type="checkbox"
            name="enabled"
            checked={formData.enabled}
            onChange={handleChange}
            style={{ marginRight: '8px' }}
          />
          Enable peer
        </label>
      </div>

      {!isEditing && (
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              name="usePresharedKey"
              checked={formData.usePresharedKey}
              onChange={handleChange}
              style={{ marginRight: '8px' }}
            />
            Use preshared key (enhanced security)
          </label>
          <div className="psk-info">
            <strong>✅ Recommended:</strong> Preshared keys provide additional quantum-resistant security and are enabled by default for maximum protection.
          </div>
        </div>
      )}

      {isEditing && (
        <>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                name="updatePresharedKey"
                checked={formData.updatePresharedKey}
                onChange={handleChange}
                style={{ marginRight: '8px' }}
              />
              {peer?.hasPresharedKey ? 'Regenerate preshared key' : 'Add preshared key'}
            </label>
            <small style={{ color: '#666', fontSize: '12px', display: 'block', marginTop: '5px' }}>
              {peer?.hasPresharedKey 
                ? 'This will generate a new preshared key and require client reconfiguration'
                : 'Add a preshared key for enhanced security (recommended)'
              }
            </small>
          </div>

          {!peer?.hasStoredKeys && (
            <div className="form-group">
              <div className="psk-warning">
                <strong>⚠️ Configuration Not Available</strong>
                <p>Private key is not stored for this peer. If you need a complete configuration file:</p>
                <label>
                  <input
                    type="checkbox"
                    name="regenerateCompletely"
                    checked={formData.regenerateCompletely || false}
                    onChange={handleChange}
                    style={{ marginRight: '8px' }}
                  />
                  Regenerate peer completely (new private & public keys with preshared key)
                </label>
                <small style={{ color: '#856404', fontSize: '12px', display: 'block', marginTop: '5px' }}>
                  This will create entirely new keys and require reconfiguration of the client
                </small>
              </div>
            </div>
          )}
        </>
      )}

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {isEditing ? 'Update' : 'Create'} Peer
        </button>
      </div>
    </form>
  );
}

export default PeerForm;
