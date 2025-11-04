import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ApiStatus, Era, Warning, Block, BlockchainEvent, Session } from '@staking-cc/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function useWebSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(API_BASE_URL);

    newSocket.on('connect', () => {
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  return { socket, isConnected };
}

export function useStatus() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket, isConnected } = useWebSocket();

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.emit('subscribe:status');

    socket.on('status', (data: ApiStatus) => {
      setStatus(data);
      setLoading(false);
    });

    socket.on('status_update', (event: any) => {
      setStatus(event.data);
    });

    return () => {
      socket.emit('unsubscribe:status');
      socket.off('status');
      socket.off('status_update');
    };
  }, [socket]);

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`);
      if (!response.ok) throw new Error('Failed to fetch status');
      const data = await response.json();
      setStatus(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { status, loading, error, isConnected };
}

export function useEras(limit: number = 20) {
  const [eras, setEras] = useState<Era[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useWebSocket();

  useEffect(() => {
    fetchEras();
  }, [limit]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('subscribe:eras');

    socket.on('eras_update', (event: any) => {
      setEras(event.data);
    });

    return () => {
      socket.emit('unsubscribe:eras');
      socket.off('eras_update');
    };
  }, [socket]);

  const fetchEras = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/eras?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch eras');
      const data = await response.json();
      setEras(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { eras, loading, error, refetch: fetchEras };
}

export function useWarnings(limit: number = 50) {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useWebSocket();

  useEffect(() => {
    fetchWarnings();
  }, [limit]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('subscribe:warnings');

    socket.on('warnings_update', (event: any) => {
      setWarnings(event.data);
    });

    return () => {
      socket.emit('unsubscribe:warnings');
      socket.off('warnings_update');
    };
  }, [socket]);

  const fetchWarnings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/warnings?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch warnings');
      const data = await response.json();
      setWarnings(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { warnings, loading, error, refetch: fetchWarnings };
}

export function useBlocks(chain: 'rc' | 'ah', limit: number = 100) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBlocks();
  }, [chain, limit]);

  const fetchBlocks = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/blocks/${chain}?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch blocks');
      const data = await response.json();
      setBlocks(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { blocks, loading, error, refetch: fetchBlocks };
}

export function useEvents(chain: 'rc' | 'ah', limit: number = 1000) {
  const [events, setEvents] = useState<BlockchainEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents();
  }, [chain, limit]);

  const fetchEvents = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/events/${chain}?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch events');
      const data = await response.json();
      setEvents(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { events, loading, error, refetch: fetchEvents };
}

export function useSessions(limit: number = 100) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useWebSocket();

  useEffect(() => {
    fetchSessions();
  }, [limit]);

  useEffect(() => {
    if (!socket) return;

    socket.emit('subscribe:sessions');

    socket.on('sessions_update', (event: any) => {
      setSessions(event.data);
    });

    return () => {
      socket.emit('unsubscribe:sessions');
      socket.off('sessions_update');
    };
  }, [socket]);

  const fetchSessions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      setSessions(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { sessions, loading, error, refetch: fetchSessions };
}

export function useDatabaseTables() {
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/database/tables`);
      if (!response.ok) throw new Error('Failed to fetch tables');
      const data = await response.json();
      setTables(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  return { tables, loading, error, refetch: fetchTables };
}

export async function fetchTableSchema(tableName: string): Promise<any[]> {
  const response = await fetch(`${API_BASE_URL}/api/database/${tableName}/schema`);
  if (!response.ok) throw new Error('Failed to fetch table schema');
  return response.json();
}

export async function fetchTableData(tableName: string, limit: number = 100): Promise<any[]> {
  const response = await fetch(`${API_BASE_URL}/api/database/${tableName}/data?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch table data');
  return response.json();
}

export async function fetchElectionPhasesByEra(eraId: number): Promise<any[]> {
  const response = await fetch(`${API_BASE_URL}/api/eras/${eraId}/elections`);
  if (!response.ok) throw new Error('Failed to fetch election phases');
  return response.json();
}
