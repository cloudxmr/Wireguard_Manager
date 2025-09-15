import React from 'react';
import PeerCard from './PeerCard';

function PeerList({ peers, onEdit, onDelete, onShowConfig, onToggle }) {
  if (peers.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>
        <h3>No peers configured</h3>
        <p>Click "Add New Peer" to create your first WireGuard peer</p>
      </div>
    );
  }

  return (
    <div className="peer-list">
      {peers.map(peer => (
        <PeerCard
          key={peer.id}
          peer={peer}
          onEdit={() => onEdit(peer)}
          onDelete={() => onDelete(peer.id)}
          onShowConfig={() => onShowConfig(peer.id, peer.name)}
          onToggle={() => onToggle(peer.id, peer.name, peer.enabled)}
        />
      ))}
    </div>
  );
}

export default PeerList;
