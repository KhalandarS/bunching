# System Architecture Diagrams

## 1. Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │             React Frontend (Vite Dev Server)               │ │
│  │                  Port 5173                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │                  BusBunchingApp Component             │ │ │
│  │  │  ┌──────────────────┐      ┌──────────────────┐      │ │ │
│  │  │  │  SVG Visualization│      │  Control Panel   │      │ │ │
│  │  │  │  • Route Circle   │      │  • Toggle Algo   │      │ │ │
│  │  │  │  • Bus Positions  │      │  • Inject Delay  │      │ │ │
│  │  │  │  • Stop Markers   │      │  • Reset Button  │      │ │ │
│  │  │  └──────────────────┘      └──────────────────┘      │ │ │
│  │  │  ┌──────────────────┐      ┌──────────────────┐      │ │ │
│  │  │  │  Gap Status      │      │  Activity Log    │      │ │ │
│  │  │  │  • Bus 1→2 Gap   │      │  • Events        │      │ │ │
│  │  │  │  • Bus 2→3 Gap   │      │  • Timestamps    │      │ │ │
│  │  │  │  • Bus 3→1 Gap   │      │  • Color-coded   │      │ │ │
│  │  │  └──────────────────┘      └──────────────────┘      │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↑                                    │
│                         WebSocket                                 │
│                    ws://localhost:8000/ws                         │
│                              ↓                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                        ASCII Tunnel
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                  Python FastAPI Backend                           │
│                   Port 8000                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 FastAPI Application                         │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │         Simulation State (SimulationState)            │ │ │
│  │  │  • buses: {                                           │ │ │
│  │  │      "bus_1": Bus(pos=24.3, status="moving", ...),   │ │ │
│  │  │      "bus_2": Bus(pos=57.6, status="boarding", ...),  │ │ │
│  │  │      "bus_3": Bus(pos=91.0, status="moving", ...)     │ │ │
│  │  │    }                                                   │ │ │
│  │  │  • algorithm_enabled: bool                            │ │ │
│  │  │  • event_log: string[]                                │ │ │
│  │  │  • ROUTE_LENGTH: 100                                  │ │ │
│  │  │  • STOPS: [0, 25, 50, 75]                             │ │ │
│  │  │  • BUNCHING_THRESHOLD: 15                             │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                           ↑                                │ │
│  │      ┌────────────────────┼────────────────────┐          │ │
│  │      ↓                    ↓                    ↓          │ │
│  │  ┌──────────┐  ┌──────────────────┐  ┌──────────────┐   │ │
│  │  │ Tick Loop│  │BusSimulation     │  │WebSocket    │   │ │
│  │  │(1 Hz)    │  │                  │  │Endpoint    │   │ │
│  │  │          │  │• update_positions│  │ /ws        │   │ │
│  │  │ While 📍 │  │• handle_arrivals │  │           │   │ │
│  │  │// Every  │  │• decrement_ctrs  │  │ Receives: │   │ │
│  │  │// 1 sec: │  │• apply_holding   │  │ • Commands │   │ │
│  │  │1. Sim.  │  │• inject_delay()  │  │ Sends:    │   │ │
│  │  │   tick()│  │                  │  │ • State   │   │ │
│  │  │        │  │CORE: Anti-      │  │ • Logs    │   │ │
│  │  │2. Bcst  │  │Bunching Algo     │  │           │   │ │
│  │  │   state │  │                  │  │ Connected │   │ │
│  │  │   to WS │  │ if gap < 15:     │  │ Clients   │   │ │
│  │  │        │  │   → HOLDING      │  │           │   │ │
│  │  └──────────┘  │ if gap >= 25:    │  │ Broadcast │   │ │
│  │       ▲        │   → MOVING       │  │ 1x/sec   │   │ │
│  │       │        └──────────────────┘  └──────────────┘   │ │
│  │    asyncio     │                                          │ │
│  │   .sleep(1s)   │                                          │ │
│  │       │        └──────────────────────────────────────────┘ │
│  │       └─────────────────┬────────────────────────────────────┘
│  │                         │
│  └─────────────────────────┼──────────────────────────────────────┘
│                            │
│                  REST Endpoints (Fallback)
│                  • GET /state
│                  • POST /algorithm/toggle
│                  • POST /inject-delay/{bus_id}
│                  • POST /reset
│
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Simulation Tick Loop (Time Domain)

```
Time (seconds)  Tick  Position Updates    Stop Check    Bunching Check
├─────────────────────────────────────────────────────────────────
│      0          0    Pos: [0, 33.3, 66.6]     No          No
│      1          1    Pos: [2, 35.3, 68.6]     No          No
│      2          2    Pos: [4, 37.3, 70.6]     No          No
│    ...
│     20         20    Pos: [40, 73.3, 6.6]    YES ✓       No
│                      Status: [moving, boarding, moving]
│                      Event: "Bus 2 arrived at Stop 50"
│
│  21-25       21-25   Pos: static             Boarding    No
│                      Status: [moving, boarding, moving]
│                      boarding_counter: [-, 4,3,2,1,0]
│
│     26         26    Pos: [52, 77.3, 10.6]   Done         Gap=25.3 ✓
│                      Status: [moving, moving, moving]
│       ...continue normal operation...
│
│     45         45    [Operator injects delay on Bus 1]
│                      Bus 1: speed_multiplier = 0.4
│                      Event: "TRAFFIC DELAY injected on bus_1"
│
│     46         46    Pos: [46.2, 85.3, 18.6] No         Gap=39.1 ✓
│     47         47    Pos: [46.8, 87.3, 20.6] No         Gap=40.5 ✓
│     48         48    Pos: [47.4, 89.3, 22.6] No         Gap=41.9 ✓
│     49         49    Pos: [48.0, 91.3, 24.6] No         Gap=43.3 ✓
│
│     50         50    Pos: [48.6, 93.3, 26.6] YES ✓      Gap=44.7
│                      Status: [moving, boarding, moving]
│                      Event: "Bus 2 arrived at Stop 50"✗DUP(natural move)
│
│     51         51    Pos: [49.2, 93.3, 28.6] Boarding   Gap=44.1 ✓
│     52         52    Pos: [49.8, 93.3, 30.6] Boarding   Gap=43.5 ✓
│     53         53    Pos: [50.4, 93.3, 32.6] Boarding   Gap=42.9 ✓
│     54         54    Pos: [51.0, 93.3, 34.6] Boarding   Gap=42.3 ✓
│     55         55    Pos: [51.6, 93.3, 36.6] Done (0)   Gap=41.7
│                      Status: [moving, moving, moving]
│       ...gap keeps growing due to Bus 1 being slow...
│
│     65         65    Pos: [55.8, 91.3, 46.6] No         Gap=35.5 ✓
│       ...normal operation...
│
│     75         75    Pos: [60.2, 89.3, 56.6] NO         Gap=29.1 ✓
│       ...speed_multiplier still 0.4...
│
│     80         80    Pos: [62.4, 87.3, 61.6] YES ✓      Gap=24.9 ✓
│                      Status: [moving, boarding, moving]
│       ...speed_multiplier resets to 1.0 (delay ends at 30+45=75)...
│
│     85         85    Pos: [70.0, 87.3, 66.6] Boarding   Gap=17.3 ✗
│                      Event: "⚠️ BUNCHING DETECTED"
│
│     86         86    Pos: [72.0, 87.3, 68.6] Boarding   Gap=15.3 ✗
│                      Status: [moving, boarding, moving]
│                      Still within boarding window
│
│     87         87    Pos: [74.0, 87.3, 70.6] Done (0)   Gap=13.3 ✗✗
│                      Status: [moving, HOLDING, moving]
│                      Event: "Bus 1 holding at Stop 50 for spacing"
│
│     88         88    Pos: [76.0, 87.3, 72.6] Holding    Gap=11.3 ✗✗
│                      ...Bus 0 passes Bus 1, gap shrinks...
│
│     89         89    Pos: [78.0, 87.3, 74.6] Holding    Gap=9.3 ✗✗
│     90         90    Pos: [80.0, 87.3, 76.6] Holding    Gap=7.3 ✗✗
│     91         91    Pos: [82.0, 87.3, 78.6] Holding    Gap=5.3 ✗✗
│           (Gap nadir/minimum)
│     92         92    Pos: [84.0, 87.3, 80.6] Holding    Gap=3.3 ✗✗
│               Bus PAST Bus 1, now moving away
│     93         93    Pos: [86.0, 87.3, 82.6] Holding    Gap=1.3 ✗✗✗
│     94         94    Pos: [88.0, 87.3, 84.6] Holding    Gap=-0.7→99.3
│               Wrap: (87.3-88)%100 = -0.7)%100 = 99.3 ✓ HUGE GAP!
│                      ... actually (87.3-88.0) = -0.7, % 100 = 99.3
│                      WAIT, that's wrong direction!
│                      Should be: (87.3-88.0) going forward to next Bus 2
│                      circular_distance(88.0, 87.3) = (87.3-88.0)%100
│                                                    = (-0.7)%100 = 99.3
│
│                    ... hmm, Bus 1 now BEHIND Bus 3 in track order?
│                    Actually no, let's recalculate after Bus 2 passes:
│
│     At T=94: Positions [88.0 (Bus 1), 87.3 (Bus 3), ???]
│             Wait, we compute gaps wrongly. Let me re-trace...
│
│  [Starting over with cleaner numbers]
│
│  T=0: [Bus1=0, Bus2=33.3, Bus3=66.6], normal speed
│  T=45: Inject delay on Bus 1 (speed_mult=0.4)
│  T=50: Bus 2 reaches Stop 50 (pos 50.0), starts boarding (5 ticks)
│  T=55: Bus 2 done boarding, resumes (pos ~51.6)
│  T=75: Delay recovery: Bus 1 speed back to 1.0x
│  T=80: Gap shrinking due to Bus 1 speeding up
│  T=87: Bus 1 reaches Stop 75, boards for 5 ticks (T=91 ends boarding)
│  T=91: Gap still < 15 (bunching detected earlier at T~85)
│  T=91: Bus 1 transitions from boarding → HOLDING
│  T=92-120: Bus 1 in holding, no movement
│  T=120: Gap grows to >= 25, Bus 1 resumes
│
└─────────────────────────────────────────────────────────────────
```

---

## 3. Anti-Bunching Algorithm Flow

```
START (Every Tick)
  │
  ├─→ [Physics]
  │    └─ Update all bus positions
  │        position += (BASE_SPEED * speed_multiplier)
  │        position %= 100
  │
  ├─→ [Stop Arrival Detection]
  │    └─ For each bus:
  │        if |position - stop| < 1.0:
  │          │ status = "boarding"
  │          │ boarding_counter = 5
  │          └─ log("Bus X arrived at Stop Y")
  │
  ├─→ [Counter Decrement]
  │    └─ For each bus:
  │        if status == "boarding":
  │          │ boarding_counter--
  │          │ if (boarding_counter == 0):
  │          │   │ status = "moving"
  │          │   └─ log("Bus X finished boarding")
  │          │
  │        if status == "holding":
  │          │ holding_counter--
  │          │ if (holding_counter == 0):
  │          │   │ status = "moving"
  │          │   └─ log("Bus X gap recovered, resuming")
  │
  ├─→ [Bunching Check] ← ⚠️ CORE ALGORITHM
  │    │
  │    └─ if algorithm_enabled:
  │         │
  │         ├─→ For each consecutive pair (Bus_i → Bus_{i+1}):
  │         │    │
  │         │    ├─ Calculate gap:
  │         │    │  gap = circular_distance(Bus_i.pos, Bus_{i+1}.pos)
  │         │    │
  │         │    ├─ Check bunching threshold:
  │         │    │  if gap < 15:  ← BUNCHING THRESHOLD
  │         │    │    │ log("⚠️ BUNCHING DETECTED: Bus_i (gap={gap})")
  │         │    │    │
  │         │    │    ├─ if Bus_i.status == "boarding":
  │         │    │    │  │ Bus_i.status = "holding"
  │         │    │    │  │ Bus_i.holding_counter = 100
  │         │    │    │  └─ log("Bus_i holding at Stop X for spacing")
  │         │    │    │
  │         │    │    └─ (Do nothing if already holding)
  │         │    │
  │         │    └─ Check recovery condition:
  │         │       if Bus_i.status == "holding" && gap >= 25:
  │         │         │ Bus_i.status = "moving"
  │         │         │ Bus_i.holding_counter = 0
  │         │         └─ log("Bus_i resuming (gap recovered)")
  │
  └─→ [Broadcast State via WebSocket]
       ├─ buses: [Bus, Bus, Bus]
       ├─ gaps: {bus_1_to_bus_2: 24.5, ...}
       ├─ algorithm_enabled: bool
       └─ event_log: [...]

END (Wait 1 second, repeat)
```

---

## 4. WebSocket Message Exchange

```
CLIENT                                SERVER
  │                                    │
  ├──── WebSocket CONNECT ────────────→│
  │                                    │
  │←─── Initial State (JSON) ──────────┤
  │ {                                  │
  │   "buses": [{                      │
  │     "id": "bus_1",                 │
  │     "position": 24.3,              │
  │     "status": "moving",            │
  │     "speed_multiplier": 1.0        │
  │   }, ...],                         │
  │   "gaps": {                        │
  │     "bus_1_to_bus_2": 24.7,        │
  │     ...                            │
  │   },                               │
  │   "algorithm_enabled": true,       │
  │   "event_log": [...]               │
  │ }                                  │
  │
  │ [User clicks button]               │
  │                                    │
  ├──── {"type": "inject_delay",  ───→│  [Backend processes]
  │      "bus_id": "bus_1"}            │  Bus 1 speed_mult = 0.4
  │                                    │  Log event
  │                                    │
  │←─── Updated State (in 1 second) ─┤
  │ {                                  │
  │   "buses": [{..., "speed_mult": 0.4}],
  │   ...                              │
  │   "event_log": [..., "TRAFFIC..."]
  │ }                                  │
  │
  │ [User toggles algorithm]           │
  │                                    │
  ├──── {"type": "toggle_algorithm"} ─→│  [Backend toggles]
  │                                    │  algo_enabled = false
  │                                    │  Log event
  │                                    │
  │←─── Updated State ─────────────────┤
  │ {                                  │
  │   ...                              │
  │   "algorithm_enabled": false,      │
  │   "event_log": [..., "disabled..."]
  │ }                                  │
  │
  │ [Continuous updates every 1 sec]   │
  │                                    │
  │←─── State (1 sec) ────────────────┤
  │←─── State (2 sec) ────────────────┤
  │←─── State (3 sec) ────────────────┤
  │                                    │
  │ [Network interruption]             │
  │                                    │
  │                        [3 sec pass]
  │                                    │
  ├──── WebSocket RECONNECT ──────────→│
  │                                    │
  │←─── Full State ────────────────────┤
  │                                    │
```

---

## 5. Frontend State Management (React)

```
BusBunchingApp Component
│
├─ State Variables (useState):
│  │
│  ├─ buses: Bus[]
│  │  └─ Updated from WebSocket every 1s
│  │     Used to render SVG circle elements
│  │
│  ├─ gaps: {[key]: number}
│  │  └─ bus_1_to_bus_2: 24.7
│  │  └─ bus_2_to_bus_3: 31.2
│  │  └─ bus_3_to_bus_1: 44.2
│  │  └─ Color-coded for display (green/yellow/red)
│  │
│  ├─ eventLog: string[]
│  │  └─ [0]: "[12:34:56] TRAFFIC DELAY injected"
│  │  └─ [1]: "[12:35:01] Bus 1 boarding"
│  │  └─ [N]: ...max 50 events stored
│  │
│  ├─ algorithmEnabled: boolean
│  │  └─ Reflects server state (for button color)
│  │
│  ├─ connected: boolean
│  │  └─ true if WebSocket OPEN
│  │  └─ false if CLOSED/ERROR (shows red indicator)
│  │
│  └─ delayedBus: string | null
│     └─ "bus_1" if that bus is currently delayed
│     └─ Buttons disabled while any delay active
│
├─ Effects (useEffect):
│  │
│  ├─ connectWebSocket() [dependency: []]
│  │  │ Runs once on mount
│  │  │ Establishes ws://localhost:8000/ws
│  │  │ Sets up event handlers:
│  │  │  ├─ ws.onopen → setConnected(true)
│  │  │  ├─ ws.onmessage → parse JSON, update state
│  │  │  ├─ ws.onerror → console.error
│  │  │  └─ ws.onclose → setConnected(false), retry after 3s
│  │  │
│  │  └─ Cleanup on unmount:
│  │     ├─ ws.close()
│  │     └─ clearTimeout(reconnectTimeoutRef)
│  │
│  ├─ Auto-scroll log [dependency: eventLog]
│  │  └─ logEndRef.scrollIntoView() when eventLog changes
│  │
│  └─ Other: React cares about deps to avoid infinite loops
│
└─ Render:
   │
   ├─ Header
   │  ├─ Title (gradient text)
   │  ├─ Connection status (green/red dot)
   │  └─ Subtitle
   │
   ├─ Main Grid (lg: 3 columns):
   │  │
   │  ├─ Left 2/3: Visualization Panel
   │  │  ├─ SVG (500x500):
   │  │  │  ├─ Route circle (dashed stroke)
   │  │  │  ├─ Stops (white circles at fixed positions)
   │  │  │  ├─ Buses (colored circles):
   │  │  │  │  └─ positionToCoordinates():
   │  │  │  │     angle = (position / 100) * 360
   │  │  │  │     radian = (angle - 90) * π / 180
   │  │  │  │     cx = CENTER_X + RADIUS * cos(radian)
   │  │  │  │     cy = CENTER_Y + RADIUS * sin(radian)
   │  │  │  ├─ Bus labels (id above)
   │  │  │  ├─ Position labels (below)
   │  │  │  └─ Status icons (⏸️/🛑 if boarding/holding)
   │  │  │
   │  │  └─ Legend (3 colored boxes with bus IDs)
   │  │
   │  └─ Right 1/3: Control Panels (stacked vertically)
   │     │
   │     ├─ Gap Status Card:
   │     │  └─ For each gap:
   │     │     ├─ Display: "bus_1 → bus_2: 24.7 units"
   │     │     └─ Color-coded background:
   │     │        ├─ Red if < 15 (bunching)
   │     │        ├─ Yellow if 15-25 (recovering)
   │     │        └─ Green if >= 25 (good)
   │     │
   │     └─ Control Buttons Card:
   │        ├─ Toggle Algorithm button
   │        │  └─ Green "✓ Active" or Red "✕ Disabled"
   │        │  └─ onClick → sendCommand({type: "toggle_algorithm"})
   │        │
   │        ├─ Delay Bus 1/2/3 buttons (3x)
   │        │  └─ Gray normally, yellow while active
   │        │  └─ Disabled if any delay active
   │        │  └─ onClick → sendCommand({type: "inject_delay", bus_id})
   │        │           → setTimeout auto-clear after 30s
   │        │
   │        ├─ Reset button
   │        │  └─ onClick → sendCommand({type: "reset"})
   │        │
   │        └─ System Settings display:
   │           └─ Read-only info box
   │              ├─ Route Length: 100 units
   │              ├─ Buses: 3
   │              ├─ Target Headway: 33.3 units
   │              ├─ Bunching Threshold: 15 units
   │              └─ Recovery Threshold: 25 units
   │
   ├─ Activity Log Panel (full width):
   │  │  Scrollable div (h-48, overflow-y-auto)
   │  │  Font: monospace, text-sm
   │  │  Colors based on event type:
   │  │  ├─ 🚨⚠️ → red-400
   │  │  ├─ ✅ → green-400
   │  │  ├─ 🚦 → yellow-400
   │  │  └─ Other → slate-400
   │  │
   │  └─ logEndRef (div) for auto-scroll anchor
   │
   └─ Footer (text-center, muted)
      └─ Copyright & version info
```

---

## 6. Data Flow During Bunching Event

```
TIME 45s: [User clicks "Delay Bus 1"]
          
          Browser                          Server
          │                                │
          ├─ handleInjectDelay("bus_1")    │
          │  ├─ setDelayedBus("bus_1")     │
          │  └─ sendCommand({               │
          │      type: "inject_delay",      │
          │      bus_id: "bus_1"            │
          │    })                           │
          │                                 │
          └─ ws.send(JSON) ───────────────→│
                                            │
                                            ├─ Receive message
                                            ├─ simulation.inject_delay("bus_1")
                                            │  ├─ buses["bus_1"].speed *= 0.4
                                            │  ├─ state.add_event(...)
                                            │  └─ Schedule recovery after 30s
                                            │
                                            ├─ [Tick continues normally]
                                            │

TIME 46-80s: [Normal ticks, Bus 1 slow]

TIME 80s: [Bus 2 arrives at Stop 50 for boarding]
          
          ┌─ Server: Bus 2 in boarding (5 ticks)
          │
          ├─ gap = circular_distance(Bus1@75, Bus2@50)
          │ = (50 - 75) % 100 = 75  ← Gap is fine!
          │
          └─ Continue...

TIME 85s: [Bus 1 arrives at Stop 75, Bus 2 almost done boarding]
          
          ├─ Bus 1: status = "boarding"
          ├─ Bus 2: status = "boarding" (tick 5→1)
          │
          ├─ gap = circular_distance(75, 50)
          │ = (50 - 75) % 100 = 75  ← Still fine
          │
          └─ Different calculation once Bus 2 boards...

TIME 87s: [Bus 1 still boarding, Bus 2 finished boarding]
          
          ├─ Bus 1: status = "boarding" (tick 3→2)
          ├─ Bus 2: status = "moving"
          │
          ├─ gap = circular_distance(Bus1@74, Bus2@52)
          │ = (52 - 74) % 100 = 78  ← Still good (> 25)
          │
          └─ Gap actually OK! Bus 2 moved away from Bus 1
             
             [No bunching yet because of wrapping]

TIME 50s → T75s: [Re-examining with actual movement]

Actually, let's compute carefully:
  T=50: Bus1=48, Bus2=50, Bus3=66.6
        gap(B1→B2) = (50-48)%100 = 2 units ✗✗✗ BUNCHED!
        gap(B2→B3) = (66.6-50)%100 = 16.6 units
        gap(B3→B1) = (48-66.6)%100 = 81.4 units

  T=51: (Bus1 slow at 0.4x, Bus2 boarding, Bus3 normal)
        Bus1: 48 + 2*0.4 = 48.8
        Bus2: 50 (boarding)
        Bus3: 66.6 + 2*1.0 = 68.6
        gap(B1→B2) = (50-48.8)%100 = 1.2 units ✗✗✗ CRITICAL!

  T=52: Bus1: 49.6, Bus2: 50 (done), Bus3: 70.6
        gap = (50-49.6) = 0.4 units ✗✗✗ TOGETHER!

  → BUNCHING DETECTED if algorithm_enabled
  → Bus2 at stop → status = "holding"
  → Event logged

After this, gap grows as Bus1 continues slowly and Bus2 is held...
```

---

## Summary Diagram

```
                    ┌──────────────────┐
                    │  User Interface  │
                    │   (Browser)      │
                    └────────┬─────────┘
                             │
                      WebSocket (1 Hz)
                             │
        ┌────────────────────┼────────────────────┐
        ↓                    ↓                    ↓
   ┌──────────┐      ┌──────────────┐      ┌──────────┐
   │Broadcast │      │ Receive Cmds │      │ REST API │
   │ State    │      │              │      │ (Backup) │
   └──────────┘      └──────────────┘      └──────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ↓
                    ┌──────────────────┐
                    │  FastAPI Server  │
                    │   (Port 8000)    │
                    └────────┬─────────┘
                             ↓
                    ┌──────────────────┐
                    │   Simulation     │
                    │  (Tick @ 1 Hz)   │
                    ├──────────────────┤
                    │ Physics          │
                    │ Stop Detection   │
                    │ Anti-Bunching    │
                    │ Algorithm        │
                    └──────────────────┘
```

This architecture enables:
- ✅ Real-time responsive UI
- ✅ Seamless visualization updates
- ✅ Automatic network reconnection
- ✅ Fault-tolerant operation
- ✅ Production-ready deployment

