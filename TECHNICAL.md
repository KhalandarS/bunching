# Technical Architecture & Algorithms

## System Overview

The Bus Bunching Control System MVP is a real-time transit simulation featuring:
1. **Physics Engine**: Realistic bus movement on a circular route
2. **Anti-Bunching Algorithm**: Headway-based control to prevent bus clustering
3. **Real-Time Visualization**: WebSocket-driven SVG display
4. **Interactive Control Panel**: Live algorithm toggling and traffic injection

---

## Backend Architecture (Python/FastAPI)

### Data Model

```python
@dataclass
class Bus:
    id: str                      # "bus_1", "bus_2", "bus_3"
    position: float              # 0-100 (circular route)
    status: str                  # "moving" | "boarding" | "holding"
    speed_multiplier: float      # 1.0 = normal, 0.4 = delayed
    boarding_counter: int        # Ticks remaining at stop
    holding_counter: int         # Ticks remaining in hold state
```

### Route Configuration

```
Route Length: 100 units (circular)
┌─────────────────────────────────┐
│  Stop 0    Stop 25   Stop 50    │
│    ▼         ▼        ▼   Stop 75
│    ●─────────●────────●────────● 
│    |                          |
│    └──────── Circular ────────┘
│ (Bus moves 0→100→0 in a loop)
```

### The Simulation Tick Loop

Every 1 second, the system executes:

```python
def tick(self):
    1. Update Positions
       └─ position += (BASE_SPEED * speed_multiplier)
       └─ position %= 100  # Wrap around
    
    2. Detect Stop Arrivals
       └─ If |position - stop| < 1.0:
          ├─ status = "boarding"
          └─ boarding_counter = 5 ticks
    
    3. Decrement Counters
       ├─ boarding_counter--
       │  └─ When 0: status = "moving"
       └─ holding_counter--
          └─ When 0: status = "moving"
    
    4. Apply Anti-Bunching Logic
       └─ If algorithm_enabled:
          └─ check_bunching()
          └─ apply_holding()
```

### Physics

**Base Configuration:**
- `BASE_SPEED = 2.0` units/tick (covers route in ~50 seconds)
- `TICK_INTERVAL = 1.0` seconds
- `STOP_THRESHOLD = 1.0` unit detection radius

**Speed Formula:**
```
distance_traveled = BASE_SPEED × speed_multiplier

Examples:
- Normal: 2.0 × 1.0 = 2.0 units/tick
- Delayed: 2.0 × 0.4 = 0.8 units/tick (60% slower)
```

**Circular Wrapping:**
```python
def circular_distance(pos1, pos2):
    """Calculate forward distance on circular route"""
    distance = (pos2 - pos1) % 100
    return distance
```

Example:
```
pos1=95, pos2=5 → distance = (5-95) % 100 = -90 % 100 = 10 units (wraps correctly)
```

### Anti-Bunching Algorithm

The core algorithm tracks spacing between consecutive buses and applies holding control.

#### 1. Distance Calculation

```python
def _calculate_gaps(self):
    """For each bus, calculate distance to next bus"""
    gaps = {}
    for i, current_bus in enumerate(buses):
        next_bus = buses[(i+1) % n_buses]
        gap = circular_distance(current_bus.pos, next_bus.pos)
        gaps[f"{current_bus.id}_to_{next_bus.id}"] = gap
    return gaps
```

For 3 buses evenly distributed:
```
Ideal Target Headway = 100 / 3 = 33.3 units
Bus 1 → Bus 2: 33.3 units ✓
Bus 2 → Bus 3: 33.3 units ✓
Bus 3 → Bus 1: 33.3 units ✓
```

#### 2. Bunching Detection

```python
BUNCHING_THRESHOLD = 15 units  # Gap too small
RECOVERY_THRESHOLD = 25 units  # Safe gap for holding release
```

**Detection Logic:**
```python
def check_bunching(self):
    for each pair of consecutive buses:
        gap = circular_distance(current_bus, next_bus)
        
        if gap < BUNCHING_THRESHOLD:  # 15 units
            alert("BUNCHING DETECTED")
            return True
    return False
```

#### 3. Holding Control

**Activation:**
```
When: gap < 15 units AND current_bus is at a stop
Action: status = "holding", holding_counter = 100

Effect: Bus stops moving even though not boarding
        Allows trailing bus to catch up and increase gap
```

**Release Condition:**
```
When: status == "holding" AND gap >= 25 units
Action: status = "moving", holding_counter = 0

Effect: Once gap recovers, bus resumes normal operation
```

**State Transitions:**
```
                   ┌──────────────┐
                   │   MOVING     │
                   │ (normal op)  │
                   └──────────────┘
                    ↓           ↑
            (hit stop)    (boarding_counter==0)
                    ↓           ↑
                   ┌──────────────┐
                   │   BOARDING   ││ (pause 5 ticks)
                   └──────────────┘
                                ↓
              (gap < 15 units && algorithm_enabled)
                                ↓
                   ┌──────────────┐
                   │   HOLDING    │
                   │  (wait for   │
                   │   spacing)   │
                   └──────────────┘
                                ↓
                    (gap >= 25 units)
                                ↓
                   Back to MOVING
```

#### 4. Recovery Loop

```
Time Step | Bus1 Pos | Bus2 Pos | Gap  | Bus1 Status | Action
0         | 20.0     | 10.0     | 90.0 | moving      | normal
1         | 22.0     | 12.0     | 90.0 | moving      | normal
...
45        | 50.0     | 40.0     | 90.0 | moving      | normal
46        | 52.0     | 42.0     | 90.0 | boarding    | arrived at Stop 50
47        | 52.0     | 44.0     | 8.0  | boarding    | GAP BUNCHED!
...       |          |          |      |             |
48        | 52.0     | 46.0     | 6.0  | -> holding  | HOLD initiated
49        | 52.0     | 48.0     | 4.0  | holding     | still holding
50        | 52.0     | 50.0     | 2.0  | holding     | gap shrinking (OK, bus2 slowing)
51        | 52.0     | 50.8     | 1.2  | holding     | bus2 slowing at stop
52        | 52.0     | 50.8     | 1.2  | holding     | bus2 boarding
...
57        | 52.0     | 50.8     | 1.2  | holding     | bus2 still boarding
58        | 52.0     | 52.0     | -0.0 | holding     | bus2 resumed, gap=0 (they're together!)
...wait longer...
70        | 52.0     | 58.0     | -6.0 | holding     | bus2 already ahead? No, wrap: (58-52)%100=6
            ACTUALLY: circular_distance(52, 58) = (58-52)%100 = 6
75        | 52.0     | 67.0     | 15.0 | holding     | gap exactly at threshold
76        | 52.0     | 69.0     | 17.0 | holding     | still not recovered
85        | 52.0     | 87.0     | 35.0 | -> moving   | GAP RECOVERED! (>= 25)
```

---

## Frontend Architecture (React/Vite)

### Component Structure

```
BusBunchingApp (Main Component)
├── State Management (useState)
│   ├── buses[]
│   ├── gaps{}
│   ├── eventLog[]
│   ├── algorithmEnabled
│   ├── connected
│   └── delayedBus
├── WebSocket Connection (useEffect)
│   ├── connectWebSocket()
│   ├── handleMessage()
│   └── reconnection logic (3s delay)
├── Control Handlers
│   ├── handleToggleAlgorithm()
│   ├── handleInjectDelay()
│   └── handleReset()
├── Visualization (SVG)
│   ├── positionToCoordinates() [0-100 → cx,cy]
│   ├── Route circle
│   ├── Stop markers (4x)
│   └── Bus markers (3x colored)
└── UI Panels
    ├── Gap status display
    ├── Control buttons
    └── Activity log
```

### Coordinate Mapping (SVG)

**Convert linear route position to circular SVG coordinates:**

```javascript
const positionToCoordinates = (position) => {
    // Input: position (0-100 on route)
    // Output: (cx, cy) on SVG canvas
    
    // Step 1: Convert position to angle
    const angle = (position / 100) * 360;  // 0-100 → 0-360°
    
    // Step 2: Convert to radians, offset by -90° (start at top)
    const radian = ((angle - 90) * Math.PI) / 180;
    
    // Step 3: Calculate SVG coordinates
    const cx = CENTER_X + RADIUS * Math.cos(radian);
    const cy = CENTER_Y + RADIUS * Math.sin(radian);
    
    return { cx, cy };
};
```

**Visual Mapping:**
```
Position  Angle  Direction    Coordinates
0         0°     Top (12 o')  (250, 100)
25        90°    Right        (400, 250)
50        180°   Bottom       (250, 400)
75        270°   Left         (100, 250)
```

### WebSocket Protocol

**Message Flow:**

```
1. Client connects → Server accepts
2. Server broadcasts state every 1 Hz:
   {
     "buses": [{id, position, status, speed_multiplier}, ...],
     "gaps": {"bus_1_to_bus_2": 24.5, ...},
     "event_log": ["[HH:MM:SS] Event text", ...],
     "algorithm_enabled": true/false
   }
3. Client sends command:
   {
     "type": "toggle_algorithm" | "inject_delay" | "reset",
     "bus_id": "bus_1" (for inject_delay)
   }
4. Server processes and includes in next broadcast
```

### Styling (Tailwind CSS)

**Color Scheme:**
```
Background:  slate-900 → slate-800 gradient (dark)
Accent 1:    cyan-400 (headings)
Accent 2:    blue-500 (secondary highlights)

Bus Colors:
- Bus 1:     red-500 (#ef4444)
- Bus 2:     blue-500 (#3b82f6)
- Bus 3:     green-500 (#10b981)

Status Colors:
- Good:      green-600 (gap >= 25)
- Warning:   yellow-600 (15-25)
- Critical:  red-600 (< 15)
```

**Layout:**
```
Header
├─ Title + connection status
├─ Grid (lg: 3 columns)
│  ├─ Left 2/3: SVG visualization
│  └─ Right 1/3: Control panels
│     ├─ Gap status
│     └─ Control buttons
└─ Full width: Activity log
```

---

## Communication Protocol (REST + WebSocket)

### REST Endpoints (Fallback)

```http
GET /
→ { "status": "ok", "service": "Bus Bunching Control System" }

GET /state
→ { "buses": [...], "gaps": {...}, ... }

POST /algorithm/toggle
→ { "algorithm_enabled": true/false }

POST /inject-delay/{bus_id}
→ { "status": "delay injected", "bus_id": "..." }

POST /reset
→ { "status": "reset" }
```

### WebSocket Endpoint

```
ws://localhost:8000/ws

Incoming (Server → Client):
- Event: message
- Data: JSON serialized SimulationState

Outgoing (Client → Server):
- Event: text message
- Data: JSON with "type" field
```

---

## Performance Characteristics

### Simulation Loop
```
Tick Rate:           1 Hz (1 second per tick)
Buses Updated:       3
Calculations/tick:   ~20 (position updates, distance, status checks)
Memory/bus:          ~200 bytes
Total Memory (sim):  ~5 KB
```

### WebSocket Streaming
```
Messages/second:     1 (state broadcast)
Message size:        ~500-800 bytes (3 buses + log)
Bandwidth:           ~5-8 KB/second
Reconnection delay:  3 seconds (automatic)
```

### Frontend Rendering
```
SVG elements:        ~15 (circles, text labels)
Render rate:         ~60 FPS (browser optimized)
React re-renders:    ~1 per WebSocket message (1/second)
Memory:              ~20-30 MB (Vite dev server)
```

---

## Algorithmic Complexity

### Per-Tick Operations
```
1. Position Updates:    O(n) where n=3 buses
2. Stop Detection:      O(n*s) where s=4 stops, uses distance check
3. Gap Calculation:     O(n²) - n buses checking to next bus
4. Anti-bunching:       O(n²) - check all gaps, apply holding logic

Total: O(n²) ≈ O(9) = O(1) for fixed n=3
```

### Memory
```
- Bus objects:       ~600 bytes (3 × dataclass)
- Event log:         ~10-20 KB (max 50 events × 200 bytes)
- WebSocket buffer:  ~50 KB (connection overhead)
- Total backend:     ~50 MB (with FastAPI/Uvicorn)
```

---

## Key Design Decisions

1. **Circular Route**: Simplifies geographic calculations and eliminates terminal stations
2. **Fixed 1 Hz Tick Rate**: Matches typical transit control systems, easier to reason about
3. **Headway-Based Control**: Industry-standard approach (GPS-based hold-short logic)
4. **Holding vs. Speed Reduction**: More realistic than just slowing down (bus fully stops)
5. **WebSocket Over REST**: Real-time updates without polling, lower latency
6. **SVG Visualization**: Scalable, no Canvas complexity, easy to annotate with text
7. **Tailwind CSS**: Rapid UI development, dark theme fits transit control aesthetic

---

## Testing Scenarios

### Scenario 1: Normal Operation
```
Initial: Bus spacing 33.3 units (perfect)
Result: All buses move evenly, no algorithm intervention
Expected: No holding events, gaps remain stable
```

### Scenario 2: Inject Delay on Bus 1
```
Inject: speed_multiplier = 0.4 for 30 seconds
Bus sequence: Bus1(slow) → Bus2 → Bus3
Bus2 catches Bus1 (gap < 15) → triggers bunching alert
Bus2 enters holding at next stop
Gap grows as Bus1 slows further
Gap recovers (≥25) → Bus2 resumes
Result: Natural redistribution after ~60 seconds
```

### Scenario 3: Disable Algorithm During Bunching
```
Toggle: algorithm_enabled = false
Bus1 at pos 20, Bus2 at pos 15 (gap = 95)
Bus sequence: Both move normally despite tight initial spacing
Gap shrinks naturally as Bus2 catches up
Gap stabilizes at ~25-30 (due to natural physics)
Result: Buses bunch tightly together, no holding
```

### Scenario 4: Rapid Multiple Delays
```
Inject: Delay Bus 1, Bus 2, Bus 3 sequentially
All buses slow to 0.4x
Gap changes: All reduce proportionally
Algorithm: Applies holding as thresholds crossed
Result: System eventually stabilizes when delays wear off
```

---

## Lessons & Improvements

### Current Limitations
1. Fixed route geometry (real transit has complex networks)
2. Deterministic physics (no stochastic delays like weather)
3. No passenger boarding effects (real dwell times increase with headway)
4. No schedule adherence (real buses aim for timetables, not spacing)
5. Single algorithm (real systems use multi-agent or ML approaches)

### Potential Enhancements
```
Level 1: More Routes
├─ Multiple routes sharing stops
├─ Route transfers/hub stations
└─ Dynamic route selection

Level 2: Advanced Physics
├─ Acceleration/deceleration
├─ Traffic light signal interactions
├─ Passenger demand simulation
└─ Real-world delay injection (heavy-tailed distributions)

Level 3: Better Algorithms
├─ Predictive holding (look-ahead windows)
├─ Machine learning (trained on historical data)
├─ Multi-objective optimization (schedule + spacing)
└─ Cooperative control (inter-bus communication)

Level 4: Real Integration
├─ GPS feed integration
├─ Passenger counter data
├─ Real-time schedule integration
└─ Digital signage connectivity
```

---

## References

**Transit Control Algorithms:**
- Headway-based point control (Eberlein et al., 1995)
- Real-time control of headways (TCRP Report 165)
- GPS-based holding for bunching prevention (TRB 2010)

**Technical Standards:**
- GTFS (General Transit Feed Specification) for route data
- AVL (Automatic Vehicle Location) protocols
- SCADA systems for transit operations

