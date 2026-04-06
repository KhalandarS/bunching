import React, { useEffect, useState, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Bus Bunching Control System - Real OpenStreetMap Visualization
 * Real intercity route with aggressive anti-bunching algorithm.
 */

const BusBunchingApp = () => {
  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================

  const [buses, setBuses] = useState([]);
  const [stops, setStops] = useState([]);
  const [gaps, setGaps] = useState({});
  const [eventLog, setEventLog] = useState([]);
  const [algorithmEnabled, setAlgorithmEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const [delayedBus, setDelayedBus] = useState(null);
  const [routeStats, setRouteStats] = useState({});
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const logEndRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  // =========================================================================
  // WEBSOCKET CONNECTION & RECONNECTION LOGIC
  // =========================================================================

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) return; // Already connected

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:8000/ws`;
      
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.buses) setBuses(data.buses);
          if (data.stops) setStops(data.stops);
          if (data.gaps) setGaps(data.gaps);
          if (data.event_log) setEventLog(data.event_log);
          if (data.route_stats) setRouteStats(data.route_stats);
          if (data.algorithm_enabled !== undefined) {
            setAlgorithmEnabled(data.algorithm_enabled);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setConnected(false);
    }
  }, []);

  // =========================================================================
  // LIFECYCLE HOOKS
  // =========================================================================

  // Initialize WebSocket
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connectWebSocket]);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapRef.current) {
      // Create map centered on the route (average of stops)
      const map = L.map('map').setView([40.7450, -73.9990], 13);
      mapRef.current = map;

      // Add OpenStreetMap layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
    }

    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  // Update map markers when buses or stops change
  useEffect(() => {
    if (!mapRef.current) return;

    // Add/update stop markers
    stops.forEach((stop) => {
      const key = `stop_${stop.id}`;
      if (!markersRef.current[key]) {
        const marker = L.circleMarker([stop.latitude, stop.longitude], {
          radius: 6,
          fillColor: 'white',
          color: '#333',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        })
          .addTo(mapRef.current)
          .bindPopup(`<b>${stop.name}</b>`);
        markersRef.current[key] = marker;
      }
    });

    // Add/update bus markers
    buses.forEach((bus) => {
      const key = `bus_${bus.id}`;
      const color = getBusColor(bus.id);

      if (!markersRef.current[key]) {
        const marker = L.circleMarker([bus.latitude, bus.longitude], {
          radius: 8,
          fillColor: color,
          color: 'white',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        })
          .addTo(mapRef.current)
          .bindPopup(
            `<b>${bus.id}</b><br/>Status: ${bus.status}<br/>Speed: ${bus.speed_multiplier.toFixed(1)}x`
          );
        markersRef.current[key] = marker;
      } else {
        // Update existing marker position
        markersRef.current[key].setLatLng([bus.latitude, bus.longitude]);
        const stopName = stops[bus.current_stop_idx]?.name || 'Unknown';
        markersRef.current[key].setPopupContent(
          `<b>${bus.id}</b><br/>Status: ${bus.status}<br/>Next: ${stopName}<br/>Speed: ${bus.speed_multiplier.toFixed(1)}x`
        );
      }
    });
  }, [buses, stops]);

  // Auto-scroll event log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLog]);

  // =========================================================================
  // CONTROL HANDLERS
  // =========================================================================

  const sendCommand = (command) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return;
    }
    wsRef.current.send(JSON.stringify(command));
  };

  const handleToggleAlgorithm = () => {
    sendCommand({ type: 'toggle_algorithm' });
  };

  const handleInjectDelay = (busId) => {
    setDelayedBus(busId);
    sendCommand({ type: 'inject_delay', bus_id: busId });
    setTimeout(() => setDelayedBus(null), 15000); // 15 second delay
  };

  const handleReset = () => {
    sendCommand({ type: 'reset' });
  };

  // =========================================================================
  // UTILITY FUNCTIONS
  // =========================================================================

  const getBusColor = (busId) => {
    switch (busId) {
      case 'bus_1':
        return '#ef4444'; // Red
      case 'bus_2':
        return '#3b82f6'; // Blue
      case 'bus_3':
        return '#10b981'; // Green
      default:
        return '#6b7280'; // Gray
    }
  };

  const getBusStatusIcon = (status) => {
    switch (status) {
      case 'boarding':
        return '⏸️ Boarding';
      case 'holding':
        return '🛑 Holding';
      default:
        return '🚌 Moving';
    }
  };

  const getGapStatus = (gap) => {
    const threshold = routeStats.bunching_threshold_km || 1.0;
    const recovery = threshold * 1.5;
    if (gap < threshold) return { color: 'red', text: '🚨 Critical' };
    if (gap < recovery) return { color: 'yellow', text: '⚠️ Warning' };
    return { color: 'green', text: '✅ Good' };
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            🚌 Real-Time Bus Control System
          </h1>
          <p className="text-slate-400 text-sm">OpenStreetMap intercity route • Aggressive anti-bunching algorithm</p>
          
          {/* Connection Status */}
          <div className="mt-3 flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-xs font-mono">
              {connected ? '🟢 Connected to Backend' : '🔴 Disconnected - Reconnecting...'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* LEFT: Map (3/4 width) */}
          <div className="lg:col-span-3 bg-slate-800 rounded-lg shadow-lg border border-slate-700 p-4">
            <h2 className="text-lg font-semibold mb-3 text-cyan-400">Route Map (OpenStreetMap)</h2>
            <div
              id="map"
              className="w-full rounded-lg border-2 border-slate-600"
              style={{ height: '500px' }}
            ></div>
            <div className="mt-3 text-xs text-slate-400 font-mono">
              <p>• White circles = Bus Stops</p>
              <p>• Colored circles = Buses (Red/Blue/Green)</p>
              <p>• Route distance: {routeStats.total_distance_km || '--'} km</p>
            </div>
          </div>

          {/* RIGHT: Control Panel (1/4 width) */}
          <div className="space-y-4">
            {/* Algorithm Status */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700">
              <h3 className="text-sm font-semibold mb-3 text-cyan-400">Algorithm</h3>
              <button
                onClick={handleToggleAlgorithm}
                className={`w-full py-2 px-3 rounded text-sm font-semibold transition-all ${
                  algorithmEnabled
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {algorithmEnabled ? '✓ Active' : '✕ Disabled'}
              </button>
            </div>

            {/* Gaps Status */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700">
              <h3 className="text-sm font-semibold mb-3 text-cyan-400">Spacing (km)</h3>
              <div className="space-y-2">
                {Object.entries(gaps).map(([key, value]) => {
                  const status = getGapStatus(value);
                  return (
                    <div
                      key={key}
                      className={`p-2 rounded text-xs border ${
                        status.color === 'red'
                          ? 'bg-red-900 bg-opacity-30 border-red-500 text-red-200'
                          : status.color === 'yellow'
                          ? 'bg-yellow-900 bg-opacity-30 border-yellow-500 text-yellow-200'
                          : 'bg-green-900 bg-opacity-20 border-green-600 text-green-300'
                      }`}
                    >
                      <div className="font-mono">{value.toFixed(2)} km</div>
                      <div className="text-xs mt-1">{status.text}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Buses Status */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700">
              <h3 className="text-sm font-semibold mb-3 text-cyan-400">Bus Status</h3>
              <div className="space-y-2">
                {buses.map((bus) => (
                  <div
                    key={bus.id}
                    className="p-2 rounded bg-slate-900 border border-slate-600 text-xs"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getBusColor(bus.id) }}
                      ></div>
                      <span className="font-mono font-bold">{bus.id}</span>
                    </div>
                    <div className="text-slate-400 text-xs">
                      <div>{getBusStatusIcon(bus.status)}</div>
                      {bus.status === 'moving' && (
                        <div className="text-slate-300">Speed: {(bus.speed_multiplier * 100).toFixed(0)}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Traffic Control */}
            <div className="bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700">
              <h3 className="text-sm font-semibold mb-3 text-cyan-400">Traffic Test</h3>
              <button
                onClick={() => handleInjectDelay('bus_1')}
                disabled={delayedBus !== null}
                className={`w-full py-2 px-3 rounded text-xs font-semibold transition-all ${
                  delayedBus === 'bus_1'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                } disabled:opacity-50`}
              >
                {delayedBus === 'bus_1' ? '⏳ Delaying...' : '🚦 Inject Delay'}
              </button>
              <p className="text-xs text-slate-400 mt-2">
                Tests algorithm robustness
              </p>
            </div>

            {/* Reset */}
            <button
              onClick={handleReset}
              className="w-full py-2 px-3 rounded text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"
            >
              ↻ Reset
            </button>
          </div>
        </div>

        {/* Event Log */}
        <div className="mt-4 bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700">
          <h2 className="text-sm font-semibold mb-2 text-cyan-400">Activity Log</h2>
          <div className="bg-slate-900 rounded p-3 h-40 overflow-y-auto border border-slate-700 font-mono text-xs space-y-1">
            {eventLog.length === 0 ? (
              <p className="text-slate-500">Waiting for events...</p>
            ) : (
              eventLog.map((event, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    event.includes('🚨') || event.includes('⚠️')
                      ? 'text-red-400'
                      : event.includes('✅')
                      ? 'text-green-400'
                      : event.includes('🚦')
                      ? 'text-yellow-400'
                      : event.includes('🛑')
                      ? 'text-orange-400'
                      : 'text-slate-400'
                  }`}
                >
                  {event}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusBunchingApp;
