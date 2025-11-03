export const ElectionsTab: React.FC = () => {
  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>Elections</h3>
        <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '5px' }}>
          Election tracking and multi-block election phases
        </div>
      </div>

      <div className="empty-state">
        <div className="empty-state-icon">🗳️</div>
        <div>Election tracking coming soon</div>
        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
          This tab will show election phases, including:
          <ul style={{ textAlign: 'left', marginTop: '10px', maxWidth: '400px', margin: '10px auto' }}>
            <li>Off / Snapshot / Signed / Unsigned / Export phases</li>
            <li>Election round progress</li>
            <li>Validator and nominator counts</li>
            <li>Minimum untrusted score</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
