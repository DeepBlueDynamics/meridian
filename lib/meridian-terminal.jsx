// Adapted from spec/2026-06-11/meridian-terminal.jsx (the dropped reference).
// Runs under React UMD + Babel standalone (no build step — file:// app).
// LLM calls go through the local relay on :9123 (ANTHROPIC_API_KEY lives in
// the MAIN process .env, never in the renderer) — swap to the service's
// infer.complete skill when its executor lands.
const { useState, useRef, useEffect, useCallback, createContext, useContext } = React;

// ═══════════════════════════════════════════════════════════════════════════════
// MERIDIAN TERMINAL — Dynamic tool creation, conversation memory, tool registry
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SHIP DATA CONTEXT - Central data source for all instruments
// ═══════════════════════════════════════════════════════════════════════════════
const ShipDataContext = createContext(null);

const useShipData = () => {
  const ctx = useContext(ShipDataContext);
  if (!ctx) throw new Error('useShipData must be used within ShipDataProvider');
  return ctx.data;
};

const useSetShipData = () => {
  const ctx = useContext(ShipDataContext);
  if (!ctx) throw new Error('useSetShipData must be used within ShipDataProvider');
  return ctx.setData;
};

const ShipDataProvider = ({ children }) => {
  const [data, setData] = useState({
    // Wind
    windSpeed: 18.4,      // knots
    windAngle: 247,       // degrees true
    windGust: 22.1,       // knots
    
    // Navigation
    heading: 127,         // degrees
    cog: 125,             // course over ground
    sog: 7.2,             // speed over ground (knots)
    
    // Position
    lat: 32.7157,         // San Diego
    lon: -117.1611,
    
    // Depth
    depth: 42.5,          // meters
    waterTemp: 18.2,      // celsius
    
    // Engine
    rpm: 2200,
    fuelRate: 12.4,       // liters/hour
    
    // Environment
    airTemp: 22.5,        // celsius
    pressure: 1013.25,    // hPa
    humidity: 65,         // percent
    
    // Waves
    waveHeight: 1.8,      // meters (significant wave height)
    wavePeriod: 8.5,      // seconds
    
    // Status
    gpsStatus: 'DGPS',
    satellites: 12,
    hdop: 0.8,
    
    // Battery Bank A (48V system)
    batteryAVoltage: 51.2,    // volts
    batteryAAmps: -12.5,      // amps (negative = discharging)
    batteryASoc: 78,          // state of charge %
    batteryATemp: 24.5,       // celsius
    solarAWatts: 320,         // solar input watts
    solarAVoltage: 58.4,      // solar voltage
    
    // Battery Bank B (48V system)
    batteryBVoltage: 52.1,    // volts
    batteryBAmps: 8.2,        // amps (positive = charging)
    batteryBSoc: 92,          // state of charge %
    batteryBTemp: 23.8,       // celsius
    solarBWatts: 485,         // solar input watts
    solarBVoltage: 62.1,      // solar voltage
    
    // Autopilot
    apEngaged: true,          // whether AP is actively steering
    apMode: 'AUTO',           // OFF, STANDBY, AUTO, WIND, TRACK
    apBus: 'A',               // which bus AP is managing (A or B)
    apTargetHeading: 125,     // degrees - what AP wants
    apTargetWind: 45,         // degrees apparent - for wind mode
    apRudderCommand: 2.3,     // degrees - what AP is commanding
    apRudderActual: 2.1,      // degrees - actual rudder position
    apCrossTrackError: 0.02,  // nm - distance off course (for TRACK mode)
    apGain: 5,                // responsiveness 1-9
    apDeadband: 2,            // degrees - heading tolerance before correction
    apMaxRudder: 25,          // degrees - max rudder angle allowed
    apResponseRate: 3,        // 1-5 how fast rudder moves
    
    // Fuel Tanks (300L each)
    fuel1Level: 245,          // liters
    fuel1Capacity: 300,       // liters
    fuel2Level: 289,          // liters
    fuel2Capacity: 300,       // liters
    
    // Water Tanks (500L each)
    water1Level: 412,         // liters
    water1Capacity: 500,      // liters
    water2Level: 178,         // liters
    water2Capacity: 500,      // liters
    
    // Gray Water Tank (shower/sink waste)
    grayWaterLevel: 89,       // liters
    grayWaterCapacity: 200,   // liters
    
    // Black Water Tank (sewage)
    blackWaterLevel: 34,      // liters
    blackWaterCapacity: 150,  // liters
    
    // Desalinator (watermaker)
    desalRunning: true,       // on/off
    desalTemp: 32.4,          // membrane temperature celsius
    desalAmps: 18.5,          // current draw amps
    desalOutput: 25,          // liters per hour production rate
    desalPressure: 58.2,      // membrane pressure bar
    desalHours: 1247,         // total run hours
    
    // System Resources
    cpuUsage: 34,             // percent
    cpuTemp: 52,              // celsius
    memUsed: 6.2,             // GB
    memFree: 9.8,             // GB
    memTotal: 16,             // GB
    gpuUsage: 28,             // percent
    gpuTemp: 48,              // celsius
    gpuMemUsed: 2.1,          // GB
    gpuMemFree: 5.9,          // GB
    gpuMemTotal: 8,           // GB
    processCount: 142,        // active processes
    
    // Anchor Windlass
    windlassRunning: false,   // on/off
    windlassDirection: 'STOP', // UP, DOWN, STOP
    windlassAmps: 0,          // current draw (0 when off, up to 80A when running)
    windlassMaxAmps: 80,      // max current draw
    rodeOut: 45,              // meters of chain/rope deployed
    rodeTotal: 100,           // total rode available
    anchorDown: true,         // is anchor deployed
    
    // Electric Propulsion Motor (100HP / 75kW equivalent)
    motorOn: true,            // on/off
    motorDirection: 'FWD',    // FWD, REV, NEUTRAL
    motorThrottle: 65,        // percent 0-100
    motorAmps: 180,           // current draw (varies with load)
    motorMaxAmps: 400,        // max current at full throttle
    motorVolts: 48,           // motor voltage
    motorTemp: 42,            // motor temperature celsius
    motorRpm: 2800,           // motor RPM
    motorMaxRpm: 4500,        // max RPM
    motorPower: 48,           // current power output kW
    motorMaxPower: 75,        // max power 75kW (100HP)
    
    // Lighting
    anchorLight: true,        // anchor light on/off
    steamingLight: false,     // steaming light on/off
    navLightsPort: true,      // port nav light
    navLightsStbd: true,      // starboard nav light
    navLightsStern: true,     // stern light
    deckLights: false,        // deck lights on/off
    spreaderLights: false,    // spreader lights on/off
    
    // Bilge Pumps
    bilgeFwdOn: false,        // forward bilge pump running
    bilgeFwdCycles: 3,        // cycle count today
    bilgeFwdLast: 47,         // minutes since last run
    bilgeMidOn: false,        // mid bilge pump running
    bilgeMidCycles: 1,        // cycle count today
    bilgeMidLast: 182,        // minutes since last run
    bilgeAftOn: false,        // aft bilge pump running
    bilgeAftCycles: 2,        // cycle count today
    bilgeAftLast: 95,         // minutes since last run
    
    // Other Pumps
    freshwaterPumpOn: false,  // freshwater pressure pump
    freshwaterPressure: 42,   // PSI
    washdownPumpOn: false,    // deck washdown pump
    maceratorOn: false,       // macerator pump
    
    // Climate
    cabinTemp: 23.5,          // cabin temperature celsius
    cabinHumidity: 58,        // cabin humidity %
    ac1On: true,              // A/C unit 1
    ac1Amps: 12.5,            // A/C unit 1 current draw
    ac2On: false,             // A/C unit 2
    ac2Amps: 0,               // A/C unit 2 current draw
    fridgeTemp: 3.2,          // refrigerator temp celsius
    freezerTemp: -18.5,       // freezer temp celsius
    
    // Hot Water & LPG
    hotWaterOn: true,         // hot water heater
    hotWaterTemp: 52,         // hot water tank temp celsius
    lpgLevel: 68,             // propane tank level %
    lpgValve: 'CLOSED',       // LPG solenoid valve OPEN/CLOSED
    lpgDetector: 'OK',        // LPG detector status OK/ALARM
    coDetector: 'OK',         // CO detector status OK/ALARM
    
    // Shore Power & Inverter & Generator
    shorePower: true,         // shore power connected
    shoreAmps: 28.5,          // shore power current draw
    shoreVolts: 120,          // shore voltage
    inverterOn: true,         // inverter on/off
    inverterLoad: 850,        // inverter load watts
    inverterCapacity: 3000,   // inverter max watts
    generatorOn: false,       // generator running
    generatorHours: 1247,     // generator run hours
    generatorLoad: 0,         // generator load watts
    generatorCapacity: 8000,  // generator max watts
    
    // Comms & Safety
    aisStatus: 'TX/RX',       // AIS transceiver status
    aisTargets: 7,            // number of AIS targets
    vhfOn: true,              // VHF radio on
    vhfChannel: 16,           // current VHF channel
    epirbArmed: true,         // EPIRB armed status
    epirbBattery: 98,         // EPIRB battery %
    mobStatus: 'CLEAR',       // MOB alarm status CLEAR/ALARM
  });

  // Simulate NMEA data updates
  useEffect(() => {
    const interval = setInterval(() => {
      setData(prev => ({
        ...prev,
        // Wind varies
        windSpeed: Math.max(5, Math.min(35, prev.windSpeed + (Math.random() - 0.5) * 1.2)),
        windAngle: (prev.windAngle + (Math.random() - 0.5) * 2 + 360) % 360,
        windGust: Math.max(prev.windSpeed, Math.min(45, prev.windGust + (Math.random() - 0.5) * 2)),
        
        // Heading drifts slowly
        heading: (prev.heading + (Math.random() - 0.5) * 0.5 + 360) % 360,
        cog: (prev.cog + (Math.random() - 0.5) * 0.3 + 360) % 360,
        sog: Math.max(0, Math.min(15, prev.sog + (Math.random() - 0.5) * 0.2)),
        
        // Position drifts very slowly
        lat: prev.lat + (Math.random() - 0.5) * 0.0001,
        lon: prev.lon + (Math.random() - 0.5) * 0.0001,
        
        // Depth varies with movement
        depth: Math.max(5, Math.min(200, prev.depth + (Math.random() - 0.5) * 0.5)),
        waterTemp: prev.waterTemp + (Math.random() - 0.5) * 0.05,
        
        // Engine
        rpm: Math.max(0, Math.min(3500, prev.rpm + (Math.random() - 0.5) * 20)),
        fuelRate: Math.max(0, prev.fuelRate + (Math.random() - 0.5) * 0.2),
        
        // Environment
        airTemp: prev.airTemp + (Math.random() - 0.5) * 0.02,
        pressure: prev.pressure + (Math.random() - 0.5) * 0.1,
        humidity: Math.max(30, Math.min(95, prev.humidity + (Math.random() - 0.5) * 0.5)),
        
        // Waves - height correlates loosely with wind, period is more stable
        waveHeight: Math.max(0.3, Math.min(6, prev.waveHeight + (Math.random() - 0.5) * 0.1 + (prev.windSpeed - 15) * 0.002)),
        wavePeriod: Math.max(4, Math.min(16, prev.wavePeriod + (Math.random() - 0.5) * 0.2)),
        
        // Battery Bank A
        batteryAVoltage: Math.max(44, Math.min(56, prev.batteryAVoltage + (Math.random() - 0.5) * 0.1)),
        batteryAAmps: prev.batteryAAmps + (Math.random() - 0.5) * 0.5,
        batteryASoc: Math.max(10, Math.min(100, prev.batteryASoc + (Math.random() - 0.5) * 0.1)),
        batteryATemp: prev.batteryATemp + (Math.random() - 0.5) * 0.1,
        solarAWatts: Math.max(0, Math.min(600, prev.solarAWatts + (Math.random() - 0.5) * 10)),
        solarAVoltage: Math.max(0, Math.min(80, prev.solarAVoltage + (Math.random() - 0.5) * 0.5)),
        
        // Battery Bank B
        batteryBVoltage: Math.max(44, Math.min(56, prev.batteryBVoltage + (Math.random() - 0.5) * 0.1)),
        batteryBAmps: prev.batteryBAmps + (Math.random() - 0.5) * 0.5,
        batteryBSoc: Math.max(10, Math.min(100, prev.batteryBSoc + (Math.random() - 0.5) * 0.1)),
        batteryBTemp: prev.batteryBTemp + (Math.random() - 0.5) * 0.1,
        solarBWatts: Math.max(0, Math.min(600, prev.solarBWatts + (Math.random() - 0.5) * 10)),
        solarBVoltage: Math.max(0, Math.min(80, prev.solarBVoltage + (Math.random() - 0.5) * 0.5)),
        
        // Autopilot - rudder responds to heading error only when engaged
        apTargetHeading: prev.apTargetHeading, // stays constant unless changed
        apTargetWind: prev.apTargetWind,
        apRudderCommand: prev.apEngaged ? (() => {
          const headingError = ((prev.apTargetHeading - prev.heading + 540) % 360) - 180;
          // Only correct if outside deadband
          if (Math.abs(headingError) < prev.apDeadband) return prev.apRudderCommand * 0.9;
          return Math.max(-prev.apMaxRudder, Math.min(prev.apMaxRudder, headingError * (prev.apGain * 0.05) + (Math.random() - 0.5) * 0.3));
        })() : 0,
        apRudderActual: prev.apRudderActual + (prev.apRudderCommand - prev.apRudderActual) * (prev.apResponseRate * 0.05) + (Math.random() - 0.5) * 0.1,
        apCrossTrackError: prev.apCrossTrackError + (Math.random() - 0.5) * 0.005,
        
        // Fuel consumption (slow drain from tank 1 first, then tank 2)
        fuel1Level: Math.max(0, prev.fuel1Level - (prev.rpm > 0 ? 0.002 : 0)),
        fuel2Level: prev.fuel1Level < 10 ? Math.max(0, prev.fuel2Level - (prev.rpm > 0 ? 0.002 : 0)) : prev.fuel2Level,
        
        // Water consumption (very slow)
        water1Level: Math.max(0, prev.water1Level - 0.0005 + (prev.desalRunning ? 0.0007 : 0)),
        water2Level: prev.water1Level < 20 ? Math.max(0, prev.water2Level - 0.0005) : prev.water2Level,
        
        // Gray water fills slowly (from water usage)
        grayWaterLevel: Math.min(prev.grayWaterCapacity || 200, (prev.grayWaterLevel || 0) + 0.0003),
        
        // Black water fills very slowly
        blackWaterLevel: Math.min(prev.blackWaterCapacity || 150, (prev.blackWaterLevel || 0) + 0.0001),
        
        // Desalinator
        desalTemp: prev.desalRunning 
          ? Math.min(45, Math.max(25, prev.desalTemp + (Math.random() - 0.48) * 0.3))
          : Math.max(20, prev.desalTemp - 0.1),
        desalAmps: prev.desalRunning 
          ? Math.max(15, Math.min(22, prev.desalAmps + (Math.random() - 0.5) * 0.5))
          : 0,
        desalOutput: prev.desalRunning
          ? Math.max(20, Math.min(30, prev.desalOutput + (Math.random() - 0.5) * 0.5))
          : 0,
        desalPressure: prev.desalRunning
          ? Math.max(55, Math.min(62, prev.desalPressure + (Math.random() - 0.5) * 0.3))
          : 0,
        desalHours: prev.desalRunning ? prev.desalHours + 0.00001 : prev.desalHours,
        
        // System Resources
        cpuUsage: Math.max(5, Math.min(95, prev.cpuUsage + (Math.random() - 0.5) * 8)),
        cpuTemp: Math.max(35, Math.min(85, prev.cpuTemp + (Math.random() - 0.5) * 2)),
        memUsed: Math.max(2, Math.min(prev.memTotal - 1, prev.memUsed + (Math.random() - 0.5) * 0.3)),
        memFree: prev.memTotal - Math.max(2, Math.min(prev.memTotal - 1, prev.memUsed + (Math.random() - 0.5) * 0.3)),
        gpuUsage: Math.max(0, Math.min(100, prev.gpuUsage + (Math.random() - 0.5) * 10)),
        gpuTemp: Math.max(30, Math.min(90, prev.gpuTemp + (Math.random() - 0.5) * 2)),
        gpuMemUsed: Math.max(0.5, Math.min(prev.gpuMemTotal - 0.5, prev.gpuMemUsed + (Math.random() - 0.5) * 0.2)),
        gpuMemFree: prev.gpuMemTotal - Math.max(0.5, Math.min(prev.gpuMemTotal - 0.5, prev.gpuMemUsed + (Math.random() - 0.5) * 0.2)),
        processCount: Math.max(80, Math.min(250, Math.round(prev.processCount + (Math.random() - 0.5) * 5))),
        
        // Windlass - amps spike when running, rode changes based on direction
        windlassAmps: prev.windlassRunning 
          ? Math.max(60, Math.min(prev.windlassMaxAmps, 70 + (Math.random() - 0.5) * 20))
          : 0,
        rodeOut: prev.windlassRunning && prev.windlassDirection === 'DOWN'
          ? Math.min(prev.rodeTotal, prev.rodeOut + 0.1)
          : prev.windlassRunning && prev.windlassDirection === 'UP'
            ? Math.max(0, prev.rodeOut - 0.1)
            : prev.rodeOut,
        
        // Electric Motor - current/power based on throttle, temp rises under load
        motorAmps: prev.motorOn && prev.motorDirection !== 'NEUTRAL'
          ? Math.max(20, (prev.motorThrottle / 100) * prev.motorMaxAmps + (Math.random() - 0.5) * 20)
          : prev.motorOn ? 5 : 0,  // idle draw when on but neutral
        motorRpm: prev.motorOn && prev.motorDirection !== 'NEUTRAL'
          ? Math.max(0, (prev.motorThrottle / 100) * prev.motorMaxRpm + (Math.random() - 0.5) * 50)
          : 0,
        motorPower: prev.motorOn && prev.motorDirection !== 'NEUTRAL'
          ? Math.max(0, (prev.motorThrottle / 100) * prev.motorMaxPower + (Math.random() - 0.5) * 2)
          : 0,
        motorTemp: prev.motorOn
          ? Math.min(95, prev.motorTemp + (prev.motorThrottle / 100) * 0.02 - 0.01)
          : Math.max(20, prev.motorTemp - 0.05),
        motorThrottle: Math.max(0, Math.min(100, prev.motorThrottle + (Math.random() - 0.5) * 0.5)), // slight drift, clamped
        
        // Bilge pump timers increment
        bilgeFwdLast: prev.bilgeFwdOn ? 0 : prev.bilgeFwdLast + 0.003,
        bilgeMidLast: prev.bilgeMidOn ? 0 : prev.bilgeMidLast + 0.003,
        bilgeAftLast: prev.bilgeAftOn ? 0 : prev.bilgeAftLast + 0.003,
        
        // Freshwater pressure varies slightly when pump is off
        freshwaterPressure: prev.freshwaterPumpOn 
          ? Math.min(55, prev.freshwaterPressure + 2)
          : Math.max(30, prev.freshwaterPressure - 0.1),
        
        // Climate drift
        cabinTemp: prev.ac1On || prev.ac2On
          ? Math.max(18, prev.cabinTemp - 0.01)
          : Math.min(32, prev.cabinTemp + 0.005),
        cabinHumidity: Math.max(40, Math.min(80, prev.cabinHumidity + (Math.random() - 0.5) * 0.3)),
        ac1Amps: prev.ac1On ? Math.max(10, Math.min(15, prev.ac1Amps + (Math.random() - 0.5) * 0.5)) : 0,
        ac2Amps: prev.ac2On ? Math.max(10, Math.min(15, prev.ac2Amps + (Math.random() - 0.5) * 0.5)) : 0,
        fridgeTemp: Math.max(1, Math.min(6, prev.fridgeTemp + (Math.random() - 0.5) * 0.1)),
        freezerTemp: Math.max(-22, Math.min(-15, prev.freezerTemp + (Math.random() - 0.5) * 0.1)),
        
        // Hot water temp drift
        hotWaterTemp: prev.hotWaterOn 
          ? Math.min(60, Math.max(45, prev.hotWaterTemp + (Math.random() - 0.5) * 0.5))
          : Math.max(20, prev.hotWaterTemp - 0.1),
        
        // Shore power varies slightly
        shoreAmps: prev.shorePower 
          ? Math.max(5, Math.min(50, prev.shoreAmps + (Math.random() - 0.5) * 2))
          : 0,
        shoreVolts: prev.shorePower
          ? Math.max(115, Math.min(125, prev.shoreVolts + (Math.random() - 0.5) * 0.5))
          : 0,
        
        // Inverter load varies
        inverterLoad: prev.inverterOn 
          ? Math.max(100, Math.min(prev.inverterCapacity * 0.9, prev.inverterLoad + (Math.random() - 0.5) * 50))
          : 0,
        
        // Generator
        generatorLoad: prev.generatorOn
          ? Math.max(500, Math.min(prev.generatorCapacity * 0.8, prev.generatorLoad + (Math.random() - 0.5) * 100))
          : 0,
        generatorHours: prev.generatorOn ? prev.generatorHours + 0.00001 : prev.generatorHours,
        
        // AIS targets vary
        aisTargets: Math.max(0, Math.min(25, Math.round(prev.aisTargets + (Math.random() - 0.5) * 0.5))),
      }));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Live Signal K overlay (preload bridge): measured values stream over the
  // sim baseline as they arrive. Fields with no SK path stay simulated.
  useEffect(() => {
    const SK = window.meridian && window.meridian.signalk;
    if (!SK) return;
    const MAP = {
      'environment.wind.speedTrue': v => ({ windSpeed: v }),
      'environment.wind.directionTrue': v => ({ windAngle: v }),
      'navigation.headingTrue': v => ({ heading: v }),
      'navigation.courseOverGroundTrue': v => ({ cog: v }),
      'navigation.speedOverGround': v => ({ sog: v }),
      'environment.depth.belowTransducer': v => ({ depth: v }),
      'environment.water.temperature': v => ({ waterTemp: v }),
    };
    const off = SK.onEvent(ev => {
      if (ev.type !== 'delta') return;
      if (ev.path === 'navigation.position' && ev.si) { setData(p => ({ ...p, lat: ev.si.latitude, lon: ev.si.longitude })); return; }
      const m = MAP[ev.path];
      const val = ev.display != null ? ev.display : ev.si;
      if (m && val != null) setData(p => ({ ...p, ...m(val) }));
    });
    return off;
  }, []);

  return (
    <ShipDataContext.Provider value={{ data, setData }}>
      {children}
    </ShipDataContext.Provider>
  );
};

// Draggable wrapper
const Draggable = ({ children, initialX = 20, initialY = 20, zIndex = 100, onFocus }) => {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    if (onFocus) onFocus(); // Bring to front when clicked
    if (e.target.closest('[data-no-drag]')) return;
    setDragging(true);
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  return (
    <div onMouseDown={onMouseDown} style={{ position: 'fixed', left: pos.x, top: pos.y, cursor: dragging ? 'grabbing' : 'grab', zIndex }}>
      {children}
    </div>
  );
};

// Widget wrapper with header
const WidgetFrame = ({ title, onClose, code, description, color = '#22c55e', width = '220px', children }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  
  const handleCopyCode = () => {
    let copyText;
    if (code) {
      // Custom tool - copy the actual code
      copyText = `// Meridian Terminal Widget: ${title}
// ${description || ''}

const ${title.replace(/[^a-zA-Z0-9]/g, '')}Widget = ${code}

export default ${title.replace(/[^a-zA-Z0-9]/g, '')}Widget;
`;
    } else {
      // Built-in tool
      copyText = `// Meridian Terminal Built-in Widget: ${title}
// This is a built-in widget. Source code is part of the main terminal.
//
// Description: ${description || 'No description available.'}
//
// To customize, create a new widget with: make a ${title.toLowerCase()} widget
`;
    }
    navigator.clipboard.writeText(copyText);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1500);
    setShowMenu(false);
  };
  
  return (
    <div style={{
      width: width, background: '#0a0a0a', border: `2px solid ${color}`, borderRadius: '8px',
      fontFamily: '"JetBrains Mono", monospace', boxShadow: `0 0 30px ${color}33`, userSelect: 'none',
      position: 'relative',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: `1px solid ${color}33`, color, fontSize: '11px', letterSpacing: '1px',
      }}>
        <span 
          data-no-drag 
          onClick={() => setShowMenu(!showMenu)} 
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          ⠿ {title} <span style={{ fontSize: '8px', opacity: 0.5 }}>▼</span>
        </span>
        <span data-no-drag onClick={onClose} style={{ cursor: 'pointer', fontSize: '14px' }}>✕</span>
      </div>
      
      {/* Dropdown menu - positioned below header */}
      {showMenu && (
        <>
          <div 
            style={{ position: 'fixed', inset: 0, zIndex: 999 }} 
            onClick={() => setShowMenu(false)} 
          />
          <div 
            data-no-drag
            style={{
              position: 'absolute', top: '36px', left: -1, right: -1,
              background: '#111', border: `1px solid ${color}66`,
              zIndex: 1000,
              fontSize: '11px',
              borderRadius: '0 0 4px 4px',
            }}
          >
            <div 
              onClick={() => { setShowAbout(!showAbout); setShowMenu(false); }}
              style={{ padding: '8px 12px', cursor: 'pointer', color, borderBottom: `1px solid ${color}22` }}
              onMouseEnter={e => e.target.style.background = '#1a1a1a'}
              onMouseLeave={e => e.target.style.background = 'transparent'}
            >
              ⓘ About
            </div>
            <div 
              onClick={handleCopyCode}
              style={{ padding: '8px 12px', cursor: 'pointer', color }}
              onMouseEnter={e => e.target.style.background = '#1a1a1a'}
              onMouseLeave={e => e.target.style.background = 'transparent'}
            >
              {codeCopied ? '✓ Copied!' : '⧉ Copy Code'}
            </div>
          </div>
        </>
      )}
      
      {/* About panel - shows below header when toggled */}
      {showAbout && (
        <div 
          data-no-drag
          style={{ 
            padding: '10px 12px', 
            borderBottom: `1px solid ${color}33`, 
            fontSize: '10px', 
            color: `${color}aa`, 
            lineHeight: 1.5,
            background: '#0f0f0f'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ flex: 1 }}>{description || 'No description available.'}</span>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <span 
                onClick={() => {
                  navigator.clipboard.writeText(description || '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }} 
                style={{ cursor: 'pointer', color: copied ? color : color, opacity: copied ? 1 : 0.5, fontSize: '9px' }}
                title="Copy to clipboard"
              >{copied ? 'COPIED!' : 'COPY'}</span>
              <span 
                onClick={() => setShowAbout(false)} 
                style={{ cursor: 'pointer', color, opacity: 0.5 }}
              >✕</span>
            </div>
          </div>
        </div>
      )}
      
      <div data-no-drag onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} style={{ padding: '12px' }}>{children}</div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

const CalculatorTool = ({ onClose }) => {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState(null);
  const [op, setOp] = useState(null);

  const input = (n) => setDisplay(d => d === '0' ? n : d + n);
  const clear = () => { setDisplay('0'); setPrev(null); setOp(null); };
  const doOp = (o) => { setPrev(parseFloat(display)); setOp(o); setDisplay('0'); };
  const equals = () => {
    if (prev === null || !op) return;
    const cur = parseFloat(display);
    const r = op === '+' ? prev + cur : op === '-' ? prev - cur : op === '*' ? prev * cur : op === '/' && cur !== 0 ? prev / cur : 0;
    setDisplay(String(r)); setPrev(null); setOp(null);
  };

  const Btn = ({ l, a, c = '#222' }) => (
    <button data-no-drag onClick={a} style={{ padding: '8px', fontSize: '14px', background: c, color: '#0f0', border: '1px solid #22c55e44', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}>{l}</button>
  );

  return (
    <WidgetFrame title="CALCULATOR" onClose={onClose} description="Basic calculator with add, subtract, multiply, and divide operations.">
      <div style={{ background: '#000', border: '1px solid #22c55e', padding: '8px', fontSize: '20px', textAlign: 'right', marginBottom: '8px', color: '#22c55e', fontFamily: 'monospace' }}>{display}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
        <Btn l="C" a={clear} c="#442222" /><Btn l="±" a={() => setDisplay(d => String(-parseFloat(d)))} /><Btn l="%" a={() => setDisplay(d => String(parseFloat(d)/100))} /><Btn l="÷" a={() => doOp('/')} c="#224422" />
        <Btn l="7" a={() => input('7')} /><Btn l="8" a={() => input('8')} /><Btn l="9" a={() => input('9')} /><Btn l="×" a={() => doOp('*')} c="#224422" />
        <Btn l="4" a={() => input('4')} /><Btn l="5" a={() => input('5')} /><Btn l="6" a={() => input('6')} /><Btn l="-" a={() => doOp('-')} c="#224422" />
        <Btn l="1" a={() => input('1')} /><Btn l="2" a={() => input('2')} /><Btn l="3" a={() => input('3')} /><Btn l="+" a={() => doOp('+')} c="#224422" />
        <Btn l="0" a={() => input('0')} /><Btn l="." a={() => input('.')} /><Btn l="=" a={equals} c="#224422" />
      </div>
    </WidgetFrame>
  );
};

// Sticky Note - unified color, large text area, play button for agent
// Random name generator for stickies
const generateStickyName = () => {
  const adjectives = ['red', 'blue', 'swift', 'calm', 'bright', 'dark', 'wild', 'soft', 'bold', 'quick', 'lazy', 'keen', 'warm', 'cool', 'fresh'];
  const nouns = ['porcupine', 'falcon', 'river', 'mountain', 'crystal', 'ember', 'breeze', 'storm', 'anchor', 'compass', 'harbor', 'beacon', 'tide', 'reef', 'helm'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}`;
};

const StickyTool = ({ onClose, color = '#87CEEB', name: initialName }) => {
  const [text, setText] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState({ width: 280, height: 200 });
  const [name, setName] = useState(initialName || generateStickyName());
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const nameInputRef = useRef(null);
  const resizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 280, height: 200 });
  
  // Darken color for text/icons
  const darken = (hex, factor = 0.4) => {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgb(${Math.floor(r*factor)}, ${Math.floor(g*factor)}, ${Math.floor(b*factor)})`;
  };
  
  const textColor = darken(color, 0.3);
  const iconColor = darken(color, 0.5);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  
  const startEditing = () => {
    setEditValue(name);
    setIsEditing(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };
  
  const finishEditing = () => {
    if (editValue.trim()) {
      setName(editValue.trim());
    }
    setIsEditing(false);
  };
  
  // Resize handlers
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { ...size };
    
    const handleResizeMove = (e) => {
      if (!resizing.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      setSize({
        width: Math.max(180, startSize.current.width + dx),
        height: Math.max(120, startSize.current.height + dy),
      });
    };
    
    const handleResizeEnd = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };
  
  return (
    <div style={{
      width: size.width,
      height: size.height,
      background: color,
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      fontFamily: '"Segoe UI", "Consolas", monospace',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Header bar - same color as body */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 10px',
        borderBottom: `1px solid ${darken(color, 0.7)}`,
        flexShrink: 0,
      }}>
        {isEditing ? (
          <input
            ref={nameInputRef}
            data-no-drag
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEditing();
              if (e.key === 'Escape') { setIsEditing(false); setEditValue(name); }
            }}
            style={{
              fontSize: '11px',
              fontWeight: 'bold',
              color: textColor,
              letterSpacing: '0.5px',
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${textColor}`,
              outline: 'none',
              padding: 0,
              width: '120px',
              fontFamily: 'inherit',
            }}
            autoFocus
          />
        ) : (
          <span 
            data-no-drag
            onClick={startEditing}
            style={{ 
              fontSize: '11px', 
              fontWeight: 'bold', 
              color: textColor,
              letterSpacing: '0.5px',
              cursor: 'text',
            }}
            title="Click to rename"
          >
            {name.toUpperCase()}
          </span>
        )}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Play/Pause button */}
          <span 
            data-no-drag
            onClick={() => setAgentRunning(!agentRunning)}
            style={{ 
              cursor: 'pointer', 
              fontSize: '12px',
              color: agentRunning ? '#cc0000' : iconColor,
              opacity: agentRunning ? 1 : 0.7,
            }}
            title={agentRunning ? 'Pause agent' : 'Run agent'}
          >
            {agentRunning ? '⏸' : '▶'}
          </span>
          {/* Close button - same as WidgetFrame */}
          <span 
            data-no-drag
            onClick={onClose}
            style={{ 
              cursor: 'pointer', 
              fontSize: '14px',
              color: textColor,
            }}
          >
            ✕
          </span>
        </div>
      </div>
      
      {/* Text area */}
      <div style={{ flex: 1, position: 'relative', padding: '8px', overflow: 'hidden' }}>
        <textarea
          data-no-drag
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your notes here..."
          style={{
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontSize: '14px',
            fontFamily: 'inherit',
            color: textColor,
            lineHeight: 1.5,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
        
        {/* Copy button - bottom left */}
        <span
          data-no-drag
          onClick={handleCopy}
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            color: copied ? textColor : iconColor,
            opacity: copied ? 1 : 0.6,
          }}
          title="Copy all text"
        >
          {copied ? '✓' : '⧉'}
        </span>
      </div>
      
      {/* Resize handle - bottom right */}
      <div
        data-no-drag
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: '2px',
          right: '2px',
          width: '16px',
          height: '16px',
          cursor: 'se-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          opacity: 0.5,
          fontSize: '10px',
          userSelect: 'none',
        }}
        title="Resize"
      >
        ◢
      </div>
    </div>
  );
};

const WindTool = ({ onClose, color = '#22c55e' }) => {
  const data = useShipData();
  const { windSpeed, windAngle } = data;

  const cardinal = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(windAngle / 22.5) % 16];

  return (
    <WidgetFrame title="TRUE WIND" onClose={onClose} color={color} description="Displays true wind speed and direction with a compass rose indicator. Shows wind in knots and cardinal direction.">
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', width: '140px', height: '140px', margin: '0 auto' }}>
          <svg viewBox="0 0 140 140" style={{ width: '100%', height: '100%' }}>
            <circle cx="70" cy="70" r="65" fill="none" stroke={color} strokeWidth="1" opacity="0.3" />
            <circle cx="70" cy="70" r="50" fill="none" stroke={color} strokeWidth="1" opacity="0.2" />
            {['N','E','S','W'].map((d, i) => {
              const a = (i * 90 - 90) * Math.PI / 180;
              return <text key={d} x={70 + 55 * Math.cos(a)} y={70 + 55 * Math.sin(a)} fill={color} fontSize="10" textAnchor="middle" dominantBaseline="middle" opacity="0.6">{d}</text>;
            })}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${windAngle}deg)`, transition: 'transform 0.2s' }}>
            <div style={{ position: 'absolute', top: '12px', width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderBottom: `40px solid ${color}`, filter: `drop-shadow(0 0 8px ${color})` }} />
          </div>
          <div style={{ position: 'absolute', inset: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color, fontSize: '28px', fontWeight: 'bold', fontFamily: 'monospace' }}>{windSpeed.toFixed(1)}</span>
            <span style={{ color, fontSize: '10px', opacity: 0.7 }}>KTS</span>
          </div>
        </div>
        <div style={{ marginTop: '12px', color, fontFamily: 'monospace', fontSize: '14px' }}>{Math.round(windAngle)}° {cardinal}</div>
      </div>
    </WidgetFrame>
  );
};

// Compass Rose - realistic liquid-filled marine compass
const CompassTool = ({ onClose }) => {
  const data = useShipData();
  const [displayHeading, setDisplayHeading] = useState(data.heading);
  
  // Damped compass movement (liquid effect)
  useEffect(() => {
    let animationId;
    const animate = () => {
      setDisplayHeading(prev => {
        let diff = data.heading - prev;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        return (prev + diff * 0.08 + 360) % 360;
      });
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [data.heading]);

  const cardinals = ['N', 'E', 'S', 'W'];
  const intercardinals = ['NE', 'SE', 'SW', 'NW'];

  return (
    <WidgetFrame title="COMPASS" onClose={onClose} width="320px" description="Traditional marine compass with liquid-damped card movement. Displays vessel heading with brass bezel, 8-point rose, and lubber line. Responds to heading changes with realistic damping.">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {/* Compass housing */}
        <div style={{ position: 'relative', width: 240, height: 240 }}>
          {/* Outer brass ring */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: 'linear-gradient(145deg, #d4a54a 0%, #8b6914 30%, #c9a227 50%, #8b6914 70%, #d4a54a 100%)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.3)',
          }} />
          
          {/* Inner shadow ring */}
          <div style={{
            position: 'absolute', inset: 7, borderRadius: '50%',
            background: 'linear-gradient(145deg, #1a1a1a, #0a0a0a)',
            boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.8)',
          }} />
          
          {/* Liquid chamber */}
          <div style={{
            position: 'absolute', inset: 10, borderRadius: '50%',
            background: 'radial-gradient(ellipse at 30% 30%, rgba(255,255,255,0.15) 0%, transparent 50%), linear-gradient(180deg, #1a2a1a 0%, #0d1a0d 50%, #0a140a 100%)',
            boxShadow: 'inset 0 0 30px rgba(0,50,0,0.3)',
            overflow: 'hidden',
          }}>
            {/* Compass card - rotates opposite to heading */}
            <div style={{
              position: 'absolute', inset: 12,
              transform: `rotate(${-displayHeading}deg)`,
            }}>
              <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }}>
                <circle cx="100" cy="100" r="95" fill="none" stroke="#c9a227" strokeWidth="1" opacity="0.4" />
                <circle cx="100" cy="100" r="85" fill="none" stroke="#c9a227" strokeWidth="0.5" opacity="0.3" />
                
                {/* Degree ticks */}
                {[...Array(72)].map((_, i) => {
                  const angle = i * 5;
                  const isMajor = angle % 30 === 0;
                  const isMid = angle % 10 === 0;
                  const len = isMajor ? 12 : isMid ? 8 : 4;
                  const r1 = 95, r2 = r1 - len;
                  const rad = (angle - 90) * Math.PI / 180;
                  return <line key={i} x1={100 + r1 * Math.cos(rad)} y1={100 + r1 * Math.sin(rad)} x2={100 + r2 * Math.cos(rad)} y2={100 + r2 * Math.sin(rad)} stroke={isMajor ? '#c9a227' : '#667744'} strokeWidth={isMajor ? 2 : 1} />;
                })}
                
                {/* 8-point star */}
                <polygon points="100,15 106,85 100,100 94,85" fill="#c9a227" />
                <polygon points="100,15 94,85 100,100 106,85" fill="#8b6914" />
                <polygon points="185,100 115,94 100,100 115,106" fill="#c9a227" />
                <polygon points="185,100 115,106 100,100 115,94" fill="#8b6914" />
                <polygon points="100,185 94,115 100,100 106,115" fill="#667744" />
                <polygon points="100,185 106,115 100,100 94,115" fill="#445533" />
                <polygon points="15,100 85,106 100,100 85,94" fill="#667744" />
                <polygon points="15,100 85,94 100,100 85,106" fill="#445533" />
                
                {/* Intercardinal points */}
                {[45, 135, 225, 315].map((angle, i) => {
                  const rad = (angle - 90) * Math.PI / 180;
                  const tipX = 100 + 55 * Math.cos(rad), tipY = 100 + 55 * Math.sin(rad);
                  const rad1 = (angle - 102) * Math.PI / 180, rad2 = (angle - 78) * Math.PI / 180;
                  const b1X = 100 + 25 * Math.cos(rad1), b1Y = 100 + 25 * Math.sin(rad1);
                  const b2X = 100 + 25 * Math.cos(rad2), b2Y = 100 + 25 * Math.sin(rad2);
                  return <polygon key={angle} points={`${tipX},${tipY} ${b1X},${b1Y} 100,100 ${b2X},${b2Y}`} fill={i < 2 ? '#556644' : '#445533'} />;
                })}
                
                {/* Center cap */}
                <circle cx="100" cy="100" r="8" fill="url(#compassCenterGrad)" />
                <circle cx="100" cy="100" r="4" fill="#c9a227" />
                
                {/* Cardinal labels */}
                {cardinals.map((dir, i) => {
                  const rad = (i * 90 - 90) * Math.PI / 180;
                  return <text key={dir} x={100 + 72 * Math.cos(rad)} y={100 + 72 * Math.sin(rad)} fill={dir === 'N' ? '#c9a227' : '#889977'} fontSize={dir === 'N' ? '16' : '12'} fontWeight="bold" textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Georgia, serif' }}>{dir}</text>;
                })}
                
                {/* Intercardinal labels */}
                {intercardinals.map((dir, i) => {
                  const rad = (i * 90 + 45 - 90) * Math.PI / 180;
                  return <text key={dir} x={100 + 68 * Math.cos(rad)} y={100 + 68 * Math.sin(rad)} fill="#667755" fontSize="9" textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Georgia, serif' }}>{dir}</text>;
                })}
                
                <defs>
                  <radialGradient id="compassCenterGrad">
                    <stop offset="0%" stopColor="#d4a54a" />
                    <stop offset="100%" stopColor="#8b6914" />
                  </radialGradient>
                </defs>
              </svg>
            </div>
          </div>
          
          {/* Glass dome highlight */}
          <div style={{
            position: 'absolute', inset: 10, borderRadius: '50%',
            background: 'radial-gradient(ellipse at 35% 25%, rgba(255,255,255,0.25) 0%, transparent 40%)',
            pointerEvents: 'none',
          }} />
          
          {/* Lubber line */}
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            width: 4, height: 18, background: '#ff3333',
            boxShadow: '0 0 4px rgba(255,0,0,0.5)',
            borderRadius: '0 0 2px 2px',
          }} />
        </div>
        
        {/* Heading readout */}
        <div style={{
          background: '#111',
          border: '1px solid #22c55e44',
          borderRadius: 4,
          padding: '6px 20px',
        }}>
          <span style={{ fontSize: 24, fontFamily: 'monospace', color: '#22c55e', textShadow: '0 0 10px rgba(34,197,94,0.5)' }}>
            {Math.round(displayHeading).toString().padStart(3, '0')}°
          </span>
        </div>
      </div>
    </WidgetFrame>
  );
};

// Data Source Widget - shows all NMEA data streams in 3 columns
const DataSourceTool = ({ onClose }) => {
  const data = useShipData();
  
  const Section = ({ title, children }) => (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ color: '#22c55e88', fontSize: '9px', marginBottom: '4px', letterSpacing: '1px', borderBottom: '1px solid #22c55e33', paddingBottom: '2px' }}>{title}</div>
      {children}
    </div>
  );
  
  const Row = ({ label, value, unit }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '10px' }}>
      <span style={{ color: '#22c55e88' }}>{label}</span>
      <span style={{ color: '#22c55e', fontFamily: 'monospace' }}>{value}<span style={{ opacity: 0.5, marginLeft: '2px' }}>{unit}</span></span>
    </div>
  );

  return (
    <WidgetFrame title="NMEA DATA" onClose={onClose} width="780px" description="Complete NMEA 2000 data stream display. Shows all ship systems: navigation, batteries, tanks, climate, pumps, lighting, safety, and communications. Real-time sensor data in 4-column layout.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', fontSize: '10px', color: '#22c55e' }}>
        
        {/* Column 1 - Nav & Propulsion */}
        <div>
          <Section title="WIND">
            <Row label="Speed" value={data.windSpeed.toFixed(1)} unit="kts" />
            <Row label="Angle" value={Math.round(data.windAngle)} unit="°T" />
            <Row label="Gust" value={data.windGust.toFixed(1)} unit="kts" />
          </Section>
          
          <Section title="NAV">
            <Row label="Heading" value={Math.round(data.heading)} unit="°T" />
            <Row label="COG" value={Math.round(data.cog)} unit="°T" />
            <Row label="SOG" value={data.sog.toFixed(1)} unit="kts" />
          </Section>
          
          <Section title="POSITION">
            <Row label="LAT" value={data.lat.toFixed(4)} unit="°N" />
            <Row label="LON" value={Math.abs(data.lon).toFixed(4)} unit="°W" />
            <Row label="GPS" value={data.gpsStatus} unit={`${data.satellites}sat`} />
          </Section>
          
          <Section title="DEPTH">
            <Row label="Depth" value={data.depth.toFixed(1)} unit="m" />
            <Row label="Water" value={data.waterTemp.toFixed(1)} unit="°C" />
          </Section>
          
          <Section title="WAVES">
            <Row label="Height" value={data.waveHeight.toFixed(1)} unit="m" />
            <Row label="Period" value={data.wavePeriod.toFixed(1)} unit="s" />
          </Section>
          
          <Section title="ENGINE">
            <Row label="RPM" value={Math.round(data.rpm)} unit="" />
            <Row label="Fuel Rate" value={data.fuelRate.toFixed(1)} unit="L/h" />
          </Section>
          
          <Section title="E-MOTOR (100HP)">
            <Row label="Status" value={data.motorOn ? (data.motorDirection || 'NEUTRAL') : 'OFF'} unit="" />
            <Row label="Throttle" value={(data.motorThrottle || 0).toFixed(0)} unit="%" />
            <Row label="Power" value={(data.motorPower || 0).toFixed(1)} unit={`/${data.motorMaxPower || 75}kW`} />
            <Row label="Current" value={(data.motorAmps || 0).toFixed(0)} unit={`/${data.motorMaxAmps || 400}A`} />
          </Section>
        </div>
        
        {/* Column 2 - Electrical */}
        <div>
          <Section title="BATTERY A (48V)">
            <Row label="Voltage" value={data.batteryAVoltage.toFixed(1)} unit="V" />
            <Row label="Current" value={data.batteryAAmps.toFixed(1)} unit="A" />
            <Row label="SOC" value={data.batteryASoc.toFixed(0)} unit="%" />
            <Row label="Solar" value={data.solarAWatts.toFixed(0)} unit="W" />
          </Section>
          
          <Section title="BATTERY B (48V)">
            <Row label="Voltage" value={data.batteryBVoltage.toFixed(1)} unit="V" />
            <Row label="Current" value={data.batteryBAmps.toFixed(1)} unit="A" />
            <Row label="SOC" value={data.batteryBSoc.toFixed(0)} unit="%" />
            <Row label="Solar" value={data.solarBWatts.toFixed(0)} unit="W" />
          </Section>
          
          <Section title="SHORE POWER">
            <Row label="Status" value={data.shorePower ? 'CONNECTED' : 'OFF'} unit="" />
            <Row label="Voltage" value={(data.shoreVolts || 0).toFixed(0)} unit="V" />
            <Row label="Current" value={(data.shoreAmps || 0).toFixed(1)} unit="A" />
          </Section>
          
          <Section title="INVERTER">
            <Row label="Status" value={data.inverterOn ? 'ON' : 'OFF'} unit="" />
            <Row label="Load" value={(data.inverterLoad || 0).toFixed(0)} unit={`/${data.inverterCapacity}W`} />
          </Section>
          
          <Section title="GENERATOR">
            <Row label="Status" value={data.generatorOn ? 'RUN' : 'STOP'} unit="" />
            <Row label="Hours" value={(data.generatorHours || 0).toFixed(0)} unit="h" />
            <Row label="Load" value={(data.generatorLoad || 0).toFixed(0)} unit={`/${data.generatorCapacity}W`} />
          </Section>
        </div>
        
        {/* Column 3 - Tanks & Climate */}
        <div>
          <Section title="FUEL (300L)">
            <Row label="Tank 1" value={data.fuel1Level.toFixed(0)} unit={`L ${(data.fuel1Level/data.fuel1Capacity*100).toFixed(0)}%`} />
            <Row label="Tank 2" value={data.fuel2Level.toFixed(0)} unit={`L ${(data.fuel2Level/data.fuel2Capacity*100).toFixed(0)}%`} />
          </Section>
          
          <Section title="WATER (500L)">
            <Row label="Tank 1" value={data.water1Level.toFixed(0)} unit={`L ${(data.water1Level/data.water1Capacity*100).toFixed(0)}%`} />
            <Row label="Tank 2" value={data.water2Level.toFixed(0)} unit={`L ${(data.water2Level/data.water2Capacity*100).toFixed(0)}%`} />
          </Section>
          
          <Section title="WASTE">
            <Row label="Gray" value={(data.grayWaterLevel || 0).toFixed(0)} unit={`L ${((data.grayWaterLevel || 0)/(data.grayWaterCapacity || 1)*100).toFixed(0)}%`} />
            <Row label="Black" value={(data.blackWaterLevel || 0).toFixed(0)} unit={`L ${((data.blackWaterLevel || 0)/(data.blackWaterCapacity || 1)*100).toFixed(0)}%`} />
          </Section>
          
          <Section title="CLIMATE">
            <Row label="Cabin" value={(data.cabinTemp || 0).toFixed(1)} unit={`°C ${(data.cabinHumidity || 0).toFixed(0)}%`} />
            <Row label="A/C 1" value={data.ac1On ? 'ON' : 'OFF'} unit={`${(data.ac1Amps || 0).toFixed(1)}A`} />
            <Row label="A/C 2" value={data.ac2On ? 'ON' : 'OFF'} unit={`${(data.ac2Amps || 0).toFixed(1)}A`} />
            <Row label="Fridge" value={(data.fridgeTemp || 0).toFixed(1)} unit="°C" />
            <Row label="Freezer" value={(data.freezerTemp || 0).toFixed(1)} unit="°C" />
          </Section>
          
          <Section title="HOT WATER & LPG">
            <Row label="H/W" value={data.hotWaterOn ? 'ON' : 'OFF'} unit={`${(data.hotWaterTemp || 0).toFixed(0)}°C`} />
            <Row label="LPG Tank" value={(data.lpgLevel || 0).toFixed(0)} unit="%" />
            <Row label="LPG Valve" value={data.lpgValve || 'CLOSED'} unit="" />
          </Section>
        </div>
        
        {/* Column 4 - Systems & Safety */}
        <div>
          <Section title="AUTOPILOT">
            <Row label="Status" value={data.apEngaged ? 'ENGAGED' : 'STANDBY'} unit="" />
            <Row label="Mode" value={data.apMode} unit="" />
            <Row label="Target" value={Math.round(data.apTargetHeading)} unit="°" />
            <Row label="Rudder" value={data.apRudderActual.toFixed(1)} unit="°" />
          </Section>
          
          <Section title="ANCHOR">
            <Row label="Rode" value={(data.rodeOut || 0).toFixed(1)} unit={`/${data.rodeTotal || 100}m`} />
            <Row label="Windlass" value={data.windlassDirection || 'STOP'} unit={`${(data.windlassAmps || 0).toFixed(0)}A`} />
          </Section>
          
          <Section title="LIGHTS">
            <Row label="Anchor" value={data.anchorLight ? 'ON' : 'OFF'} unit="" />
            <Row label="Steaming" value={data.steamingLight ? 'ON' : 'OFF'} unit="" />
            <Row label="Nav" value={data.navLightsPort && data.navLightsStbd ? 'ON' : 'OFF'} unit="" />
            <Row label="Deck" value={data.deckLights ? 'ON' : 'OFF'} unit="" />
          </Section>
          
          <Section title="BILGE PUMPS">
            <Row label="Fwd" value={data.bilgeFwdOn ? 'RUN' : 'OK'} unit={`${data.bilgeFwdCycles}x ${Math.round(data.bilgeFwdLast)}m`} />
            <Row label="Mid" value={data.bilgeMidOn ? 'RUN' : 'OK'} unit={`${data.bilgeMidCycles}x ${Math.round(data.bilgeMidLast)}m`} />
            <Row label="Aft" value={data.bilgeAftOn ? 'RUN' : 'OK'} unit={`${data.bilgeAftCycles}x ${Math.round(data.bilgeAftLast)}m`} />
          </Section>
          
          <Section title="SAFETY">
            <Row label="LPG Det" value={data.lpgDetector || 'OK'} unit="" />
            <Row label="CO Det" value={data.coDetector || 'OK'} unit="" />
            <Row label="EPIRB" value={data.epirbArmed ? 'ARMED' : 'OFF'} unit={`${data.epirbBattery}%`} />
            <Row label="MOB" value={data.mobStatus || 'CLEAR'} unit="" />
          </Section>
          
          <Section title="COMMS">
            <Row label="AIS" value={data.aisStatus || 'TX/RX'} unit={`${data.aisTargets} tgt`} />
            <Row label="VHF" value={data.vhfOn ? 'ON' : 'OFF'} unit={`CH${data.vhfChannel}`} />
          </Section>
        </div>
        
      </div>
    </WidgetFrame>
  );
};

// Chart Plotter - SVG atoll with boat position, north-up/course-up toggle
const ChartTool = ({ onClose, color = '#22c55e' }) => {
  const data = useShipData();
  const [northUp, setNorthUp] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 380, height: 380 });
  const resizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 380, height: 380 });
  
  // Boat position - mock position inside lagoon
  const boatX = 50 + Math.sin(Date.now() / 50000) * 5; // slight drift
  const boatY = 50 + Math.cos(Date.now() / 60000) * 3;
  const heading = data.heading || 0;
  
  // View rotation
  const viewRotation = northUp ? 0 : -heading;
  
  // Atoll shape - Tikehau-style with 2 passes (west and northwest)
  const atollPath = `
    M 50,8 
    C 75,8 92,20 95,35
    C 98,50 95,70 88,82
    C 78,95 60,98 45,96
    C 30,94 15,85 8,70
    C 2,55 5,35 15,22
    C 25,10 40,8 50,8
    Z
  `;
  
  // Inner lagoon
  const lagoonPath = `
    M 50,18
    C 70,18 82,28 85,40
    C 88,52 85,68 78,78
    C 68,88 55,90 45,88
    C 32,86 22,78 18,65
    C 14,52 17,35 25,25
    C 33,18 42,18 50,18
    Z
  `;
  
  // Two passes - gaps in the reef
  const westPass = { x: 8, y: 52, width: 12, angle: -10 };
  const nwPass = { x: 20, y: 22, width: 10, angle: 35 };
  
  // Resize handlers
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSize.current = { ...size };
    
    const handleResizeMove = (e) => {
      if (!resizing.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      const delta = Math.max(dx, dy);
      const newSize = Math.max(280, Math.min(600, startSize.current.width + delta));
      setSize({ width: newSize, height: newSize });
    };
    
    const handleResizeEnd = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };
  
  const chartSize = Math.min(size.width, size.height) - 80;

  return (
    <WidgetFrame title="CHART" onClose={onClose} width={`${size.width}px`} description="Chart plotter showing Tikehau Atoll. Toggle between north-up and course-up views. Zoom to adjust scale. Shows vessel position and heading.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        
        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              data-no-drag
              onClick={() => setNorthUp(!northUp)}
              style={{
                background: northUp ? color : 'transparent',
                color: northUp ? '#000' : color,
                border: `1px solid ${color}`,
                padding: '4px 8px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '10px',
                fontFamily: 'monospace',
              }}
            >
              {northUp ? 'NORTH UP' : 'COURSE UP'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <button 
              data-no-drag
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              style={{ background: 'transparent', color, border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontFamily: 'monospace' }}
            >−</button>
            <span style={{ color, minWidth: '45px', textAlign: 'center' }}>{(zoom * 100).toFixed(0)}%</span>
            <button 
              data-no-drag
              onClick={() => setZoom(z => Math.min(2, z + 0.25))}
              style={{ background: 'transparent', color, border: `1px solid ${color}44`, padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontFamily: 'monospace' }}
            >+</button>
          </div>
        </div>
        
        {/* Chart area */}
        <div style={{ 
          width: chartSize, 
          height: chartSize, 
          background: '#0a1628', 
          borderRadius: '4px', 
          border: `1px solid ${color}44`,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <svg 
            viewBox="0 0 100 100" 
            style={{ 
              width: '100%', 
              height: '100%',
              transform: `scale(${zoom}) rotate(${viewRotation}deg)`,
              transformOrigin: `${boatX}% ${boatY}%`,
              transition: 'transform 0.3s ease-out',
            }}
          >
            {/* Water */}
            <rect x="0" y="0" width="100" height="100" fill="#0a1628" />
            
            {/* Grid lines */}
            {[...Array(11)].map((_, i) => (
              <g key={i} opacity="0.15">
                <line x1={i * 10} y1="0" x2={i * 10} y2="100" stroke={color} strokeWidth="0.2" />
                <line x1="0" y1={i * 10} x2="100" y2={i * 10} stroke={color} strokeWidth="0.2" />
              </g>
            ))}
            
            {/* Depth shading - deeper in center */}
            <defs>
              <radialGradient id="lagoonDepth" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#0a2040" />
                <stop offset="100%" stopColor="#0a1628" />
              </radialGradient>
              <radialGradient id="oceanDepth" cx="50%" cy="50%" r="70%">
                <stop offset="60%" stopColor="#0a1628" />
                <stop offset="100%" stopColor="#061020" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="100" height="100" fill="url(#oceanDepth)" />
            
            {/* Lagoon water */}
            <path d={lagoonPath} fill="url(#lagoonDepth)" />
            
            {/* Reef/land ring */}
            <path d={atollPath} fill="none" stroke="#3d6b4f" strokeWidth="8" opacity="0.6" />
            <path d={atollPath} fill="none" stroke="#4a7a5a" strokeWidth="5" opacity="0.7" />
            <path d={atollPath} fill="none" stroke="#5a8a6a" strokeWidth="2" />
            
            {/* Motu (small islands on reef) */}
            <ellipse cx="50" cy="10" rx="8" ry="3" fill="#3d5a3d" />
            <ellipse cx="75" cy="18" rx="6" ry="2.5" fill="#3d5a3d" />
            <ellipse cx="90" cy="40" rx="3" ry="6" fill="#3d5a3d" />
            <ellipse cx="88" cy="65" rx="3" ry="5" fill="#3d5a3d" />
            <ellipse cx="70" cy="92" rx="7" ry="2.5" fill="#3d5a3d" />
            <ellipse cx="40" cy="94" rx="8" ry="3" fill="#3d5a3d" />
            <ellipse cx="55" cy="12" rx="4" ry="2" fill="#4a6a4a" />
            
            {/* West Pass - channel through reef */}
            <rect x="4" y="48" width="14" height="8" fill="#0a1628" />
            <line x1="4" y1="48" x2="18" y2="48" stroke="#00aaff" strokeWidth="0.5" strokeDasharray="2,1" />
            <line x1="4" y1="56" x2="18" y2="56" stroke="#00aaff" strokeWidth="0.5" strokeDasharray="2,1" />
            <text x="11" y="46" fill="#00aaff" fontSize="3" textAnchor="middle" opacity="0.8">WEST PASS</text>
            
            {/* NW Pass - channel through reef */}
            <g transform="rotate(35, 22, 24)">
              <rect x="12" y="21" width="12" height="6" fill="#0a1628" />
              <line x1="12" y1="21" x2="24" y2="21" stroke="#00aaff" strokeWidth="0.5" strokeDasharray="2,1" />
              <line x1="12" y1="27" x2="24" y2="27" stroke="#00aaff" strokeWidth="0.5" strokeDasharray="2,1" />
            </g>
            <text x="15" y="18" fill="#00aaff" fontSize="3" textAnchor="middle" opacity="0.8">NW PASS</text>
            
            {/* Depth soundings */}
            <text x="50" y="50" fill="#4488aa" fontSize="3" textAnchor="middle" opacity="0.6">25m</text>
            <text x="35" y="60" fill="#4488aa" fontSize="2.5" textAnchor="middle" opacity="0.5">18m</text>
            <text x="65" y="45" fill="#4488aa" fontSize="2.5" textAnchor="middle" opacity="0.5">22m</text>
            <text x="50" y="70" fill="#4488aa" fontSize="2.5" textAnchor="middle" opacity="0.5">15m</text>
            
            {/* Anchorage symbol */}
            <g transform="translate(60, 65)">
              <circle r="3" fill="none" stroke="#aa88ff" strokeWidth="0.4" opacity="0.6" />
              <text y="1" fill="#aa88ff" fontSize="3" textAnchor="middle" opacity="0.8">⚓</text>
            </g>
            <text x="60" y="72" fill="#aa88ff" fontSize="2" textAnchor="middle" opacity="0.6">ANCHORAGE</text>
            
            {/* Scale bar */}
            <g transform={`rotate(${-viewRotation}, 85, 92)`}>
              <line x1="75" y1="92" x2="95" y2="92" stroke={color} strokeWidth="0.5" />
              <line x1="75" y1="91" x2="75" y2="93" stroke={color} strokeWidth="0.5" />
              <line x1="95" y1="91" x2="95" y2="93" stroke={color} strokeWidth="0.5" />
              <text x="85" y="96" fill={color} fontSize="2.5" textAnchor="middle" opacity="0.7">1 nm</text>
            </g>
            
            {/* Compass rose */}
            <g transform={`translate(88, 12) rotate(${-viewRotation})`}>
              <circle r="6" fill="#0a1628" stroke={color} strokeWidth="0.3" opacity="0.5" />
              <polygon points="0,-5 1,-1 0,0 -1,-1" fill={color} />
              <polygon points="0,5 1,1 0,0 -1,1" fill={color} opacity="0.3" />
              <text y="-6" fill={color} fontSize="2" textAnchor="middle">N</text>
            </g>
            
            {/* Boat */}
            <g transform={`translate(${boatX}, ${boatY}) rotate(${northUp ? heading : 0})`}>
              {/* Heading line */}
              <line x1="0" y1="0" x2="0" y2="-12" stroke={color} strokeWidth="0.3" opacity="0.5" strokeDasharray="1,1" />
              
              {/* COG vector */}
              <line x1="0" y1="0" x2="0" y2="-8" stroke="#ffaa00" strokeWidth="0.5" opacity="0.7" />
              
              {/* Boat shape */}
              <polygon points="0,-2.5 1.5,2 0,1.2 -1.5,2" fill={color} stroke={color} strokeWidth="0.3" />
              
              {/* Position circle */}
              <circle r="0.8" fill="#fff" opacity="0.9" />
            </g>
            
            {/* Atoll name */}
            <text x="50" y="5" fill={color} fontSize="3" textAnchor="middle" fontWeight="bold" opacity="0.8">TIKEHAU ATOLL</text>
            <text x="50" y="8" fill={color} fontSize="2" textAnchor="middle" opacity="0.5">14°55'S 148°10'W</text>
          </svg>
          
          {/* North indicator overlay (when in course-up mode) */}
          {!northUp && (
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)',
              border: `1px solid ${color}44`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg viewBox="0 0 24 24" style={{ width: '16px', height: '16px', transform: `rotate(${heading}deg)` }}>
                <polygon points="12,4 14,12 12,10 10,12" fill={color} />
                <text x="12" y="20" fill={color} fontSize="6" textAnchor="middle">N</text>
              </svg>
            </div>
          )}
        </div>
        
        {/* Position readout */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color, opacity: 0.8, fontFamily: 'monospace' }}>
          <span>LAT 14°55.23'S</span>
          <span>LON 148°10.45'W</span>
          <span>HDG {heading.toFixed(0).padStart(3, '0')}°</span>
          <span>SOG {(data.sog || 0).toFixed(1)}kn</span>
        </div>
        
      </div>
      
      {/* Resize handle */}
      <div
        data-no-drag
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          bottom: '2px',
          right: '2px',
          width: '16px',
          height: '16px',
          cursor: 'se-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          opacity: 0.3,
          fontSize: '10px',
        }}
      >◢</div>
    </WidgetFrame>
  );
};

// NMEA 2000 Reference - comprehensive PGN list
const NMEAReferenceTool = ({ onClose, color = '#22c55e' }) => {
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('all');
  
  const nmeaData = [
    // Navigation
    { pgn: '127250', name: 'Vessel Heading', cat: 'nav', fields: 'heading, deviation, variation, reference', example: '247.3°T' },
    { pgn: '127251', name: 'Rate of Turn', cat: 'nav', fields: 'rate', example: '2.5°/s' },
    { pgn: '127257', name: 'Attitude', cat: 'nav', fields: 'yaw, pitch, roll', example: 'P: 2.1° R: -1.3°' },
    { pgn: '127258', name: 'Magnetic Variation', cat: 'nav', fields: 'source, variation', example: '14.2°E' },
    { pgn: '128259', name: 'Speed', cat: 'nav', fields: 'waterRef, groundRef, stwRef', example: '6.8 kn' },
    { pgn: '128267', name: 'Water Depth', cat: 'nav', fields: 'depth, offset, range', example: '12.4 m' },
    { pgn: '128275', name: 'Distance Log', cat: 'nav', fields: 'log, tripLog', example: '1247.3 nm' },
    { pgn: '129025', name: 'Position Rapid', cat: 'nav', fields: 'latitude, longitude', example: '14°55.2\'S 148°10.4\'W' },
    { pgn: '129026', name: 'COG/SOG Rapid', cat: 'nav', fields: 'cog, sog, cogRef', example: 'COG 245° SOG 6.2kn' },
    { pgn: '129029', name: 'GNSS Position', cat: 'nav', fields: 'lat, lon, alt, type, method, nSats, hdop, pdop, geoidalSep', example: '12 sats HDOP 0.9' },
    { pgn: '129033', name: 'Time & Date', cat: 'nav', fields: 'date, time, localOffset', example: '2025-01-15 14:32:00Z' },
    { pgn: '129038', name: 'AIS Class A Position', cat: 'nav', fields: 'mmsi, lat, lon, cog, sog, heading, rateOfTurn, navStatus', example: 'MMSI 123456789' },
    { pgn: '129039', name: 'AIS Class B Position', cat: 'nav', fields: 'mmsi, lat, lon, cog, sog, heading, unit, display, dsc, band, msg22, assigned, raim', example: 'Class B target' },
    { pgn: '129040', name: 'AIS Class B Extended', cat: 'nav', fields: 'mmsi, lat, lon, cog, sog, heading, name, shipType, length, beam', example: 'MV EXAMPLE' },
    { pgn: '129041', name: 'AIS Aids to Navigation', cat: 'nav', fields: 'mmsi, name, lat, lon, type, offPos, virtualAid', example: 'BUOY A-14' },
    { pgn: '129283', name: 'Cross Track Error', cat: 'nav', fields: 'xteMode, navTerm, xte', example: '0.12 nm' },
    { pgn: '129284', name: 'Navigation Data', cat: 'nav', fields: 'distToWpt, cogRef, cog, bearingRef, bearingOrig, bearingPos, wptClosingVel, eta, etaDate, wptLat, wptLon', example: 'DTW 4.2nm ETA 14:45' },
    { pgn: '129285', name: 'Route/WP Information', cat: 'nav', fields: 'startRps, items, dbId, routeId, navDir, routeName', example: 'Route: HOME-ANCHORAGE' },
    { pgn: '129539', name: 'GNSS DOPs', cat: 'nav', fields: 'desiredMode, actualMode, hdop, vdop, tdop', example: 'HDOP 1.2 VDOP 1.8' },
    { pgn: '129540', name: 'GNSS Satellites', cat: 'nav', fields: 'seqId, sats[]', example: '12 in view, 9 used' },
    
    // Wind
    { pgn: '130306', name: 'Wind Data', cat: 'wind', fields: 'windSpeed, windAngle, reference', example: 'TWS 18kn TWA 045°' },
    
    // Environment
    { pgn: '130310', name: 'Env Parameters', cat: 'env', fields: 'waterTemp, outsideTemp, pressure', example: '24.2°C 1013mb' },
    { pgn: '130311', name: 'Env Parameters Ext', cat: 'env', fields: 'tempSource, humidity, temp, pressure', example: '65% RH' },
    { pgn: '130312', name: 'Temperature', cat: 'env', fields: 'tempInstance, tempSource, actualTemp', example: 'Sea: 26.1°C' },
    { pgn: '130313', name: 'Humidity', cat: 'env', fields: 'humidInstance, humidSource, actualHumidity', example: 'Cabin: 58%' },
    { pgn: '130314', name: 'Pressure', cat: 'env', fields: 'pressInstance, pressSource, pressure', example: '1018.2 mb' },
    { pgn: '130316', name: 'Temp Extended', cat: 'env', fields: 'tempInstance, tempSource, temp, setTemp', example: 'Fridge: 4.2°C' },
    
    // Engine
    { pgn: '127488', name: 'Engine Rapid', cat: 'eng', fields: 'engineInstance, speed, boostPressure, tilt', example: '2450 RPM' },
    { pgn: '127489', name: 'Engine Dynamic', cat: 'eng', fields: 'engineInstance, oilPressure, oilTemp, coolantTemp, altVolts, fuelRate, hours, coolantPressure, fuelPressure, checkEngine', example: 'Oil 45psi 85°C' },
    { pgn: '127493', name: 'Transmission', cat: 'eng', fields: 'engineInstance, gear, oilPressure, oilTemp', example: 'FWD 32psi' },
    { pgn: '127497', name: 'Trip Fuel', cat: 'eng', fields: 'engineInstance, tripFuel, fuelRate, avgFuelRate, instantEcon, avgEcon, range', example: '12.4 L/h' },
    { pgn: '127505', name: 'Fluid Level', cat: 'eng', fields: 'fluidInstance, fluidType, level, capacity', example: 'Fuel: 75% 180L' },
    { pgn: '127508', name: 'Battery Status', cat: 'eng', fields: 'batteryInstance, voltage, current, temp, seqId', example: '12.8V -2.4A' },
    { pgn: '127513', name: 'Battery Config', cat: 'eng', fields: 'battInstance, battType, supportsEq, nominalVoltage, chemistry, capacity, tempCoef, peukertExp, chargeEffFactor', example: 'AGM 200Ah 12V' },
    
    // Steering
    { pgn: '127245', name: 'Rudder', cat: 'steer', fields: 'rudderInstance, rudderDirOrder, rudderAngle, rudderAngleOrder', example: '-5.2° (port)' },
    { pgn: '127237', name: 'Heading/Track Control', cat: 'steer', fields: 'rudderLimitExceeded, offHeadingLimit, offTrackLimit, override, steeringMode, turnMode, headingRef, commandedRudder, headingToSteer, track, rudderLimit, offHeading, offTrack, vesselHeading', example: 'AP: TRACK 245°' },
    
    // Anchor
    { pgn: '128777', name: 'Windlass Operating', cat: 'anchor', fields: 'windlassId, direction, motion, rodeCounter, anchorWeight', example: 'OUT 45m' },
    { pgn: '128778', name: 'Windlass Monitoring', cat: 'anchor', fields: 'windlassId, totalMotorTime, controllerVoltage, motorCurrent, rodeTypeLength', example: '12.2V 15A' },
    
    // Lighting/Switches
    { pgn: '127501', name: 'Binary Switch Bank', cat: 'switch', fields: 'bankInstance, switchN (x28)', example: 'Bank 1: 0xFF0F' },
    { pgn: '127502', name: 'Binary Switch Control', cat: 'switch', fields: 'targetBankInstance, switchN (x28)', example: 'Set Bank 2' },
    { pgn: '130576', name: 'Small Craft Status', cat: 'switch', fields: 'portTrimTab, stbdTrimTab', example: 'Tabs: P+5 S-3' },
    
    // Alarms
    { pgn: '126983', name: 'Alert', cat: 'alarm', fields: 'alertType, alertCat, alertId, alertSystem, alertState, dataSource, alertText', example: 'SHALLOW WATER' },
    { pgn: '126984', name: 'Alert Response', cat: 'alarm', fields: 'alertType, alertCat, alertId, alertSystem, responseCmd', example: 'ACK' },
    { pgn: '126985', name: 'Alert Text', cat: 'alarm', fields: 'alertType, alertCat, alertId, alertSystem, textSeq, text', example: 'Depth < 3m' },
    
    // Misc/System  
    { pgn: '126992', name: 'System Time', cat: 'sys', fields: 'seqId, source, date, time', example: '2025-01-15 14:32:00' },
    { pgn: '126993', name: 'Heartbeat', cat: 'sys', fields: 'interval, seqCounter', example: '1000ms #2847' },
    { pgn: '126996', name: 'Product Info', cat: 'sys', fields: 'nmea2000Version, productCode, modelId, swVersionCode, modelVersion, modelSerialCode, certificationLevel, loadEquivalency', example: 'B&G Zeus3' },
    { pgn: '059392', name: 'ISO Acknowledgement', cat: 'sys', fields: 'control, groupFunction, pgn', example: 'ACK PGN 127250' },
    { pgn: '059904', name: 'ISO Request', cat: 'sys', fields: 'pgn', example: 'REQ 127250' },
    { pgn: '060928', name: 'ISO Address Claim', cat: 'sys', fields: 'uniqueNumber, manufacturerCode, deviceInstanceLower, deviceInstanceUpper, deviceFunction, deviceClass, systemInstance, industryGroup, selfConfig', example: 'Addr 23' },
  ];
  
  const categories = [
    { id: 'all', name: 'ALL' },
    { id: 'nav', name: 'NAV' },
    { id: 'wind', name: 'WIND' },
    { id: 'env', name: 'ENV' },
    { id: 'eng', name: 'ENGINE' },
    { id: 'steer', name: 'STEER' },
    { id: 'anchor', name: 'ANCHOR' },
    { id: 'switch', name: 'SWITCH' },
    { id: 'alarm', name: 'ALARM' },
    { id: 'sys', name: 'SYSTEM' },
  ];
  
  const filtered = nmeaData.filter(d => {
    const matchCat = category === 'all' || d.cat === category;
    const matchFilter = !filter || 
      d.pgn.includes(filter) || 
      d.name.toLowerCase().includes(filter.toLowerCase()) ||
      d.fields.toLowerCase().includes(filter.toLowerCase());
    return matchCat && matchFilter;
  });

  return (
    <WidgetFrame title="NMEA REFERENCE" onClose={onClose} width="480px" description="Comprehensive list showing all NMEA 2000 message types with PGN numbers, data names, descriptions and example values.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        
        {/* Search and filter */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            data-no-drag
            type="text"
            placeholder="Search PGN, name, or field..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: 1,
              background: '#111',
              border: `1px solid ${color}44`,
              borderRadius: '3px',
              padding: '4px 8px',
              color,
              fontSize: '11px',
              fontFamily: 'monospace',
              outline: 'none',
            }}
          />
        </div>
        
        {/* Category tabs */}
        <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat.id}
              data-no-drag
              onClick={() => setCategory(cat.id)}
              style={{
                background: category === cat.id ? color : 'transparent',
                color: category === cat.id ? '#000' : color,
                border: `1px solid ${color}44`,
                padding: '2px 6px',
                borderRadius: '2px',
                cursor: 'pointer',
                fontSize: '9px',
                fontFamily: 'monospace',
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        
        {/* Results count */}
        <div style={{ fontSize: '9px', color: `${color}88` }}>
          {filtered.length} of {nmeaData.length} PGNs
        </div>
        
        {/* PGN list */}
        <div 
          data-no-drag
          style={{ 
            maxHeight: '320px', 
            overflowY: 'auto', 
            border: `1px solid ${color}22`,
            borderRadius: '3px',
          }}
        >
          {filtered.map((d, i) => (
            <div 
              key={d.pgn}
              style={{
                padding: '6px 8px',
                borderBottom: `1px solid ${color}11`,
                background: i % 2 === 0 ? 'transparent' : '#ffffff05',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color }}>
                  <span style={{ opacity: 0.5 }}>PGN </span>
                  {d.pgn}
                </span>
                <span style={{ fontSize: '9px', color: `${color}66`, textTransform: 'uppercase' }}>
                  {d.cat}
                </span>
              </div>
              <div style={{ fontSize: '11px', color, fontWeight: 'bold', marginBottom: '2px' }}>
                {d.name}
              </div>
              <div style={{ fontSize: '9px', color: `${color}88`, marginBottom: '2px' }}>
                {d.fields}
              </div>
              <div style={{ fontSize: '9px', color: '#00d4ff', fontFamily: 'monospace' }}>
                ex: {d.example}
              </div>
            </div>
          ))}
        </div>
        
      </div>
    </WidgetFrame>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TERMINAL
// ═══════════════════════════════════════════════════════════════════════════════

function MeridianTerminal() {
  const [history, setHistory] = useState([{ type: 'system', text: 'MERIDIAN TERMINAL v0.5 — Type !help for commands' }, { type: 'system', text: '' }]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [activeTools, setActiveTools] = useState([]); // [{name, props, id, zIndex}]
  const [toolRegistry, setToolRegistry] = useState({
    calculator: { name: 'calculator', description: 'Basic calculator with add, subtract, multiply, and divide operations.', component: CalculatorTool, builtin: true },
    wind: { name: 'wind', description: 'Displays true wind speed and direction with a compass rose indicator. Shows wind in knots and cardinal direction.', component: WindTool, builtin: true },
    compass: { name: 'compass', description: 'Traditional marine compass with liquid-damped card movement. Displays vessel heading with brass bezel, 8-point rose, and lubber line.', component: CompassTool, builtin: true },
    chart: { name: 'chart', description: 'Chart plotter showing Tikehau Atoll lagoon. Toggle north-up/course-up views, zoom controls, shows vessel position and heading.', component: ChartTool, builtin: true },
    nmea: { name: 'nmea', description: 'Comprehensive NMEA 2000 reference showing all PGN numbers, message names, data fields, and example values. Searchable and filterable by category.', component: NMEAReferenceTool, builtin: true },
    datasource: { name: 'datasource', description: 'Complete NMEA 2000 data stream display. Shows all ship systems including navigation, batteries, tanks, climate, pumps, lighting, safety, and communications.', component: DataSourceTool, builtin: true },
    sticky: { name: 'sticky', description: 'Draggable sticky note. Takes color (blue/yellow/pink/green/orange/purple) and name as parameters.', component: StickyTool, builtin: true },
  });
  const [pendingImage, setPendingImage] = useState(null); // {data: base64, type: mime}
  const [commandHistory, setCommandHistory] = useState([]); // Array of past commands
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 means not browsing history
  
  const inputRef = useRef(null);
  const terminalRef = useRef(null);
  const fileInputRef = useRef(null);
  const toolIdCounter = useRef(0);
  const topZIndex = useRef(100);
  const savedInput = useRef(''); // Save input when browsing history

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [history]);

  // Refocus input when processing ends
  useEffect(() => {
    if (!isProcessing) {
      inputRef.current?.focus();
    }
  }, [isProcessing]);

  // Bring a tool to front
  const bringToFront = (toolId) => {
    topZIndex.current += 1;
    setActiveTools(prev => prev.map(t => 
      t.id === toolId ? { ...t, zIndex: topZIndex.current } : t
    ));
  };

  // Handle paste for images
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            setPendingImage({ data: base64, type: file.type, name: 'pasted-image.png' });
            addLine('system', `Image pasted from clipboard.`);
            addLine('system', `Describe what to create or fix.`);
            inputRef.current?.focus();
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const addLine = (type, text) => setHistory(prev => [...prev, { type, text }]);
  const clearScreen = () => { setHistory([{ type: 'system', text: 'MERIDIAN TERMINAL v0.5 — Type !help for commands' }, { type: 'system', text: '' }]); };

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const mediaType = file.type || 'image/png';
      setPendingImage({ data: base64, type: mediaType, name: file.name });
      addLine('system', `Image loaded: ${file.name}`);
      addLine('system', `Now describe what widget to create from this image.`);
      setTimeout(() => inputRef.current?.focus(), 10);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset so same file can be uploaded again
  };

  // Build tool list string for system prompt
  const getToolList = useCallback(() => {
    return Object.values(toolRegistry).map(t => 
      `- ${t.name}: ${t.description}${t.builtin ? ' [BUILT-IN]' : ' [CUSTOM - can be fixed]'}`
    ).join('\n');
  }, [toolRegistry]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LLM WIRE — unified relay on :9123 (provider translation lives in the
  // main process; the key never reaches this page). Model is picked in
  // Setup → Config → Helm · AI. Claude replies can lead with thinking
  // blocks, so text is found by block type, never by position.
  // ═══════════════════════════════════════════════════════════════════════════
  const LLM_URL = 'http://127.0.0.1:9123/llm/messages';
  const llmModel = () => localStorage.getItem('meridian.helm.model') || 'claude-sonnet-5';
  const llmText = (data) => (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  // ═══════════════════════════════════════════════════════════════════════════
  // API CALL 1: SHELL HANDLER - interprets user input
  // ═══════════════════════════════════════════════════════════════════════════
  const shellHandler = async (userInput, imageData = null) => {
    const systemPrompt = `You are MERIDIAN, an AI on a ship's navigation terminal. Stay in character. Never mention Claude or Anthropic.

CURRENT AVAILABLE TOOLS (this list is authoritative - if a tool is not listed here, it does NOT exist):
${getToolList()}

BUILT-IN TOOLS (cannot be fixed, only custom tools can be fixed):
- calculator, wind, datasource, compass, chart, sticky, nmea

COMMANDS (include in response to execute):
[[tool:name]] - open tool (ONLY if it's in the list above!)
[[tool:name:color]] - open with color (red/green/blue/yellow/orange/purple/cyan/pink/amber)
[[sticky:name]] - open blue sticky note with name (e.g. [[sticky:todo-list]])
[[sticky:name:color]] - open sticky with name and color (e.g. [[sticky:shopping:yellow]], [[sticky:ideas:pink]])
  Colors: blue, yellow, pink, green, orange, purple
[[close:name]] - close tool  
[[clear]] - clear screen
[[create:toolname:detailed description of what to build]] - create NEW custom tool
[[fix:toolname:what is wrong]] - fix a CUSTOM tool only (NOT built-in tools like wind, calculator, datasource)

${imageData ? '>>> USER HAS ATTACHED A REFERENCE IMAGE. Look at it carefully to understand what they want. Describe what you see in detail when creating the tool. <<<' : ''}

IMPORTANT RULES:
1. ONLY use [[tool:name]] if the tool is in CURRENT AVAILABLE TOOLS above
2. If user asks for something NOT in the list, use [[create:name:description]]
3. [[fix:...]] only works on CUSTOM tools. For built-in tools (wind, calculator, datasource), create a NEW custom version instead
4. If you see a [SYSTEM ERROR:...] in conversation history, acknowledge the error and try a different approach
5. Respond in 1 short sentence + command
6. Do NOT output terminal formatting or help text
7. When opening sticky notes, always provide a contextual name and pick a color that fits the purpose
${imageData ? '8. When user attaches an image, LOOK AT IT and describe what you see. Name the tool based on what the image shows. Include visual details in your description.' : ''}

Examples:
User: "hi" → "Hello, Captain. Systems ready."
User: "calculator" → "Opening calculator. [[tool:calculator]]"  
User: "radar" (not in list) → "Creating radar. [[create:radar:simple radar sweep display]]"
User: "fix the wind display" → "Wind is built-in. Creating custom version. [[create:wind_custom:wind gauge with speed and direction]]"
User: "the depth gauge looks broken" (depth is custom) → "Repairing depth gauge. [[fix:depth:looks broken]]"
User: "give me a sticky note" → "Opening note. [[sticky:quick-note]]"
User: "I need to track my grocery list" → "Opening sticky. [[sticky:grocery-list:yellow]]"
User: "make a pink sticky for ideas" → "Opening ideas note. [[sticky:ideas:pink]]"
User + IMAGE of a gauge: → "Creating battery gauge. [[create:battery_gauge:circular gauge showing battery percentage with green arc, large number in center, label below]]"`;

    const messages = [...chatHistory, { role: 'user', content: userInput }].slice(-20);

    try {
      // Build message content - include image if present
      let userMessage;
      if (imageData) {
        userMessage = {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageData.type, data: imageData.data } },
            { type: 'text', text: userInput }
          ]
        };
      } else {
        userMessage = { role: 'user', content: userInput };
      }
      
      // Replace last message with image-enhanced version
      const messagesWithImage = [...messages.slice(0, -1), userMessage];

      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmModel(),
          max_tokens: 1000,
          system: systemPrompt,
          messages: messagesWithImage.length > 0 ? messagesWithImage : [userMessage],
        }),
      });
      const data = await res.json();
      if (data.type === 'error') throw new Error(data.error?.message || `API ${res.status}`);
      return llmText(data) || 'No response';
    } catch (err) {
      return `Comms error: ${err.message}`;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // API CALL 2: TOOL CREATOR - generates new tool code
  // ═══════════════════════════════════════════════════════════════════════════
  const createTool = async (name, description, referenceImage = null) => {
    addLine('system', `Creating tool: ${name}...`);
    if (referenceImage) {
      addLine('system', `Using reference image: ${referenceImage.name || 'uploaded'}`);
    }

    const prompt = `Write a React component function for a widget called "${name}".
Description: ${description}

CRITICAL RULES:
1. Use React.createElement() syntax ONLY - NO JSX (no < > tags)
2. Use double quotes for ALL strings
3. Keep it simple - avoid complex logic
4. Make sure all brackets and parentheses are balanced

The component receives: { onClose, code, description }
You have access to: React, useState, useEffect, WidgetFrame, useShipData, useSetShipData

SHIP DATA - use useShipData() to READ sensor data:
const data = useShipData();
// data.windSpeed, data.windAngle, data.windGust (wind)
// data.heading, data.cog, data.sog (navigation)
// data.lat, data.lon (position)
// data.depth, data.waterTemp (depth)
// data.rpm, data.fuelRate (engine)
// data.airTemp, data.pressure, data.humidity (environment)
// data.waveHeight (meters, significant wave height), data.wavePeriod (seconds)
// data.batteryAVoltage, data.batteryAAmps, data.batteryASoc, data.batteryATemp (battery bank A - 48V)
// data.solarAWatts, data.solarAVoltage (solar input A)
// data.batteryBVoltage, data.batteryBAmps, data.batteryBSoc, data.batteryBTemp (battery bank B - 48V)
// data.solarBWatts, data.solarBVoltage (solar input B)
// data.apMode (OFF/STANDBY/AUTO/WIND/TRACK), data.apTargetHeading, data.apTargetWind (autopilot targets)
// data.apEngaged (boolean), data.apBus ('A' or 'B'), data.apRudderCommand, data.apRudderActual (degrees)
// data.apCrossTrackError (nm), data.apGain (1-9), data.apDeadband (degrees), data.apMaxRudder (degrees), data.apResponseRate (1-5)
// data.fuel1Level, data.fuel1Capacity (300L), data.fuel2Level, data.fuel2Capacity (300L) - fuel tanks
// data.water1Level, data.water1Capacity (500L), data.water2Level, data.water2Capacity (500L) - fresh water tanks
// data.grayWaterLevel, data.grayWaterCapacity (200L) - gray water (sink/shower waste)
// data.blackWaterLevel, data.blackWaterCapacity (150L) - black water (sewage)
// data.desalRunning (boolean), data.desalTemp (celsius), data.desalAmps (current draw), data.desalOutput (L/h), data.desalPressure (bar), data.desalHours
// data.cpuUsage (%), data.cpuTemp (celsius), data.memUsed (GB), data.memFree (GB), data.memTotal (GB)
// data.gpuUsage (%), data.gpuTemp (celsius), data.gpuMemUsed (GB), data.gpuMemFree (GB), data.gpuMemTotal (GB), data.processCount
// data.windlassRunning (boolean), data.windlassDirection (UP/DOWN/STOP), data.windlassAmps, data.windlassMaxAmps (80A)
// data.rodeOut (meters deployed), data.rodeTotal (100m), data.anchorDown (boolean)
// data.motorOn (boolean), data.motorDirection (FWD/REV/NEUTRAL), data.motorThrottle (0-100%)
// data.motorAmps, data.motorMaxAmps (400A), data.motorVolts (48V), data.motorTemp (celsius)
// data.motorRpm, data.motorMaxRpm (4500), data.motorPower (kW), data.motorMaxPower (75kW = 100HP)
// LIGHTING: anchorLight, steamingLight, navLightsPort, navLightsStbd, navLightsStern, deckLights, spreaderLights (all boolean)
// BILGE PUMPS: bilgeFwdOn, bilgeFwdCycles, bilgeFwdLast (mins), bilgeMidOn, bilgeMidCycles, bilgeMidLast, bilgeAftOn, bilgeAftCycles, bilgeAftLast
// OTHER PUMPS: freshwaterPumpOn, freshwaterPressure (PSI), washdownPumpOn, maceratorOn
// CLIMATE: cabinTemp, cabinHumidity, ac1On, ac1Amps, ac2On, ac2Amps, fridgeTemp, freezerTemp
// HOT WATER & LPG: hotWaterOn, hotWaterTemp, lpgLevel (%), lpgValve (OPEN/CLOSED), lpgDetector (OK/ALARM), coDetector (OK/ALARM)
// ELECTRICAL: shorePower, shoreAmps, shoreVolts, inverterOn, inverterLoad, inverterCapacity, generatorOn, generatorHours, generatorLoad, generatorCapacity
// COMMS/SAFETY: aisStatus (TX/RX), aisTargets, vhfOn, vhfChannel, epirbArmed, epirbBattery (%), mobStatus (CLEAR/ALARM)

UPDATING DATA - use useSetShipData() to WRITE/update values:
const setData = useSetShipData();
// To update a value:
setData(function(prev) { return Object.assign({}, prev, { apTargetHeading: 180 }); });
// Example: set autopilot heading to 180
// Example: toggle engaged: setData(function(prev) { return Object.assign({}, prev, { apEngaged: !prev.apEngaged }); });

WidgetFrame props: { title, onClose, code, description, width, color }
- code: passed automatically, used for Copy Code feature
- description: string describing what the widget does (for the About menu)
- width: "220px" (default), "300px", "400px", "500px", or "auto"
- color: "#22c55e" (default green), or any hex color

EXAMPLE - simple depth gauge (default width):
({ onClose, code, description }) => {
  const data = useShipData();
  return React.createElement(WidgetFrame, { title: "DEPTH", onClose: onClose, code: code, description: description || "Displays current water depth in meters." },
    React.createElement("div", { style: { textAlign: "center" } },
      React.createElement("div", { style: { fontSize: "48px", color: "#22c55e", fontFamily: "monospace" } }, data.depth.toFixed(1)),
      React.createElement("div", { style: { fontSize: "12px", color: "#22c55e", opacity: 0.7 } }, "meters")
    )
  );
}

EXAMPLE - wide multi-column display:
({ onClose, code, description }) => {
  const data = useShipData();
  return React.createElement(WidgetFrame, { title: "DASHBOARD", onClose: onClose, code: code, description: description || "Multi-gauge navigation dashboard showing speed, depth, and heading.", width: "400px" },
    React.createElement("div", { style: { display: "flex", gap: "24px", justifyContent: "space-around" } },
      React.createElement("div", { style: { textAlign: "center" } },
        React.createElement("div", { style: { fontSize: "10px", color: "#22c55e", opacity: 0.6 } }, "SPEED"),
        React.createElement("div", { style: { fontSize: "28px", color: "#22c55e", fontFamily: "monospace" } }, data.sog.toFixed(1))
      ),
      React.createElement("div", { style: { textAlign: "center" } },
        React.createElement("div", { style: { fontSize: "10px", color: "#22c55e", opacity: 0.6 } }, "DEPTH"),
        React.createElement("div", { style: { fontSize: "28px", color: "#22c55e", fontFamily: "monospace" } }, data.depth.toFixed(1))
      ),
      React.createElement("div", { style: { textAlign: "center" } },
        React.createElement("div", { style: { fontSize: "10px", color: "#22c55e", opacity: 0.6 } }, "HEADING"),
        React.createElement("div", { style: { fontSize: "28px", color: "#22c55e", fontFamily: "monospace" } }, Math.round(data.heading) + "°")
      )
    )
  );
}

EXAMPLE - autopilot controller that can SET heading:
({ onClose, code, description }) => {
  const data = useShipData();
  const setData = useSetShipData();
  var adjustHeading = function(delta) {
    setData(function(prev) { 
      return Object.assign({}, prev, { apTargetHeading: (prev.apTargetHeading + delta + 360) % 360 }); 
    });
  };
  var toggleEngage = function() {
    setData(function(prev) { 
      return Object.assign({}, prev, { apEngaged: !prev.apEngaged }); 
    });
  };
  return React.createElement(WidgetFrame, { title: "AUTOPILOT", onClose: onClose, code: code, description: description || "Autopilot heading control with engage and disengage functionality.", width: "200px" },
    React.createElement("div", { style: { textAlign: "center" } },
      React.createElement("div", { style: { fontSize: "12px", color: data.apEngaged ? "#22c55e" : "#666" } }, data.apEngaged ? "ENGAGED" : "STANDBY"),
      React.createElement("div", { style: { fontSize: "32px", color: "#22c55e", fontFamily: "monospace" } }, Math.round(data.apTargetHeading) + "°"),
      React.createElement("div", { style: { display: "flex", gap: "8px", justifyContent: "center", marginTop: "8px" } },
        React.createElement("button", { "data-no-drag": true, onClick: function() { adjustHeading(-10); }, style: { padding: "4px 12px", background: "#222", color: "#22c55e", border: "1px solid #22c55e", cursor: "pointer" } }, "-10"),
        React.createElement("button", { "data-no-drag": true, onClick: function() { adjustHeading(-1); }, style: { padding: "4px 12px", background: "#222", color: "#22c55e", border: "1px solid #22c55e", cursor: "pointer" } }, "-1"),
        React.createElement("button", { "data-no-drag": true, onClick: function() { adjustHeading(1); }, style: { padding: "4px 12px", background: "#222", color: "#22c55e", border: "1px solid #22c55e", cursor: "pointer" } }, "+1"),
        React.createElement("button", { "data-no-drag": true, onClick: function() { adjustHeading(10); }, style: { padding: "4px 12px", background: "#222", color: "#22c55e", border: "1px solid #22c55e", cursor: "pointer" } }, "+10")
      ),
      React.createElement("button", { "data-no-drag": true, onClick: toggleEngage, style: { marginTop: "12px", padding: "8px 24px", background: data.apEngaged ? "#22c55e" : "#222", color: data.apEngaged ? "#000" : "#22c55e", border: "1px solid #22c55e", cursor: "pointer" } }, data.apEngaged ? "DISENGAGE" : "ENGAGE")
    )
  );
}

${referenceImage ? 'I have attached a REFERENCE IMAGE showing what the widget should look like. Match the visual design, layout, colors, and style as closely as possible while using our green (#22c55e) color scheme on dark background.' : ''}

NOW write "${name}" (${description}).
Return ONLY the arrow function. No markdown. No backticks. No explanation.`;

    // Build message content - text or text+image
    const messageContent = referenceImage 
      ? [
          { type: "image", source: { type: "base64", media_type: referenceImage.type, data: referenceImage.data } },
          { type: "text", text: prompt }
        ]
      : prompt;

    // Try up to 2 times
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(LLM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: llmModel(),
            max_tokens: 2000,
            messages: [{ 
              role: 'user', 
              content: attempt === 1 
                ? messageContent 
                : (typeof messageContent === 'string' 
                    ? messageContent + '\n\nPREVIOUS ATTEMPT FAILED TO COMPILE. Keep it VERY simple. Use basic function() syntax instead of arrow functions for callbacks.'
                    : [...messageContent.slice(0, -1), { type: 'text', text: messageContent[messageContent.length - 1].text + '\n\nPREVIOUS ATTEMPT FAILED TO COMPILE. Keep it VERY simple.' }])
            }],
          }),
        });
        const data = await res.json();
        if (data.type === 'error') throw new Error(data.error?.message || `API ${res.status}`);
        let code = llmText(data);

        // Clean up markdown and common issues
        code = code
          .replace(/```[\w]*\n?/g, '')  // Remove markdown code blocks
          .replace(/```/g, '')
          .trim();
        
        // Try to find the function if there's extra text
        // Match arrow function with either ({ onClose }) or ({ onClose, onDownload })
        const funcMatch = code.match(/\(\s*\{\s*onClose[\s,\w]*\}\s*\)\s*=>\s*\{[\s\S]+\}/);
        if (funcMatch) {
          code = funcMatch[0];
        }
        
        // Try to compile the component
        try {
          const createComponent = new Function('React', 'useState', 'useEffect', 'WidgetFrame', 'useShipData', 'useSetShipData', `return ${code}`);
          const component = createComponent(React, useState, useEffect, WidgetFrame, useShipData, useSetShipData);
          
          if (typeof component !== 'function') {
            throw new Error('Not a valid component function');
          }
          
          // Save to registry
          setToolRegistry(prev => ({
            ...prev,
            [name]: { name, description, component, code, builtin: false }
          }));
          
          addLine('system', `Tool "${name}" created.`);
          return { success: true, component };
        } catch (evalErr) {
          if (attempt === 2) {
            addLine('error', `Failed to create "${name}": ${evalErr.message}`);
            return { success: false, error: evalErr.message };
          }
          addLine('system', `Attempt ${attempt} failed, retrying...`);
        }
      } catch (err) {
        if (attempt === 2) {
          addLine('error', `API error: ${err.message}`);
          return { success: false, error: err.message };
        }
      }
    }
    return { success: false, error: 'Failed after retries' };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // API CALL 3: FIX TOOL - asks Claude to fix issues based on code and complaint
  // ═══════════════════════════════════════════════════════════════════════════
  const fixTool = async (toolName, userComplaint) => {
    const tool = toolRegistry[toolName];
    if (!tool) {
      addLine('error', `Cannot fix "${toolName}" - tool does not exist`);
      return { success: false, error: `tool "${toolName}" does not exist` };
    }
    if (tool.builtin) {
      addLine('error', `Cannot fix "${toolName}" - it's a built-in tool, not a custom tool`);
      return { success: false, error: `"${toolName}" is a built-in tool, cannot be fixed. Create a new custom tool instead.` };
    }

    addLine('system', `Fixing ${toolName}...`);

    const prompt = `You previously created a widget called "${toolName}" (${tool.description}).

The user says there's a problem: "${userComplaint}"

The current code is:
${tool.code}

CRITICAL RULES:
1. Use React.createElement() syntax ONLY - NO JSX
2. Use double quotes for ALL strings  
3. Fix the issue the user mentioned
4. Keep it simple

You have: React, useState, useEffect, WidgetFrame, useShipData, useSetShipData

The component receives { onClose, code, description } - pass all to WidgetFrame.
WidgetFrame props: { title, onClose, code, description, width, color }
- code: passed automatically for Copy Code feature
- description: string describing what the widget does
- width: "220px" (default), "300px", "400px", "500px", or "auto"

useShipData() returns data object with all sensor values.
useSetShipData() returns setter: setData(function(prev) { return Object.assign({}, prev, { fieldName: newValue }); });

Ship data fields: windSpeed, windAngle, windGust, heading, cog, sog, lat, lon, depth, waterTemp, rpm, fuelRate, airTemp, pressure, humidity, batteryAVoltage, batteryAAmps, batteryASoc, batteryATemp, solarAWatts, solarAVoltage, batteryBVoltage, batteryBAmps, batteryBSoc, batteryBTemp, solarBWatts, solarBVoltage, apEngaged, apMode, apBus, apTargetHeading, apTargetWind, apRudderCommand, apRudderActual, apCrossTrackError, apGain, apDeadband, apMaxRudder, apResponseRate, fuel1Level, fuel1Capacity, fuel2Level, fuel2Capacity, water1Level, water1Capacity, water2Level, water2Capacity, grayWaterLevel, grayWaterCapacity, blackWaterLevel, blackWaterCapacity, desalRunning, desalTemp, desalAmps, desalOutput, desalPressure, desalHours, cpuUsage, cpuTemp, memUsed, memFree, memTotal, gpuUsage, gpuTemp, gpuMemUsed, gpuMemFree, gpuMemTotal, processCount, windlassRunning, windlassDirection, windlassAmps, windlassMaxAmps, rodeOut, rodeTotal, anchorDown, motorOn, motorDirection, motorThrottle, motorAmps, motorMaxAmps, motorVolts, motorTemp, motorRpm, motorMaxRpm, motorPower, motorMaxPower, anchorLight, steamingLight, navLightsPort, navLightsStbd, navLightsStern, deckLights, spreaderLights, bilgeFwdOn, bilgeFwdCycles, bilgeFwdLast, bilgeMidOn, bilgeMidCycles, bilgeMidLast, bilgeAftOn, bilgeAftCycles, bilgeAftLast, freshwaterPumpOn, freshwaterPressure, washdownPumpOn, maceratorOn, cabinTemp, cabinHumidity, ac1On, ac1Amps, ac2On, ac2Amps, fridgeTemp, freezerTemp, hotWaterOn, hotWaterTemp, lpgLevel, lpgValve, lpgDetector, coDetector, shorePower, shoreAmps, shoreVolts, inverterOn, inverterLoad, inverterCapacity, generatorOn, generatorHours, generatorLoad, generatorCapacity, aisStatus, aisTargets, vhfOn, vhfChannel, epirbArmed, epirbBattery, mobStatus

Write the FIXED component as ({ onClose, code, description }) => { ... }. Return ONLY the arrow function. No markdown. No backticks.`;

    try {
      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmModel(),
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      if (data.type === 'error') throw new Error(data.error?.message || `API ${res.status}`);
      let code = llmText(data);

      code = code.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();
      
      // Match arrow function with either ({ onClose }) or ({ onClose, onDownload })
      const funcMatch = code.match(/\(\s*\{\s*onClose[\s,\w]*\}\s*\)\s*=>\s*\{[\s\S]+\}/);
      if (funcMatch) {
        code = funcMatch[0];
      }

      try {
        const createComponent = new Function('React', 'useState', 'useEffect', 'WidgetFrame', 'useShipData', 'useSetShipData', `return ${code}`);
        const component = createComponent(React, useState, useEffect, WidgetFrame, useShipData, useSetShipData);
        
        if (typeof component !== 'function') {
          throw new Error('Not a valid component function');
        }

        // Update registry
        setToolRegistry(prev => ({
          ...prev,
          [toolName]: { ...prev[toolName], component, code }
        }));

        // Update active tool instances with new component and code
        setActiveTools(prev => prev.map(t => 
          t.name === toolName ? { ...t, component, code } : t
        ));

        addLine('system', `Tool "${toolName}" fixed.`);
        return { success: true };
      } catch (evalErr) {
        addLine('error', `Fix failed: ${evalErr.message}`);
        return { success: false, error: evalErr.message };
      }
    } catch (err) {
      addLine('error', `API error: ${err.message}`);
      return { success: false, error: err.message };
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Show/Close tools
  // ═══════════════════════════════════════════════════════════════════════════
  const showTool = (name, props = {}, directComponent = null) => {
    const tool = directComponent ? { component: directComponent } : toolRegistry[name];
    if (!tool?.component) {
      addLine('error', `Tool "${name}" not found`);
      return { success: false, error: `Tool "${name}" not found` };
    }
    const id = ++toolIdCounter.current;
    topZIndex.current += 1;
    const code = tool.code || null; // Store code for custom tools
    const description = tool.description || null;
    // Merge registry props with passed props (passed props override)
    const mergedProps = { ...(tool.props || {}), ...props };
    setActiveTools(prev => [...prev, { name, props: mergedProps, id, component: tool.component, code, description, zIndex: topZIndex.current }]);
    return { success: true };
  };

  const closeTool = (idOrName) => {
    setActiveTools(prev => prev.filter(t => t.id !== idOrName && t.name !== idOrName));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Process response - parse commands and execute
  // ═══════════════════════════════════════════════════════════════════════════
  const colorMap = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#eab308', orange: '#f97316', purple: '#a855f7', cyan: '#00d4ff', pink: '#ec4899', amber: '#f59e0b' };

  const processResponse = async (response) => {
    let text = response;
    const errors = [];

    // [[clear]]
    if (text.includes('[[clear]]')) {
      clearScreen();
      setChatHistory([]);
      text = text.replace(/\[\[clear\]\]/g, '');
    }

    // [[close:name]]
    const closeMatches = text.match(/\[\[close:(\w+)\]\]/g) || [];
    for (const m of closeMatches) {
      const name = m.match(/\[\[close:(\w+)\]\]/)[1];
      closeTool(name);
      text = text.replace(m, '');
    }

    // [[fix:name:complaint]]
    const fixMatches = text.match(/\[\[fix:(\w+):([^\]]+)\]\]/g) || [];
    for (const m of fixMatches) {
      const parts = m.match(/\[\[fix:(\w+):([^\]]+)\]\]/);
      const name = parts[1];
      const complaint = parts[2];
      text = text.replace(m, '');
      const result = await fixTool(name, complaint);
      if (!result.success) {
        errors.push(`Fix "${name}" failed: ${result.error || 'not a custom tool or error'}`);
      }
    }

    // [[create:name:description]]
    const createMatches = text.match(/\[\[create:(\w+):([^\]]+)\]\]/g) || [];
    const creationResults = [];
    for (const m of createMatches) {
      const parts = m.match(/\[\[create:(\w+):([^\]]+)\]\]/);
      const name = parts[1];
      const desc = parts[2];
      text = text.replace(m, '');
      
      // Use pending image if available, then clear it
      const imageToUse = pendingImage;
      if (imageToUse) {
        setPendingImage(null);
      }
      
      const result = await createTool(name, desc, imageToUse);
      if (result.success) {
        // Pass component directly to avoid race condition with registry
        showTool(name, {}, result.component);
        creationResults.push({ name, success: true });
      } else {
        creationResults.push({ name, success: false, error: result.error });
      }
    }

    // [[sticky:name]] or [[sticky:name:color]] - sticky notes with custom names and colors
    const stickyColorMap = { blue: '#87CEEB', yellow: '#FFEB7A', pink: '#FFB6C1', green: '#90EE90', orange: '#FFB366', purple: '#DDA0DD' };
    const stickyMatches = text.match(/\[\[sticky:([^\]:]+)(?::(\w+))?\]\]/g) || [];
    for (const m of stickyMatches) {
      const parts = m.match(/\[\[sticky:([^\]:]+)(?::(\w+))?\]\]/);
      const stickyName = parts[1]; // e.g. "todo-list"
      const colorName = parts[2]; // e.g. "yellow"
      const color = colorName ? (stickyColorMap[colorName] || '#87CEEB') : '#87CEEB';
      const result = showTool('sticky', { name: stickyName, color });
      if (!result.success) {
        errors.push(result.error);
      }
      text = text.replace(m, '');
    }

    // [[tool:name]] or [[tool:name:color]]
    const toolMatches = text.match(/\[\[tool:(\w+)(?::(\w+))?\]\]/g) || [];
    for (const m of toolMatches) {
      const parts = m.match(/\[\[tool:(\w+)(?::(\w+))?\]\]/);
      const name = parts[1];
      const colorName = parts[2];
      const color = colorName ? (colorMap[colorName] || colorName) : undefined;
      const result = showTool(name, color ? { color } : {});
      if (!result.success) {
        errors.push(result.error);
      }
      text = text.replace(m, '');
    }

    return { text: text.trim(), creationResults, errors };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Handle submit
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;
    const cmd = input.trim();
    setInput('');
    setHistoryIndex(-1);
    
    // Add to command history (avoid duplicates of last command)
    setCommandHistory(prev => {
      if (prev.length === 0 || prev[prev.length - 1] !== cmd) {
        return [...prev.slice(-50), cmd]; // Keep last 50 commands
      }
      return prev;
    });
    
    addLine('input', `> ${cmd}`);
    
    // Handle !upload command locally
    if (cmd.toLowerCase() === '!upload') {
      fileInputRef.current?.click();
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !help locally
    if (cmd.toLowerCase() === '!help' || cmd.toLowerCase() === 'help') {
      addLine('system', '');
      addLine('system', 'MERIDIAN TERMINAL COMMANDS');
      addLine('system', '─────────────────────────────');
      addLine('system', 'Create widgets by describing them:');
      addLine('system', '  "make a depth gauge"');
      addLine('system', '  "create a battery monitor"');
      addLine('system', '');
      addLine('system', 'Built-in tools:');
      addLine('system', '  compass, wind, calculator, datasource, chart, sticky, nmea');
      addLine('system', '');
      addLine('system', 'Commands:');
      addLine('system', '  !fix [name] [problem]   - patch existing widget code');
      addLine('system', '  !remake [name] [fix]    - delete & rebuild from scratch');
      addLine('system', '  !delete <name>          - remove widget from registry');
      addLine('system', '  !close [name]           - close a widget window');
      addLine('system', '  !clear                  - clear terminal');
      addLine('system', '  !help                   - show this help');
      addLine('system', '');
      addLine('system', 'Tip: Paste images as reference for widget design');
      addLine('system', '');
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !clear locally
    if (cmd.toLowerCase() === '!clear') {
      clearScreen();
      setChatHistory([]);
      setPendingImage(null);
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !close command
    if (cmd.toLowerCase().startsWith('!close')) {
      const toolName = cmd.split(' ')[1];
      if (!toolName) {
        // Close most recent tool
        if (activeTools.length > 0) {
          const lastTool = activeTools[activeTools.length - 1];
          closeTool(lastTool.id);
          addLine('system', `Closed ${lastTool.name}`);
        } else {
          addLine('error', 'No tools open. Usage: !close [toolname]');
        }
      } else {
        const tool = activeTools.find(t => t.name.toLowerCase() === toolName.toLowerCase());
        if (tool) {
          closeTool(tool.id);
          addLine('system', `Closed ${tool.name}`);
        } else {
          addLine('error', `Tool "${toolName}" is not open.`);
        }
      }
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !delete command - remove tool from registry entirely
    if (cmd.toLowerCase().startsWith('!delete')) {
      const toolName = cmd.split(' ')[1];
      if (!toolName) {
        addLine('error', 'Usage: !delete <toolname>');
        setTimeout(() => inputRef.current?.focus(), 10);
        return;
      }
      
      const tool = toolRegistry[toolName];
      if (!tool) {
        addLine('error', `Tool "${toolName}" not found.`);
      } else if (tool.builtin) {
        addLine('error', `Cannot delete built-in tool "${toolName}".`);
      } else {
        // Close any open instances
        setActiveTools(prev => prev.filter(t => t.name !== toolName));
        // Delete from registry
        setToolRegistry(prev => {
          const next = { ...prev };
          delete next[toolName];
          return next;
        });
        addLine('system', `Deleted "${toolName}" from registry.`);
      }
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !fix command - sends code to Claude to fix
    if (cmd.toLowerCase().startsWith('!fix')) {
      const parts = cmd.split(' ');
      const toolName = parts[1];
      const complaint = parts.slice(2).join(' ') || 'it looks wrong or broken';
      
      if (!toolName) {
        // Find most recently created non-builtin tool
        const customTools = Object.values(toolRegistry).filter(t => !t.builtin);
        if (customTools.length === 0) {
          addLine('error', 'No custom tools to fix. Usage: !fix <toolname> [description of problem]');
          setTimeout(() => inputRef.current?.focus(), 10);
          return;
        }
        const lastTool = customTools[customTools.length - 1];
        setIsProcessing(true);
        await fixTool(lastTool.name, complaint);
        setIsProcessing(false);
      } else {
        setIsProcessing(true);
        await fixTool(toolName, complaint);
        setIsProcessing(false);
      }
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    // Handle !remake command - delete and recreate tool from scratch with fix
    if (cmd.toLowerCase().startsWith('!remake')) {
      const parts = cmd.split(' ');
      const toolName = parts[1];
      const extraInstructions = parts.slice(2).join(' ');
      
      // Find tool to remake
      let tool;
      if (!toolName) {
        const customTools = Object.values(toolRegistry).filter(t => !t.builtin);
        if (customTools.length === 0) {
          addLine('error', 'No custom tools to remake. Usage: !remake <toolname> [additional instructions]');
          setTimeout(() => inputRef.current?.focus(), 10);
          return;
        }
        tool = customTools[customTools.length - 1];
      } else {
        tool = toolRegistry[toolName];
      }
      
      if (!tool) {
        addLine('error', `Tool "${toolName}" not found.`);
        setTimeout(() => inputRef.current?.focus(), 10);
        return;
      }
      
      if (tool.builtin) {
        addLine('error', `Cannot remake built-in tool "${tool.name}". Create a new custom tool instead.`);
        setTimeout(() => inputRef.current?.focus(), 10);
        return;
      }
      
      const originalName = tool.name;
      const originalDesc = tool.description;
      const newDesc = extraInstructions 
        ? `${originalDesc}. IMPORTANT: ${extraInstructions}`
        : originalDesc;
      
      addLine('system', `Remaking "${originalName}" from scratch...`);
      
      // Close any open instances
      setActiveTools(prev => prev.filter(t => t.name !== originalName));
      
      // Delete from registry
      setToolRegistry(prev => {
        const next = { ...prev };
        delete next[originalName];
        return next;
      });
      
      // Recreate
      setIsProcessing(true);
      const result = await createTool(originalName, newDesc);
      setIsProcessing(false);
      
      if (result.success) {
        // Auto-open the remade tool
        openTool(originalName);
      }
      
      setTimeout(() => inputRef.current?.focus(), 10);
      return;
    }
    
    setIsProcessing(true);

    // Show image attachment indicator in history if present
    if (pendingImage) {
      addLine('system', `📎 Image attached: ${pendingImage.name || 'pasted-image'}`);
    }

    // Get response from shell handler (pass image so it can see it)
    const response = await shellHandler(cmd, pendingImage);
    
    // Process commands in response
    const { text: cleanResponse, creationResults, errors } = await processResponse(response);
    
    // Display clean response (only if no failures, otherwise error already shown)
    const hasFailures = creationResults.some(cr => !cr.success) || errors.length > 0;
    if (cleanResponse && !hasFailures) {
      addLine('response', cleanResponse);
    }

    // Build chat history entry - include ALL failure info so Claude knows what went wrong
    let assistantContent = response;
    for (const cr of creationResults) {
      if (!cr.success) {
        assistantContent += `\n[SYSTEM ERROR: Tool "${cr.name}" FAILED to create: ${cr.error}. It does NOT exist.]`;
      }
    }
    for (const err of errors) {
      assistantContent += `\n[SYSTEM ERROR: ${err}]`;
    }

    // Update chat history
    setChatHistory(prev => [...prev, { role: 'user', content: cmd }, { role: 'assistant', content: assistantContent }].slice(-20));
    
    setIsProcessing(false);
    
    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════
  const renderLine = (line, i) => {
    const colors = { input: '#4ade80', system: '#22c55e99', response: '#4ade80', error: '#ef4444', code: '#666', result: '#00ffff' };
    return <div key={i} style={{ color: colors[line.type] || '#22c55e', fontSize: line.type === 'code' ? '11px' : '14px', whiteSpace: 'pre-wrap', marginBottom: '4px' }}>{line.text}</div>;
  };

  return (
    <div onClick={() => inputRef.current?.focus()} style={{ width: '100%', height: '100vh', background: '#0a0a0a', position: 'relative', overflow: 'hidden', cursor: 'text' }}>
      
      {/* Active Tools */}
      {activeTools.map((t, i) => {
        const Comp = t.component || toolRegistry[t.name]?.component;
        if (!Comp) return null;
        const desc = t.description || toolRegistry[t.name]?.description || null;
        const widgetCode = t.code || null;
        return (
          <Draggable 
            key={t.id} 
            initialX={20 + i * 30} 
            initialY={20 + i * 30} 
            zIndex={t.zIndex || 100}
            onFocus={() => bringToFront(t.id)}
          >
            <Comp onClose={() => closeTool(t.id)} code={widgetCode} description={desc} {...t.props} />
          </Draggable>
        );
      })}

      {/* Scanlines */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)' }} />

      {/* Hidden input */}
      <input 
        id="helm-cmd"
        ref={inputRef} 
        value={input} 
        onChange={e => { setInput(e.target.value); setHistoryIndex(-1); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            handleSubmit();
          } else if (e.key === 'Escape') {
            setInput('');
            setHistoryIndex(-1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length === 0) return;
            if (historyIndex === -1) {
              savedInput.current = input;
              setHistoryIndex(commandHistory.length - 1);
              setInput(commandHistory[commandHistory.length - 1]);
            } else if (historyIndex > 0) {
              setHistoryIndex(historyIndex - 1);
              setInput(commandHistory[historyIndex - 1]);
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex === -1) return;
            if (historyIndex < commandHistory.length - 1) {
              setHistoryIndex(historyIndex + 1);
              setInput(commandHistory[historyIndex + 1]);
            } else {
              setHistoryIndex(-1);
              setInput(savedInput.current);
            }
          }
        }}
        disabled={isProcessing} 
        autoFocus 
        style={{ position: 'absolute', left: '-9999px' }} 
      />
      
      {/* Hidden file input for image upload */}
      <input 
        ref={fileInputRef} 
        type="file" 
        accept="image/*" 
        onChange={handleImageUpload} 
        style={{ display: 'none' }} 
      />

      {/* Terminal */}
      <div ref={terminalRef} style={{ height: '100vh', overflow: 'auto', padding: '20px', fontFamily: '"JetBrains Mono", monospace', fontSize: '14px', lineHeight: 1.6 }}>
        {history.map(renderLine)}
        
        {/* Input line with optional pending image */}
        <div style={{ color: '#22c55e' }}>
          {pendingImage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#00d4ff', marginBottom: '4px', marginLeft: '16px' }}>
              <span style={{ fontSize: '12px' }}>📎 {pendingImage.name || 'image'} attached</span>
              <span 
                onClick={(e) => { e.stopPropagation(); setPendingImage(null); inputRef.current?.focus(); }} 
                style={{ cursor: 'pointer', opacity: 0.7, fontSize: '10px' }}
              >[remove]</span>
            </div>
          )}
          <div style={{ display: 'flex' }}>
            <span>&gt;&nbsp;</span>
            <span style={{ color: '#4ade80', whiteSpace: 'pre' }}>{input}</span>
            <span style={{ animation: 'blink 1s step-end infinite' }}>▊</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
        ::-webkit-scrollbar { width: 8px }
        ::-webkit-scrollbar-thumb { background: #22c55e33; border-radius: 4px }
      `}</style>
    </div>
  );
}

// Mount + agent control hooks. window.m.command(text) types into the
// terminal exactly like the human (native setter + Enter), so the MCP
// agent and the operator share one grammar.
function App() {
  return (
    <ShipDataProvider>
      <MeridianTerminal />
    </ShipDataProvider>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
window.m = {
  command: (text) => {
    const el = document.getElementById('helm-cmd');
    if (!el) return 'terminal not ready';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(text));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'sent';
  },
  state: () => ({ ready: !!document.getElementById('helm-cmd') }),
};
console.log('[helm] meridian-terminal mounted — window.m.command(text)');
