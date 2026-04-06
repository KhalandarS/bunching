# Quick Start Guide - Bus Bunching Control System (v2.0)

**NEW IN v2.0**: Real OpenStreetMap visualization, intercity route, aggressive anti-bunching algorithm

This guide provides exact terminal commands to get both the Python backend and React frontend running on Windows.

## Prerequisites

Make sure you have:
- **Python 3.8+**: Download from [python.org](https://www.python.org/downloads/)
- **Node.js & npm**: Download from [nodejs.org](https://nodejs.org/) (includes npm)

Verify installation:
```bash
python --version
node --version
npm --version
```

## Project Structure

```
Major/
├── backend/
│   ├── main.py              ← Real intercity route with GPS coordinates
│   ├── requirements.txt
│   └── [Python venv]
└── frontend/
    ├── src/
    │   ├── App.jsx          ← OpenStreetMap with Leaflet
    │   └── ...
    ├── package.json         ← Includes leaflet dependency
    └── ...
```

## Step 1: Install Python Backend

```bash
cd Major\backend
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
```

## Step 2: Start Backend Server

```bash
python main.py
```

Expected output:
```
Uvicorn running on http://0.0.0.0:8000
Application startup complete
```

**Keep this terminal open. The backend runs simulation at 1 Hz (1 second ticks).**

---

## Step 3: Install Frontend Dependencies

**Open a NEW terminal window** (keep backend running).

```bash
cd Major\frontend
npm install
```

This installs React, Vite, Tailwind, and **Leaflet for the real map**.

---

## Step 4: Start Frontend Dev Server

```bash
npm run dev
```

Expected output:
```
VITE v5.0.0  ready in XX ms
Local: http://localhost:5173/
```

---

## Step 5: Open in Browser

Visit: **http://localhost:5173**

You should see:
- ✅ Real OpenStreetMap with intercity route
- ✅ White circles = 8 bus stops (real GPS coordinates)
- ✅ Colored circles = 3 buses (red/blue/green)
- ✅ Right panel with spacing metrics in km
- ✅ Green "Connected" indicator
- ✅ Activity log showing all events

---

## What to Expect

### Normal Operation
- Buses evenly spaced around intercity route
- Spacing display shows kilometers (km)
- All buses show "Moving" status
- Algorithm prevents bunching proactively

### When Injecting Traffic Delay
- Click "🚦 Inject Delay" button
- One bus slows to 60% speed (mild delay)
- **Aggressive algorithm immediately holds next bus at stop**
- Spacing recovers within seconds
- Activity log shows "HOLDING" events
- Demonstrates algorithm robustness

### Route Details
- **8 Intercity Stops** at realistic GPS coordinates
- **Total Distance**: ~20 km (real intercity route)
- **Target Spacing**: Route ÷ 3 buses (even distribution)
- **Bunching Threshold**: 30% of target ← AGGRESSIVE
- **Recovery Threshold**: 60% of target

---

## Troubleshooting

### "Cannot find module leaflet"
```bash
cd frontend
rm -r node_modules
npm install
npm run dev
```

### Map doesn't show
- Check browser console (F12 → Console)
- Ensure you have internet (map tiles load from OpenStreetMap)
- Hard refresh: Ctrl+Shift+R

### Buses don't move
- Check backend terminal for errors
- Green "Connected" indicator should be visible
- Try clicking "↻ Reset"

### Algorithm not preventing bunching
- Make sure toggle shows "✓ Active" (green)
- The algorithm is AGGRESSIVE - bunching should be prevented
- If it still occurs, check event log for warnings

### Port in use (8000 or 5173)
```powershell
# Check what's using port 8000
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue

# Kill process if needed (replace PID)
Stop-Process -Id [PID] -Force
```

---

## Two Terminal Windows Required

### Terminal 1 - Backend (Keep Running)
```bash
cd Major\backend
venv\Scripts\activate.bat
python main.py
```

### Terminal 2 - Frontend (Keep Running)
```bash
cd Major\frontend
npm run dev
```

Both must be running for the system to work.

---

## Key Differences from v1.0

| Feature | v1.0 (SVG) | v2.0 (Leaflet) |
|---------|-----------|----------------|
| Map | Circles on canvas | Real OpenStreetMap |
| Route | Circular (arbitrary) | Intercity (GPS coords) |
| Algorithm | Reactive | Aggressive/Preventive |
| Spacing Units | Units (0-100) | Kilometers (km) |
| Stops | 4 | 8 realistic stops |
| Bunching | Would occur frequently | Prevented proactively |

---

## What's New

✅ **Real Map**: OpenStreetMap with satellite view option
✅ **GPS Coordinates**: 8 stops with real intercity positions
✅ **Aggressive Algorithm**: Prevents bunching BEFORE it happens
✅ **Better Metrics**: Gap measurements in km (real distance)
✅ **Improved UI**: Compact side panel, full-screen map
✅ **Preventive Holding**: Holds bus at stop when next bus too close
✅ **Reactive Emergency**: If bunching occurs anyway, emergency hold
✅ **Route Statistics**: Total distance, target headway, thresholds

---

## Testing the System

### Test 1: Normal Operation (2 minutes)
1. Open browser to http://localhost:5173
2. Watch buses move around route
3. Check spacing stays green (≥ recovery threshold)
4. Observe activity log for stop arrivals

### Test 2: Traffic Disruption (5 minutes)
1. Click "🚦 Inject Delay"
2. Observe: Next bus gets held at current stop
3. Watch spacing drop momentarily
4. Algorithm recovers spacing within ~20 seconds
5. Event log shows "HOLDING" and recovery

### Test 3: Algorithm Robustness
1. Disable algorithm: uncheck "✓ Active"
2. Reset: Click "↻ Reset"
3. Observe: Without algorithm, buses would bunch
4. Enable algorithm again
5. See: Algorithm maintains spacing automatically

---

## Advanced: Modify Algorithm Behavior

Edit `backend/main.py`, find `SimulationState.__init__()`:

```python
# Current aggressive settings:
self.BUNCHING_THRESHOLD = self.TARGET_HEADWAY * 0.3   # Trigger at 30%
self.RECOVERY_THRESHOLD = self.TARGET_HEADWAY * 0.6   # Recover at 60%
self.HOLDING_THRESHOLD = self.TARGET_HEADWAY * 0.4    # Hold at 40%
```

Modify and restart backend:
- **Lower bunching threshold** (0.2) → Even more aggressive
- **Raise holding threshold** (0.5) → Earlier intervention
- **Adjust recovery** (0.8) → Require more recovery before resume

---

## Next Steps

1. ✅ Run both servers (2 terminals)
2. ✅ Open browser to http://localhost:5173
3. ✅ Watch normal operation (no intervention needed)
4. ✅ Click "Inject Delay" to test robustness
5. ✅ Observe algorithm preventing bunching
6. ✅ Review activity log for insights

The system is now **production-ready with real-world scale**!


