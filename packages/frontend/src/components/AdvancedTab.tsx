import { useState, useEffect } from 'react';
import { useDatabaseTables, fetchTableSchema, fetchTableData } from '../hooks/useApi';

export const AdvancedTab: React.FC = () => {
  const { tables, loading: tablesLoading } = useDatabaseTables();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [schema, setSchema] = useState<any[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable);
    }
  }, [selectedTable, limit]);

  const loadTableData = async (tableName: string) => {
    setDataLoading(true);
    try {
      const [schemaData, tableData] = await Promise.all([
        fetchTableSchema(tableName),
        fetchTableData(tableName, limit)
      ]);
      setSchema(schemaData);
      setData(tableData);
    } catch (error) {
      console.error('Failed to load table data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  if (tablesLoading) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <div>Loading database tables...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Database Table Viewer</h3>
        <p style={{ color: '#666', marginBottom: '15px' }}>
          Select a table to view its schema and data
        </p>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Tables list */}
        <div style={{ width: '250px' }}>
          <h4 style={{ marginTop: 0 }}>Tables ({tables.length})</h4>
          <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            {tables.map((table) => (
              <div
                key={table}
                onClick={() => setSelectedTable(table)}
                style={{
                  padding: '10px',
                  cursor: 'pointer',
                  backgroundColor: selectedTable === table ? '#0066cc' : 'transparent',
                  color: selectedTable === table ? 'white' : 'inherit',
                  borderBottom: '1px solid #ddd'
                }}
              >
                <code style={{ color: 'inherit' }}>{table}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Table details */}
        <div style={{ flex: 1 }}>
          {selectedTable ? (
            <>
              <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>
                  Table: <code>{selectedTable}</code>
                </h4>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label>
                    Limit:{' '}
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      style={{ padding: '5px', marginLeft: '5px' }}
                    >
                      <option value={10}>10</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                    </select>
                  </label>
                  <button
                    className="btn btn-secondary"
                    onClick={() => loadTableData(selectedTable)}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {/* Schema */}
              <div style={{ marginBottom: '20px' }}>
                <h5>Schema</h5>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Not Null</th>
                      <th>Default</th>
                      <th>Primary Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.map((col, idx) => (
                      <tr key={idx}>
                        <td><code>{col.name}</code></td>
                        <td><code>{col.type}</code></td>
                        <td>{col.notnull ? '✓' : ''}</td>
                        <td>{col.dflt_value || '—'}</td>
                        <td>{col.pk ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Data */}
              <div>
                <h5>Data ({data.length} rows)</h5>
                {dataLoading ? (
                  <div className="loading">
                    <div className="loading-spinner" />
                    <div>Loading data...</div>
                  </div>
                ) : data.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📭</div>
                    <div>No data in this table</div>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          {Object.keys(data[0]).map((key) => (
                            <th key={key}><code>{key}</code></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((row, idx) => (
                          <tr key={idx}>
                            {Object.values(row).map((value: any, cellIdx) => (
                              <td key={cellIdx}>
                                {value === null ? (
                                  <span style={{ color: '#999' }}>NULL</span>
                                ) : typeof value === 'string' && value.length > 100 ? (
                                  <span title={value}>
                                    {value.substring(0, 100)}...
                                  </span>
                                ) : (
                                  String(value)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">👈</div>
              <div>Select a table from the list to view its schema and data</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
