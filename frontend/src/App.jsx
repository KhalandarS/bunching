import React, { useEffect, useState, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Bus Bunching Control System - React Frontend (v2.0)
 * OpenStreetMap visualization of bus positions and anti-bunching control
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
  const [mapInitialized, setMapInitialized] = useState(false);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const logEndRef = useRef(null);
  const mapRef = useRef(null);
  const busMarkersRef = useRef({});
  const stopMarkersRef = useRef({});

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
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      setConnected(false);
    }
  }, []);

  // =========================================================================
  // MAP INITIALIZATION
  // =========================================================================

  useEffect(() => {
    console.log('MAP INIT CHECK:', { mapInitialized, stopsLength: stops.length, L: typeof L });
    
    if (!mapInitialized && stops.length > 0) {
      try {
        const mapContainer = document.getElementById('map');
        console.log('Map container:', mapContainer);
        
        // Create map
        if (mapRef.current === null) {
          console.log('Creating new Leaflet map...');
          const map = L.map('map', {
            center: [40.7450, -73.9990],
            zoom: 13,
            zoomControl: true,
            scrollWheelZoom: true
          });

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
          }).addTo(map);

          mapRef.current = map;
          console.log('Leaflet map created:', map);
        }

        const map = mapRef.current;

        // Add stop markers
        stops.forEach((stop) => {
          if (!stopMarkersRef.current[stop.id]) {
            console.log('Adding stop marker:', stop.id, stop.latitude, stop.longitude);
            const marker = L.circleMarker(
              [stop.latitude, stop.longitude],
              {
                radius: 8,
                fillColor: 'white',
                color: '#64748b',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
              }
            ).addTo(map);

            marker.bindPopup(`<strong>${stop.name}</strong><br>Stop: ${stop.id}`);
            stopMarkersRef.current[stop.id] = marker;
          }
        });

        // Fit bounds to show all stops
        if (stops.length > 0) {
          const bounds = L.latLngBounds(stops.map(s => [s.latitude, s.longitude]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }

        setMapInitialized(true);
        console.log('Map initialized successfully');
      } catch (err) {
        console.error('Error initializing map:', err);
      }
    }
  }, [stops, mapInitialized]);

  // =========================================================================
  // UPDATE BUS MARKERS
  // =========================================================================

  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    buses.forEach((bus) => {
      if (!busMarkersRef.current[bus.id]) {
        const color = getBusColor(bus.id);
        const marker = L.circleMarker(
          [bus.latitude, bus.longitude],
          {
            radius: 10,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
          }
        ).addTo(map);

        marker.bindPopup(`<strong>${bus.id}</strong><br>Status: ${bus.status}`);
        busMarkersRef.current[bus.id] = marker;
      } else {
        // Update existing marker position
        busMarkersRef.current[bus.id].setLatLng([bus.latitude, bus.longitude]);
        busMarkersRef.current[bus.id].setPopupContent(
          `<strong>${bus.id}</strong><br>Status: ${bus.status}`
        );
      }
    });
  }, [buses]);

  // =========================================================================
  // LIFECYCLE HOOKS
  // =========================================================================

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
    setTimeout(() => setDelayedBus(null), 30000);
  };

  const handleMoveBus = (busId) => {
    sendCommand({ type: 'move_bus', bus_id: busId });
  };

  const handleStopBus = (busId) => {
    sendCommand({ type: 'stop_bus', bus_id: busId });
  };

  const handleReset = () => {
    sendCommand({ type: 'reset' });
  };

  // =========================================================================
  // HELPERS
  // =========================================================================

  const getBusColor = (busId) => {
    switch (busId) {
      case 'bus_1': return '#ef4444';
      case 'bus_2': return '#3b82f6';
      case 'bus_3': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getGapStatus = (gapKm) => {
    // Based on new algorithm thresholds
    if (gapKm < 2.0) return { color: 'bg-red-900', border: 'border-red-500', text: 'text-red-200', status: '🔴 Critical' };
    if (gapKm < 2.7) return { color: 'bg-yellow-900', border: 'border-yellow-500', text: 'text-yellow-200', status: '🟡 Warning' };
    return { color: 'bg-green-900', border: 'border-green-600', text: 'text-green-300', status: '🟢 Good' };
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="h-screen flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 border-b border-slate-700 p-4 shadow-lg">
          <div className="max-w-full mx-auto">
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              🚌 Bus Bunching Control System v2.0
            </h1>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className="text-sm font-mono text-slate-400">
                  {connected ? '🟢 Connected' : '🔴 Disconnected'}
                </span>
              </div>
              <span className="text-sm text-slate-400">OpenStreetMap • {stops.length} stops • {buses.length} buses</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Map Panel (75%) */}
          <div className="flex-1 relative bg-slate-800 border-r border-slate-700 overflow-hidden">
            <div 
              id="map" 
              style={{ 
                width: '100%', 
                height: '100%',
                background: '#64748b'
              }} 
              className="z-10"
            ></div>
            {!mapInitialized && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900 bg-opacity-50 z-20">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-slate-300">Loading map... ({stops.length} stops received)</p>
                </div>
              </div>
            )}
          </div>

          {/* Control Panel (25%) */}
          <div className="w-80 bg-slate-800 border-l border-slate-700 overflow-y-auto flex flex-col">
            {/* Algorithm Control */}
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-cyan-400 mb-3">Algorithm Control</h3>
              <button
                onClick={handleToggleAlgorithm}
                className={`w-full py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
                  algorithmEnabled
                    ? 'bg-green-600 hover:bg-green-700 text-white border border-green-500'
                    : 'bg-red-600 hover:bg-red-700 text-white border border-red-500'
                }`}
              >
                {algorithmEnabled ? '✓ Active' : '✕ Disabled'}
              </button>
            </div>

            {/* Spacing Metrics */}
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-cyan-400 mb-3">Spacing (km)</h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {Object.entries(gaps).map(([key, value]) => {
                  const status = getGapStatus(value);
                  return (
                    <div key={key} className={`p-2 rounded text-xs ${status.color} ${status.border} border ${status.text}`}>
                      <div className="flex justify-between">
                        <span className="font-mono">{key}</span>
                        <span className="font-bold">{value.toFixed(2)} km</span>
                      </div>
                      <div className="text-xs mt-1">{status.status}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bus Controls */}
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-cyan-400 mb-3">Bus Controls</h3>
              <div className="space-y-2">
                {['bus_1', 'bus_2', 'bus_3'].map((busId) => (
                  <div key={busId} className="space-y-1">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleMoveBus(busId)}
                        className="flex-1 py-2 px-2 rounded text-xs font-semibold bg-green-700 hover:bg-green-600 text-white border border-green-600 transition-all"
                      >
                        ▶ Move {busId}
                      </button>
                      <button
                        onClick={() => handleStopBus(busId)}
                        className="flex-1 py-2 px-2 rounded text-xs font-semibold bg-red-700 hover:bg-red-600 text-white border border-red-600 transition-all"
                      >
                        ⏹ Stop {busId}
                      </button>
                    </div>
                    <button
                      onClick={() => handleInjectDelay(busId)}
                      disabled={delayedBus !== null}
                      className={`w-full py-2 px-2 rounded text-xs font-semibold transition-all ${
                        delayedBus === busId
                          ? 'bg-yellow-600 text-white'
                          : delayedBus !== null
                          ? 'bg-slate-700 text-slate-500 opacity-50'
                          : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600'
                      }`}
                    >
                      {delayedBus === busId ? '🚦 Delay...' : `🚦 Traffic ${busId}`}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Reset Button */}
            <div className="p-4 border-b border-slate-700">
              <button
                onClick={handleReset}
                className="w-full py-2 px-3 rounded-lg font-semibold text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 transition-all"
              >
                ↻ Reset Simulation
              </button>
            </div>

            {/* System Info */}
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-sm font-semibold text-cyan-400 mb-2">System Info</h3>
              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <p>• Route: 20 km intercity</p>
                <p>• Stops: {stops.length}</p>
                <p>• Buses: {buses.length}</p>
                <p>• Target Gap: 6.7 km</p>
                <p>• Threshold: 2.0 km</p>
              </div>
            </div>

            {/* Activity Log */}
            <div className="flex-1 flex flex-col p-4 overflow-hidden">
              <h3 className="text-sm font-semibold text-cyan-400 mb-2">Activity Log</h3>
              <div className="flex-1 bg-slate-900 rounded-lg p-3 overflow-y-auto border border-slate-700 font-mono text-xs space-y-1">
                {eventLog.length === 0 ? (
                  <p className="text-slate-500">Waiting for events...</p>
                ) : (
                  eventLog.slice(-20).map((event, idx) => (
                    <div
                      key={idx}
                      className={`leading-tight ${
                        event.includes('🚨') || event.includes('🛑')
                          ? 'text-red-400'
                          : event.includes('✅')
                          ? 'text-green-400'
                          : event.includes('🚦')
                          ? 'text-yellow-400'
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

            {/* DEBUG INFO */}
            <div className="p-4 border-t border-slate-700 bg-slate-900 text-xs text-slate-400 max-h-32 overflow-y-auto">
              <p className="font-bold text-cyan-400 mb-1">DEBUG</p>
              <p>Connected: {connected ? '✓' : '✗'}</p>
              <p>Stops: {stops.length}</p>
              <p>Buses: {buses.length}</p>
              <p>Map Init: {mapInitialized ? '✓' : '✗'}</p>
              {buses.length > 0 && (
                <div className="mt-2 border-t border-slate-700 pt-2">
                  <p>Bus positions:</p>
                  {buses.map(b => (
                    <p key={b.id} className="text-blue-400">
                      {b.id}: ({b.latitude?.toFixed(4)}, {b.longitude?.toFixed(4)})
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusBunchingApp;
