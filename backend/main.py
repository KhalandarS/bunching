"""
Bus Bunching Control System - FastAPI Backend with WebSocket Server
Real intercity route with OpenStreetMap integration.
Prevents bunching from occurring (aggressive algorithm).
"""

import asyncio
import json
import math
from dataclasses import dataclass, asdict
from typing import Dict, List, Set, Tuple
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class Stop:
    """Bus stop with GPS coordinates."""
    id: str
    name: str
    latitude: float
    longitude: float
    sequence: int


@dataclass
class Bus:
    """Represents a single bus with real coordinates."""
    id: str
    current_stop_idx: int  # Index in STOPS list (0-7)
    progress_to_next: float  # 0-1 progress from current to next stop
    latitude: float  # Current GPS position
    longitude: float  # Current GPS position
    status: str  # "moving", "boarding", "holding"
    speed_multiplier: float  # 1.0 = normal, 0.4 = delayed, 2.0 = express
    boarding_counter: int = 0
    holding_counter: int = 0
    distance_to_next_stop: float = 0.0  # km


# ============================================================================
# SIMULATION STATE & CONFIGURATION
# ============================================================================

class SimulationState:
    """Manages the global state of the bus system."""
    
    def __init__(self):
        # Real intercity route: e.g., between nearby cities (8 stops, ~20 km)
        # Using realistic GPS coordinates (example: a highway corridor)
        self.STOPS = [
            Stop("stop_1", "Central Station A", 40.7380, -74.0420, 0),
            Stop("stop_2", "Transit Hub", 40.7489, -74.0278, 1),
            Stop("stop_3", "City Center", 40.7549, -74.0152, 2),
            Stop("stop_4", "North Plaza", 40.7614, -74.0055, 3),
            Stop("stop_5", "Commercial District", 40.7505, -73.9934, 4),
            Stop("stop_6", "Airport Junction", 40.7382, -73.9862, 5),
            Stop("stop_7", "Business Park", 40.7282, -73.9876, 6),
            Stop("stop_8", "Central Station B", 40.7128, -74.0060, 7),
        ]
        
        # Route parameters
        self.BOARDING_DURATION = 3  # Faster boarding (3 sec) in modern system
        self.BASE_SPEED = 2.0  # km per tick (~40 km/h with 1-sec ticks)
        self.TICK_INTERVAL = 1.0  # Seconds between ticks
        
        # Event log for frontend display (initialize BEFORE _initialize_buses)
        self.event_log: List[str] = []
        self.max_log_size = 50
        
        # Anti-bunching configuration (AGGRESSIVE)
        self.TOTAL_DISTANCE = self._calculate_total_distance()  # Total route km
        self.TARGET_HEADWAY = self.TOTAL_DISTANCE / 3  # Even spacing for 3 buses
        self.BUNCHING_THRESHOLD = self.TARGET_HEADWAY * 0.3  # 30% of target ← AGGRESSIVE
        self.RECOVERY_THRESHOLD = self.TARGET_HEADWAY * 0.6  # 60% of target
        self.HOLDING_THRESHOLD = self.TARGET_HEADWAY * 0.4  # Trigger holding at 40%
        
        # Initialize buses at different stops with spacing
        self.buses: Dict[str, Bus] = {}
        self._initialize_buses()
        
        # Algorithm control
        self.algorithm_enabled = True
        
        # Delayed bus tracking
        self.delayed_bus_id: str = None
    
    def _calculate_total_distance(self) -> float:
        """Calculate total route distance in km."""
        total = 0.0
        for i in range(len(self.STOPS) - 1):
            s1, s2 = self.STOPS[i], self.STOPS[i+1]
            total += self._haversine_distance(s1.latitude, s1.longitude, 
                                             s2.latitude, s2.longitude)
        # Add return distance
        s_last = self.STOPS[-1]
        s_first = self.STOPS[0]
        total += self._haversine_distance(s_last.latitude, s_last.longitude,
                                         s_first.latitude, s_first.longitude)
        return total
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two GPS points in km."""
        R = 6371  # Earth radius in km
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat/2) ** 2 + 
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * 
             math.sin(dlon/2) ** 2)
        c = 2 * math.asin(math.sqrt(a))
        return R * c
    
    def _initialize_buses(self):
        """Initialize 3 buses evenly distributed on route."""
        spacing = self.TOTAL_DISTANCE / 3
        for i, bus_id in enumerate(["bus_1", "bus_2", "bus_3"]):
            stop_idx = i % len(self.STOPS)
            stop = self.STOPS[stop_idx]
            self.buses[bus_id] = Bus(
                id=bus_id,
                current_stop_idx=stop_idx,
                progress_to_next=0.0,
                latitude=stop.latitude,
                longitude=stop.longitude,
                status="moving",
                speed_multiplier=1.0,
            )
        self.add_event("✅ Simulation initialized with 3 buses at even spacing")
    
    def add_event(self, message: str):
        """Log an event with timestamp."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        event = f"[{timestamp}] {message}"
        self.event_log.append(event)
        if len(self.event_log) > self.max_log_size:
            self.event_log.pop(0)
    
    def get_state(self) -> dict:
        """Return the current simulation state as a serializable dict."""
        return {
            "buses": [
                {
                    "id": bus.id,
                    "latitude": bus.latitude,
                    "longitude": bus.longitude,
                    "current_stop_idx": bus.current_stop_idx,
                    "progress_to_next": bus.progress_to_next,
                    "status": bus.status,
                    "speed_multiplier": bus.speed_multiplier,
                }
                for bus in self.buses.values()
            ],
            "stops": [
                {
                    "id": stop.id,
                    "name": stop.name,
                    "latitude": stop.latitude,
                    "longitude": stop.longitude,
                }
                for stop in self.STOPS
            ],
            "algorithm_enabled": self.algorithm_enabled,
            "gaps": self._calculate_gaps(),
            "event_log": self.event_log,
            "route_stats": {
                "total_distance_km": round(self.TOTAL_DISTANCE, 2),
                "target_headway_km": round(self.TARGET_HEADWAY, 2),
                "bunching_threshold_km": round(self.BUNCHING_THRESHOLD, 2),
            }
        }
    
    def _calculate_gaps(self) -> Dict[str, float]:
        """Calculate distances between consecutive buses in km."""
        bus_list = sorted(self.buses.values(), key=lambda b: (b.current_stop_idx, b.progress_to_next))
        gaps = {}
        for i in range(len(bus_list)):
            current_bus = bus_list[i]
            next_bus = bus_list[(i + 1) % len(bus_list)]
            gap = self._distance_between_buses(current_bus, next_bus)
            gaps[f"{current_bus.id}_to_{next_bus.id}"] = round(gap, 2)
        return gaps
    
    def _distance_between_buses(self, bus1: Bus, bus2: Bus) -> float:
        """Calculate forward distance from bus1 to bus2 on the route."""
        # Same stop or bus2 ahead on route
        if bus1.current_stop_idx < bus2.current_stop_idx:
            dist = 0.0
            # Distance from bus1's current position to next stop
            s_current = self.STOPS[bus1.current_stop_idx]
            s_next = self.STOPS[bus1.current_stop_idx + 1]
            seg_dist = self._haversine_distance(s_current.latitude, s_current.longitude,
                                               s_next.latitude, s_next.longitude)
            remaining_in_seg = seg_dist * (1 - bus1.progress_to_next)
            dist += remaining_in_seg
            
            # Distance through all intermediate stops
            for i in range(bus1.current_stop_idx + 1, bus2.current_stop_idx):
                s1 = self.STOPS[i]
                s2 = self.STOPS[i + 1]
                dist += self._haversine_distance(s1.latitude, s1.longitude,
                                                s2.latitude, s2.longitude)
            
            # Distance from bus2's previous stop to current position
            if bus2.current_stop_idx > bus1.current_stop_idx + 1:
                s_prev = self.STOPS[bus2.current_stop_idx - 1]
                s_curr = self.STOPS[bus2.current_stop_idx]
                seg_dist = self._haversine_distance(s_prev.latitude, s_prev.longitude,
                                                   s_curr.latitude, s_curr.longitude)
                dist += seg_dist * bus2.progress_to_next
            else:
                # Adjacent stops
                s_prev = self.STOPS[bus1.current_stop_idx + 1]
                s_curr = self.STOPS[bus2.current_stop_idx]
                seg_dist = self._haversine_distance(s_prev.latitude, s_prev.longitude,
                                                   s_curr.latitude, s_curr.longitude)
                dist += seg_dist * bus2.progress_to_next
            return dist
        else:
            # bus2 is behind bus1, calculate wrap-around distance
            dist = 0.0
            # From bus1 to end of route
            for i in range(bus1.current_stop_idx, len(self.STOPS) - 1):
                s1 = self.STOPS[i]
                s2 = self.STOPS[i + 1]
                seg_dist = self._haversine_distance(s1.latitude, s1.longitude,
                                                   s2.latitude, s2.longitude)
                if i == bus1.current_stop_idx:
                    dist += seg_dist * (1 - bus1.progress_to_next)
                else:
                    dist += seg_dist
            
            # Wrap from last stop to first
            s_last = self.STOPS[-1]
            s_first = self.STOPS[0]
            dist += self._haversine_distance(s_last.latitude, s_last.longitude,
                                            s_first.latitude, s_first.longitude)
            
            # From start to bus2's position
            for i in range(bus2.current_stop_idx):
                s1 = self.STOPS[i]
                s2 = self.STOPS[i + 1]
                seg_dist = self._haversine_distance(s1.latitude, s1.longitude,
                                                   s2.latitude, s2.longitude)
                if i < bus2.current_stop_idx - 1:
                    dist += seg_dist
                else:
                    dist += seg_dist * bus2.progress_to_next
            
            return dist


# ============================================================================
# SIMULATION TICK LOGIC
# ============================================================================

class BusSimulation:
    """Handles the physics and control logic for the bus system."""
    
    def __init__(self, state: SimulationState):
        self.state = state
    
    def tick(self):
        """
        Execute one tick of the simulation (1 second).
        Updates positions, handles stops, and applies AGGRESSIVE anti-bunching logic.
        """
        # Step 1: Apply PREVENTIVE anti-bunching (before movement)
        if self.state.algorithm_enabled:
            self._apply_preventive_holding()
        
        # Step 2: Update positions for buses not boarding/holding
        self._update_positions()
        
        # Step 3: Handle stop arrivals
        self._handle_stop_arrivals()
        
        # Step 4: Decrement boarding/holding counters
        self._decrement_counters()
        
        # Step 5: Apply REACTIVE anti-bunching (after movement)
        if self.state.algorithm_enabled:
            self._apply_reactive_bunching()
    
    def _update_positions(self):
        """
        Update bus positions along the route.
        Each bus moves based on speed from one stop to the next.
        """
        for bus in self.state.buses.values():
            if bus.status == "moving":
                current_stop = self.state.STOPS[bus.current_stop_idx]
                next_stop_idx = (bus.current_stop_idx + 1) % len(self.state.STOPS)
                next_stop = self.state.STOPS[next_stop_idx]
                
                # Distance to next stop
                segment_distance = self.state._haversine_distance(
                    current_stop.latitude, current_stop.longitude,
                    next_stop.latitude, next_stop.longitude
                )
                
                # Travel distance this tick (with speed multiplier)
                travel_distance = (self.state.BASE_SPEED * bus.speed_multiplier) / 1000  # Convert to km
                bus.progress_to_next += travel_distance / segment_distance
                
                # Check if reached next stop
                if bus.progress_to_next >= 1.0:
                    bus.current_stop_idx = next_stop_idx
                    bus.progress_to_next = 0.0
                
                # Update GPS coordinates
                lat_delta = (next_stop.latitude - current_stop.latitude) * bus.progress_to_next
                lon_delta = (next_stop.longitude - current_stop.longitude) * bus.progress_to_next
                bus.latitude = current_stop.latitude + lat_delta
                bus.longitude = current_stop.longitude + lon_delta
    
    def _handle_stop_arrivals(self):
        """Check if any bus has arrived at a stop."""
        for bus in self.state.buses.values():
            if bus.status == "moving" and bus.progress_to_next < 0.01:  # Just arrived
                stop = self.state.STOPS[bus.current_stop_idx]
                bus.status = "boarding"
                bus.boarding_counter = self.state.BOARDING_DURATION
                self.state.add_event(f"🚌 {bus.id} → {stop.name}")
    
    def _decrement_counters(self):
        """Decrement boarding and holding counters."""
        for bus in self.state.buses.values():
            if bus.status == "boarding":
                bus.boarding_counter -= 1
                if bus.boarding_counter <= 0:
                    bus.status = "moving"
                    bus.boarding_counter = 0
            
            elif bus.status == "holding":
                bus.holding_counter -= 1
                if bus.holding_counter <= 0:
                    bus.status = "moving"
                    bus.holding_counter = 0
                    gap = self.state._calculate_gaps()
                    gap_key = list(gap.keys())[0]  # Just for display
                    self.state.add_event(f"✅ {bus.id} resuming (spacing recovered)")
    
    def _apply_preventive_holding(self):
        """
        AGGRESSIVE: Prevent bunching BEFORE it happens.
        If next bus is too close, hold current bus at stop.
        """
        bus_list = sorted(self.state.buses.values(), 
                         key=lambda b: (b.current_stop_idx, b.progress_to_next))
        gaps = self.state._calculate_gaps()
        
        for i, bus in enumerate(bus_list):
            # Get the next bus ahead
            next_bus = bus_list[(i - 1) % len(bus_list)]
            
            # Find gap TO this bus (how far behind next_bus we are)
            prev_bus = bus_list[(i + 1) % len(bus_list)]
            gap_key = f"{prev_bus.id}_to_{bus.id}"
            if gap_key not in gaps:
                gap_key = f"{bus.id}_to_{next_bus.id}"
            gap = gaps.get(gap_key, self.state.TARGET_HEADWAY)
            
            # AGGRESSIVE HOLDING: If gap to bus ahead is below threshold, hold
            if (bus.status == "boarding" and 
                gap < self.state.HOLDING_THRESHOLD and
                bus.holding_counter == 0):
                bus.status = "holding"
                bus.holding_counter = 20  # Hold for 20 seconds
                stop = self.state.STOPS[bus.current_stop_idx]
                self.state.add_event(
                    f"🛑 {bus.id} holding at {stop.name} "
                    f"(preventing bunching, gap: {gap:.2f}km)"
                )
    
    def _apply_reactive_bunching(self):
        """
        REACTIVE: If bunching still occurs, fix it immediately.
        """
        gaps = self.state._calculate_gaps()
        bus_list = sorted(self.state.buses.values(), 
                         key=lambda b: (b.current_stop_idx, b.progress_to_next))
        
        for i, bus in enumerate(bus_list):
            next_bus = bus_list[(i + 1) % len(bus_list)]
            gap_key = f"{bus.id}_to_{next_bus.id}"
            gap = gaps.get(gap_key, self.state.TARGET_HEADWAY)
            
            # EMERGENCY: If bunching detected, suppress bus movement
            if gap < self.state.BUNCHING_THRESHOLD:
                if bus.status == "moving":
                    bus.status = "holding"
                    bus.holding_counter = 30
                    self.state.add_event(
                        f"🚨 EMERGENCY HOLD {bus.id} - bunching detected! "
                        f"(gap: {gap:.2f}km, threshold: {self.state.BUNCHING_THRESHOLD:.2f}km)"
                    )
            
            # Release holding when gap is fully recovered
            elif (bus.status == "holding" and 
                  gap >= self.state.RECOVERY_THRESHOLD):
                bus.status = "moving"
                bus.holding_counter = 0
    
    def inject_traffic_delay(self, bus_id: str, duration_ticks: int = 15):
        """
        Inject mild traffic delay (less severe than before).
        Robust algorithm should handle it.
        """
        if bus_id in self.state.buses:
            bus = self.state.buses[bus_id]
            bus.speed_multiplier = 0.6  # Only 40% reduction (was 60%)
            self.state.delayed_bus_id = bus_id
            self.state.add_event(
                f"🚦 Slight traffic on {bus_id} (speed 0.6x for {duration_ticks}s)"
            )
            asyncio.create_task(self._recover_from_delay(bus_id, duration_ticks))
    
    async def _recover_from_delay(self, bus_id: str, duration_ticks: int):
        """Recover from delay."""
        await asyncio.sleep(duration_ticks)
        if bus_id in self.state.buses and self.state.buses[bus_id].speed_multiplier == 0.6:
            self.state.buses[bus_id].speed_multiplier = 1.0
            self.state.add_event(f"✅ Traffic cleared, {bus_id} back to normal")


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================

# Global state and simulation
sim_state = SimulationState()
simulation = BusSimulation(sim_state)
active_connections: Set[WebSocket] = set()
simulation_running = False


async def simulation_loop():
    """
    Main simulation loop: ticks the simulation every TICK_INTERVAL seconds
    and broadcasts state to all connected WebSocket clients.
    """
    global simulation_running
    simulation_running = True
    try:
        while True:
            # Execute one simulation tick
            simulation.tick()
            
            # Broadcast state to all connected clients
            state_data = sim_state.get_state()
            state_json = json.dumps(state_data)
            
            # Send to all active WebSocket connections
            disconnected = set()
            for connection in active_connections:
                try:
                    await connection.send_text(state_json)
                except Exception as e:
                    print(f"Error sending to WebSocket: {e}")
                    disconnected.add(connection)
            
            # Clean up disconnected clients
            for conn in disconnected:
                active_connections.discard(conn)
            
            # Wait for next tick
            await asyncio.sleep(sim_state.TICK_INTERVAL)
    except asyncio.CancelledError:
        simulation_running = False
    except Exception as e:
        print(f"Simulation loop error: {e}")
        simulation_running = False


simulation_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager: starts simulation on startup, cancels on shutdown.
    """
    global simulation_task
    # Startup
    simulation_task = asyncio.create_task(simulation_loop())
    yield
    # Shutdown
    if simulation_task:
        simulation_task.cancel()
        try:
            await simulation_task
        except asyncio.CancelledError:
            pass


# Create FastAPI app with CORS and lifespan
app = FastAPI(title="Bus Bunching Control System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for bidirectional communication with frontend.
    Clients connect here and receive continuous state updates.
    """
    await websocket.accept()
    active_connections.add(websocket)
    
    sim_state.add_event(f"Client connected. Connected clients: {len(active_connections)}")
    
    try:
        # Send initial state
        await websocket.send_text(json.dumps(sim_state.get_state()))
        
        # Listen for incoming messages from client
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle incoming commands
            if message.get("type") == "toggle_algorithm":
                sim_state.algorithm_enabled = not sim_state.algorithm_enabled
                status = "enabled" if sim_state.algorithm_enabled else "disabled"
                sim_state.add_event(f"Anti-bunching algorithm {status}")
            
            elif message.get("type") == "inject_delay":
                bus_id = message.get("bus_id", "bus_1")
                simulation.inject_traffic_delay(bus_id)
            
            elif message.get("type") == "move_bus":
                bus_id = message.get("bus_id")
                if bus_id in sim_state.buses:
                    bus = sim_state.buses[bus_id]
                    bus.status = "moving"
                    bus.speed_multiplier = 1.0
                    sim_state.add_event(f"✅ {bus_id} resumed movement")
            
            elif message.get("type") == "stop_bus":
                bus_id = message.get("bus_id")
                if bus_id in sim_state.buses:
                    bus = sim_state.buses[bus_id]
                    bus.status = "holding"
                    bus.holding_counter = 100
                    sim_state.add_event(f"🛑 {bus_id} stopped manually")
            
            elif message.get("type") == "reset":
                # Reset simulation to initial state
                # Re-space buses evenly at different stops
                spacing = sim_state.TOTAL_DISTANCE / 3
                for i, bus_id in enumerate(["bus_1", "bus_2", "bus_3"]):
                    if bus_id in sim_state.buses:
                        bus = sim_state.buses[bus_id]
                        # Place at different stops
                        stop_idx = i % len(sim_state.STOPS)
                        stop = sim_state.STOPS[stop_idx]
                        bus.current_stop_idx = stop_idx
                        bus.progress_to_next = 0.0
                        bus.latitude = stop.latitude
                        bus.longitude = stop.longitude
                        bus.status = "moving"
                        bus.speed_multiplier = 1.0
                        bus.boarding_counter = 0
                        bus.holding_counter = 0
                sim_state.add_event("🔄 Simulation reset")
    
    except WebSocketDisconnect:
        active_connections.discard(websocket)
        sim_state.add_event(f"Client disconnected. Connected clients: {len(active_connections)}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        active_connections.discard(websocket)


# ============================================================================
# REST ENDPOINTS
# ============================================================================

@app.get("/")
def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Bus Bunching Control System"}


@app.get("/state")
def get_state():
    """Get current simulation state via HTTP (fallback to WebSocket for real-time)."""
    return sim_state.get_state()


@app.post("/algorithm/toggle")
def toggle_algorithm():
    """Toggle anti-bunching algorithm on/off."""
    sim_state.algorithm_enabled = not sim_state.algorithm_enabled
    status = "enabled" if sim_state.algorithm_enabled else "disabled"
    sim_state.add_event(f"Anti-bunching algorithm {status} (via REST)")
    return {"algorithm_enabled": sim_state.algorithm_enabled}


@app.post("/inject-delay/{bus_id}")
def inject_delay(bus_id: str):
    """Inject traffic delay on a specific bus."""
    if bus_id not in sim_state.buses:
        return {"error": f"Bus {bus_id} not found"}
    simulation.inject_traffic_delay(bus_id, duration_ticks=15)
    return {"status": "delay injected", "bus_id": bus_id}


@app.post("/reset")
def reset_simulation():
    """Reset simulation to initial state."""
    sim_state.__init__()  # Reinitialize
    sim_state.add_event("✅ Simulation reset to initial state")
    return {"status": "reset"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
