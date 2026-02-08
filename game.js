// ============================================================
//  WHICH-POKEY  –  A sword-dueling game
// ============================================================

// ===== CONFIGURATION ========================================
const CFG = {
    // Arena (virtual coords – scaled to fit canvas)
    ARENA_W: 1000,
    ARENA_H: 650,
    ARENA_PAD: 40,        // padding inside border
    WALL_BOUNCE: 0.5,     // velocity multiplier on wall bounce

    // Physics
    FRICTION: 0.88,

    // Sword defaults (overridden by selection)
    SWING_ARC: Math.PI / 2,   // 90°
    SWING_DUR: 150,            // ms
    SWING_CD: 200,             // ms cooldown after swing

    // Rounds
    WINS_NEEDED: 3,
    COUNTDOWN_SEC: 3,
    ROUND_END_PAUSE: 1800,    // ms after a hit before next round
    MATCH_END_PAUSE: 3500,

    // Network
    PEER_PREFIX: 'whichpokey-',
    STATE_RATE: 50,           // ms between state sends (20/s)
};

// ===== UTILITIES ============================================
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function angle(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }

function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[randInt(0, chars.length - 1)];
    return c;
}

// Line segment vs circle intersection
function segCircle(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const fx = ax - cx, fy = ay - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    let disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    disc = Math.sqrt(disc);
    const t1 = (-b - disc) / (2 * a);
    const t2 = (-b + disc) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

// ===== AUDIO SYSTEM =========================================
const Audio = (() => {
    let ctx = null;
    function ensure() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function play(fn) {
        try { fn(ensure()); } catch (_) { /* audio not available */ }
    }

    return {
        whoosh() {
            play(c => {
                const dur = 0.12;
                const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < data.length; i++) {
                    const t = i / data.length;
                    data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.3;
                }
                const src = c.createBufferSource();
                src.buffer = buf;
                const bp = c.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.setValueAtTime(2000, c.currentTime);
                bp.frequency.linearRampToValueAtTime(800, c.currentTime + dur);
                bp.Q.value = 1.5;
                const gain = c.createGain();
                gain.gain.setValueAtTime(0.4, c.currentTime);
                gain.gain.linearRampToValueAtTime(0, c.currentTime + dur);
                src.connect(bp).connect(gain).connect(c.destination);
                src.start();
            });
        },

        hit() {
            play(c => {
                // Low thump
                const osc = c.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(120, c.currentTime);
                osc.frequency.exponentialRampToValueAtTime(40, c.currentTime + 0.2);
                const g = c.createGain();
                g.gain.setValueAtTime(0.6, c.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
                osc.connect(g).connect(c.destination);
                osc.start(); osc.stop(c.currentTime + 0.3);

                // Noise burst
                const dur = 0.08;
                const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
                const s = c.createBufferSource(); s.buffer = buf;
                const g2 = c.createGain();
                g2.gain.setValueAtTime(0.5, c.currentTime);
                g2.gain.linearRampToValueAtTime(0, c.currentTime + dur);
                s.connect(g2).connect(c.destination); s.start();
            });
        },

        beep(freq = 880, dur = 0.1, vol = 0.2) {
            play(c => {
                const osc = c.createOscillator();
                osc.type = 'square';
                osc.frequency.value = freq;
                const g = c.createGain();
                g.gain.setValueAtTime(vol, c.currentTime);
                g.gain.linearRampToValueAtTime(0, c.currentTime + dur);
                osc.connect(g).connect(c.destination);
                osc.start(); osc.stop(c.currentTime + dur);
            });
        },

        fanfare() {
            play(c => {
                [0, 0.12, 0.24, 0.48].forEach((delay, i) => {
                    const freqs = [523, 659, 784, 1047];
                    const osc = c.createOscillator();
                    osc.type = 'square';
                    osc.frequency.value = freqs[i];
                    const g = c.createGain();
                    const t = c.currentTime + delay;
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.15, t + 0.04);
                    g.gain.linearRampToValueAtTime(i === 3 ? 0.15 : 0.08, t + 0.1);
                    g.gain.linearRampToValueAtTime(0, t + (i === 3 ? 0.6 : 0.15));
                    osc.connect(g).connect(c.destination);
                    osc.start(t); osc.stop(t + 0.7);
                });
            });
        },

        click() {
            play(c => {
                const osc = c.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = 1200;
                const g = c.createGain();
                g.gain.setValueAtTime(0.1, c.currentTime);
                g.gain.linearRampToValueAtTime(0, c.currentTime + 0.04);
                osc.connect(g).connect(c.destination);
                osc.start(); osc.stop(c.currentTime + 0.04);
            });
        },
    };
})();

// ===== PARTICLE SYSTEM ======================================
const Particles = (() => {
    const list = [];

    function spawn(x, y, count, color, speedMin, speedMax, life) {
        for (let i = 0; i < count; i++) {
            const a = rand(0, Math.PI * 2);
            const s = rand(speedMin, speedMax);
            list.push({
                x, y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life,
                maxLife: life,
                r: rand(2, 5),
                color,
            });
        }
    }

    function update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.life -= dt;
            if (p.life <= 0) list.splice(i, 1);
        }
    }

    function draw(ctx) {
        for (const p of list) {
            const alpha = clamp(p.life / p.maxLife, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function clear() { list.length = 0; }

    return { spawn, update, draw, clear };
})();

// ===== BODY & SWORD GENERATION ==============================
const SHAPE_TYPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'diamond'];

const BODY_ADJ = [
    'Nimble', 'Swift', 'Zippy', 'Tiny', 'Wispy', 'Quick',
    'Steady', 'Solid', 'Sturdy', 'Balanced', 'Firm',
    'Hefty', 'Chunky', 'Mighty', 'Grand', 'Massive', 'Thicc',
];
const BODY_NOUN = ['Blob', 'Fighter', 'Warrior', 'Brawler', 'Duelist', 'Gladiator',
    'Champion', 'Scrapper', 'Rogue', 'Knight', 'Brute', 'Nomad'];

const SWORD_NAMES_SHORT = ['Toothpick', 'Letter Opener', 'Shiv', 'Thorn', 'Needle', 'Splinter'];
const SWORD_NAMES_MED = ['Gladius', 'Cutlass', 'Saber', 'Rapier', 'Falchion', 'Blade'];
const SWORD_NAMES_LONG = ['Claymore', 'Baguette', 'Pool Noodle', 'Zweihander', 'Lance', 'Yardstick'];

function generateBodyOptions(handicap = 0) {
    const options = [];
    for (let i = 0; i < 3; i++) {
        // Handicap pushes radius up (bigger = worse)
        const baseMin = 16 + handicap * 3;
        const baseMax = 42 + handicap * 2;
        const radius = rand(clamp(baseMin, 16, 38), clamp(baseMax, 24, 50));

        // Speed inversely related to size, with noise
        const sizeRatio = (radius - 14) / 36; // 0 = tiny, 1 = huge
        const maxSpeed = lerp(420, 180, sizeRatio) + rand(-40, 40);
        const accel = lerp(1800, 700, sizeRatio) + rand(-200, 200);

        const shape = pick(SHAPE_TYPES);
        const adj = pick(BODY_ADJ);
        const noun = pick(BODY_NOUN);

        options.push({
            shape,
            radius: Math.round(radius),
            maxSpeed: Math.round(clamp(maxSpeed, 140, 460)),
            accel: Math.round(clamp(accel, 500, 2000)),
            friction: +(0.88 + rand(-0.03, 0.03)).toFixed(3),
            name: `${adj} ${noun}`,
        });
    }
    return options;
}

function generateSwordOptions(handicap = 0) {
    const options = [];
    for (let i = 0; i < 3; i++) {
        // Handicap pushes length down and duration up (shorter & slower = worse)
        const lengthMin = Math.max(28, 55 - handicap * 8);
        const lengthMax = Math.max(45, 90 - handicap * 5);
        const length = rand(lengthMin, lengthMax);

        const lenRatio = (length - 25) / 65; // 0 = short, 1 = long
        const swingDur = lerp(100, 260, lenRatio) + rand(-30, 30);
        const cooldown = lerp(140, 320, lenRatio) + rand(-30, 30);
        const arcAngle = lerp(70, 120, rand(0, 1)); // degrees, fairly random

        let nameList;
        if (length < 45) nameList = SWORD_NAMES_SHORT;
        else if (length < 65) nameList = SWORD_NAMES_MED;
        else nameList = SWORD_NAMES_LONG;

        options.push({
            length: Math.round(length),
            width: Math.round(lerp(3, 7, lenRatio) + rand(-1, 1)),
            swingDur: Math.round(clamp(swingDur, 80, 300)),
            cooldown: Math.round(clamp(cooldown, 120, 360)),
            arcAngle: Math.round(clamp(arcAngle, 55, 130)),
            name: pick(nameList),
        });
    }
    return options;
}

// ===== DRAW SHAPE HELPER ====================================
function drawShape(ctx, shape, x, y, radius, color, glowColor) {
    ctx.save();
    if (glowColor) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 15;
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = glowColor || color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    switch (shape) {
        case 'circle':
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            break;
        case 'square':
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4);
            const s = radius * 0.85;
            ctx.rect(-s, -s, s * 2, s * 2);
            ctx.restore();
            break;
        case 'diamond':
            polygon(ctx, x, y, radius, 4, 0);
            break;
        case 'triangle':
            polygon(ctx, x, y, radius * 1.1, 3, -Math.PI / 2);
            break;
        case 'pentagon':
            polygon(ctx, x, y, radius, 5, -Math.PI / 2);
            break;
        case 'hexagon':
            polygon(ctx, x, y, radius, 6, 0);
            break;
        default:
            ctx.arc(x, y, radius, 0, Math.PI * 2);
    }

    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function polygon(ctx, x, y, r, sides, startAngle) {
    for (let i = 0; i < sides; i++) {
        const a = startAngle + (Math.PI * 2 * i) / sides;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

// ===== DRAW SWORD IN CARD PREVIEW ===========================
function drawSwordPreview(cvs, sword) {
    const ctx = cvs.getContext('2d');
    const w = cvs.width, h = cvs.height;
    ctx.clearRect(0, 0, w, h);

    // Draw the sword diagonally
    ctx.save();
    ctx.translate(w * 0.25, h * 0.75);
    ctx.rotate(-Math.PI / 4);

    // Blade
    const bladeLen = sword.length * 0.8;
    const bladeW = Math.max(sword.width * 1.2, 4);
    ctx.fillStyle = '#ccddff';
    ctx.shadowColor = '#88aaff';
    ctx.shadowBlur = 6;
    ctx.fillRect(0, -bladeW / 2, bladeLen, bladeW);

    // Guard
    ctx.fillStyle = '#ffcc44';
    ctx.shadowBlur = 0;
    ctx.fillRect(-2, -bladeW - 2, 5, bladeW * 2 + 4);

    // Handle
    ctx.fillStyle = '#886633';
    ctx.fillRect(-14, -3, 14, 6);

    ctx.restore();

    // Arc indicator
    const arcRad = 25;
    const arcAngle = (sword.arcAngle * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(255,170,34,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w * 0.25, h * 0.75, arcRad, -Math.PI / 4 - arcAngle / 2, -Math.PI / 4 + arcAngle / 2);
    ctx.stroke();
}

// ===== NETWORK MANAGER ======================================
class Network {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.isHost = false;
        this.roomCode = '';
        this.onMessage = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.onError = null;
    }

    createRoom(cb) {
        this.isHost = true;
        this.roomCode = genCode();
        this.peer = new Peer(CFG.PEER_PREFIX + this.roomCode);

        this.peer.on('open', () => {
            cb(null, this.roomCode);
        });

        this.peer.on('connection', conn => {
            this.conn = conn;
            this._setupConn();
        });

        this.peer.on('error', err => {
            if (err.type === 'unavailable-id') {
                // Code collision – try again
                this.peer.destroy();
                this.roomCode = genCode();
                this.peer = new Peer(CFG.PEER_PREFIX + this.roomCode);
                this.peer.on('open', () => cb(null, this.roomCode));
                this.peer.on('connection', conn => { this.conn = conn; this._setupConn(); });
                this.peer.on('error', e => cb(e.message));
            } else {
                cb(err.message);
            }
        });
    }

    joinRoom(code, cb) {
        this.isHost = false;
        this.roomCode = code.toUpperCase();
        this.peer = new Peer();

        this.peer.on('open', () => {
            this.conn = this.peer.connect(CFG.PEER_PREFIX + this.roomCode, { reliable: true });
            this.conn.on('open', () => {
                this._setupConn();
                cb(null);
            });
            this.conn.on('error', err => cb(err.message || 'Connection failed'));
        });

        this.peer.on('error', err => {
            if (err.type === 'peer-unavailable') {
                cb('Room not found. Check the code and try again.');
            } else {
                cb(err.message || 'Connection error');
            }
        });
    }

    _setupConn() {
        this.conn.on('data', data => {
            if (this.onMessage) this.onMessage(data);
        });

        this.conn.on('close', () => {
            if (this.onDisconnect) this.onDisconnect();
        });

        if (this.onConnect) this.onConnect();
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        }
    }

    destroy() {
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.conn = null;
        this.peer = null;
    }
}

// ===== GAME STATE ===========================================
const G = {
    // State machine
    state: 'menu', // menu, lobby, select, countdown, playing, roundEnd, matchEnd

    // AI mode
    isAIMode: false,
    aiState: {},

    // Canvas
    canvas: null,
    ctx: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,

    // Network
    net: new Network(),
    playerNum: 0,   // 1 = host, 2 = client
    lastStateSend: 0,

    // Input
    keys: {},
    mouseX: 0,
    mouseY: 0,       // in arena coords
    mouseDown: false,
    mouseClicked: false,

    // Selection
    bodyOptions: [],
    swordOptions: [],
    selectedBody: -1,
    selectedSword: -1,
    localReady: false,
    remoteReady: false,
    remoteSelected: false,

    // Players
    p1: null,
    p2: null,
    local: null,   // ref to p1 or p2
    remote: null,  // ref to the other

    // Match
    p1Score: 0,
    p2Score: 0,
    sessionWins: { 1: 0, 2: 0 },  // across matches for handicap
    roundNum: 0,

    // Countdown / transitions
    countdownVal: 0,
    countdownTimer: 0,
    overlayText: '',
    overlaySubtext: '',
    overlayTimer: 0,

    // Screen shake
    shakeX: 0,
    shakeY: 0,
    shakeDur: 0,
    shakeIntensity: 0,

    // Sword trails
    trails: [],

    // Time
    lastTime: 0,
};

// ===== PLAYER OBJECT ========================================
function createPlayer(num, body, sword) {
    const startX = num === 1
        ? CFG.ARENA_PAD + body.radius + 60
        : CFG.ARENA_W - CFG.ARENA_PAD - body.radius - 60;
    const startY = CFG.ARENA_H / 2;

    return {
        num,
        x: startX,
        y: startY,
        startX,
        startY,
        vx: 0,
        vy: 0,
        body,
        sword,
        color: num === 1 ? '#4488ff' : '#ff4466',
        glowColor: num === 1 ? '#66aaff' : '#ff6688',

        // Sword state
        swordAngle: num === 1 ? 0 : Math.PI,  // default facing
        swinging: false,
        swingStart: 0,
        swingTargetAngle: 0,
        canSwing: true,
        swingCooldownEnd: 0,

        // Mouse (for remote display)
        mouseAngle: num === 1 ? 0 : Math.PI,

        // Interpolation targets (for remote player)
        _targetX: startX,
        _targetY: startY,
    };
}

function resetPlayerPosition(p) {
    p.x = p.startX;
    p.y = p.startY;
    p._targetX = p.startX;
    p._targetY = p.startY;
    p.vx = 0;
    p.vy = 0;
    p.swinging = false;
    p.canSwing = true;
    p.swingCooldownEnd = 0;
    p.swordAngle = p.num === 1 ? 0 : Math.PI;
    p.mouseAngle = p.num === 1 ? 0 : Math.PI;
}

// ===== INPUT ================================================
function initInput() {
    window.addEventListener('keydown', e => {
        G.keys[e.key.toLowerCase()] = true;
        // Prevent scrolling
        if (['w', 'a', 's', 'd', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    });

    window.addEventListener('keyup', e => {
        G.keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('mousemove', e => {
        updateMousePos(e.clientX, e.clientY);
    });

    window.addEventListener('mousedown', e => {
        if (e.button === 0) {
            G.mouseDown = true;
            G.mouseClicked = true;
        }
    });

    window.addEventListener('mouseup', e => {
        if (e.button === 0) G.mouseDown = false;
    });

    // Prevent context menu on right click
    G.canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function updateMousePos(clientX, clientY) {
    const rect = G.canvas.getBoundingClientRect();
    const canvasX = (clientX - rect.left) * (G.canvas.width / rect.width);
    const canvasY = (clientY - rect.top) * (G.canvas.height / rect.height);
    // Convert to arena coords
    G.mouseX = (canvasX - G.offsetX) / G.scale;
    G.mouseY = (canvasY - G.offsetY) / G.scale;
}

// ===== SCREEN MANAGEMENT ====================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id + '-screen').classList.add('active');
}

// ===== UI SETUP =============================================
function initUI() {
    const createBtn = document.getElementById('create-btn');
    const joinBtn = document.getElementById('join-btn');
    const roomInput = document.getElementById('room-input');
    const menuStatus = document.getElementById('menu-status');
    const readyBtn = document.getElementById('ready-btn');

    const soloBtn = document.getElementById('solo-btn');
    soloBtn.addEventListener('click', () => {
        G.isAIMode = true;
        G.playerNum = 1;
        startSelection();
    });

    createBtn.addEventListener('click', () => {
        createBtn.disabled = true;
        menuStatus.textContent = 'Creating room...';
        menuStatus.className = 'status-text';

        G.net.createRoom((err, code) => {
            if (err) {
                menuStatus.textContent = err;
                menuStatus.className = 'status-text error';
                createBtn.disabled = false;
                return;
            }
            G.playerNum = 1;
            G.state = 'lobby';
            document.getElementById('room-code').textContent = code;
            showScreen('lobby');
        });

        setupNetCallbacks();
    });

    joinBtn.addEventListener('click', () => {
        const code = roomInput.value.trim().toUpperCase();
        if (code.length !== 4) {
            menuStatus.textContent = 'Enter a 4-character room code.';
            menuStatus.className = 'status-text error';
            return;
        }
        joinBtn.disabled = true;
        menuStatus.textContent = 'Connecting...';
        menuStatus.className = 'status-text';

        G.playerNum = 2; // Set before connecting so it's ready when onConnect fires
        setupNetCallbacks();

        G.net.joinRoom(code, err => {
            if (err) {
                menuStatus.textContent = err;
                menuStatus.className = 'status-text error';
                joinBtn.disabled = false;
                G.playerNum = 0;
                return;
            }
        });
    });

    roomInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') joinBtn.click();
    });

    // Force uppercase in room input
    roomInput.addEventListener('input', () => {
        roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    readyBtn.addEventListener('click', () => {
        if (G.selectedBody < 0 || G.selectedSword < 0) return;
        G.localReady = true;
        readyBtn.disabled = true;
        readyBtn.textContent = G.isAIMode ? 'Starting...' : 'Waiting for opponent...';
        Audio.click();

        if (!G.isAIMode) {
            G.net.send({
                type: 'ready',
                body: G.bodyOptions[G.selectedBody],
                sword: G.swordOptions[G.selectedSword],
            });
        }

        checkBothReady();
    });
}

function setupNetCallbacks() {
    G.net.onConnect = () => {
        // Both connected – go to selection
        startSelection();
    };

    G.net.onMessage = data => handleNetMessage(data);

    G.net.onDisconnect = () => {
        if (G.state !== 'menu') {
            G.overlayText = 'Opponent disconnected';
            G.overlaySubtext = 'Returning to menu...';
            setTimeout(() => {
                G.net.destroy();
                resetToMenu();
            }, 2000);
        }
    };
}

function resetToMenu() {
    G.state = 'menu';
    G.isAIMode = false;
    G.aiState = {};
    G.net = new Network();
    G.p1Score = 0;
    G.p2Score = 0;
    G.roundNum = 0;
    G.localReady = false;
    G.remoteReady = false;
    G.remoteSelected = false;
    G.selectedBody = -1;
    G.selectedSword = -1;
    Particles.clear();
    G.trails = [];
    showScreen('menu');

    // Re-enable buttons
    document.getElementById('create-btn').disabled = false;
    document.getElementById('join-btn').disabled = false;
    document.getElementById('menu-status').textContent = '';
}

// ===== SELECTION ============================================
function startSelection() {
    G.state = 'select';
    G.localReady = false;
    G.remoteReady = false;
    G.remoteSelected = false;
    G.selectedBody = -1;
    G.selectedSword = -1;
    G.p1Score = 0;
    G.p2Score = 0;
    G.roundNum = 0;

    const myHandicap = G.sessionWins[G.playerNum] || 0;
    G.bodyOptions = generateBodyOptions(myHandicap);
    G.swordOptions = generateSwordOptions(myHandicap);

    renderSelectionCards();
    showScreen('select');

    const readyBtn = document.getElementById('ready-btn');
    readyBtn.disabled = true;
    readyBtn.textContent = 'Pick a body & sword';

    document.getElementById('opponent-status').textContent = '';

    // AI mode: generate AI's choices and auto-ready
    if (G.isAIMode) {
        const aiHandicap = G.sessionWins[2] || 0;
        const aiBodies = generateBodyOptions(aiHandicap);
        const aiSwords = generateSwordOptions(aiHandicap);
        remoteBody = pick(aiBodies);
        remoteSword = pick(aiSwords);
        G.remoteReady = true;
        G.remoteSelected = true;
        document.getElementById('opponent-status').textContent = 'AI is ready!';
    }
}

function renderSelectionCards() {
    const bodyContainer = document.getElementById('body-options');
    const swordContainer = document.getElementById('sword-options');
    const pColor = G.playerNum === 1 ? 'var(--p1)' : 'var(--p2)';

    bodyContainer.innerHTML = '';
    swordContainer.innerHTML = '';

    G.bodyOptions.forEach((body, i) => {
        const card = document.createElement('div');
        card.className = 'option-card';
        card.dataset.index = i;

        const preview = document.createElement('canvas');
        preview.className = 'preview';
        preview.width = 80;
        preview.height = 80;

        // Draw body preview
        const pCtx = preview.getContext('2d');
        const baseColor = G.playerNum === 1 ? '#4488ff' : '#ff4466';
        const glowCol = G.playerNum === 1 ? '#66aaff' : '#ff6688';
        const drawRadius = Math.min(body.radius, 32);
        drawShape(pCtx, body.shape, 40, 40, drawRadius, baseColor, glowCol);

        // Eyes
        drawEyes(pCtx, body.shape, 40, 40, drawRadius, 0);

        // Speed stat: normalize 140-460
        const speedPct = ((body.maxSpeed - 140) / 320) * 100;
        // Size stat: normalize radius 14-50
        const sizePct = ((body.radius - 14) / 36) * 100;
        // Accel stat: normalize 500-2000
        const accelPct = ((body.accel - 500) / 1500) * 100;

        card.appendChild(preview);

        const nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.textContent = body.name;
        card.appendChild(nameDiv);

        const statsDiv = document.createElement('div');
        statsDiv.className = 'stats';
        statsDiv.innerHTML = `
            <div class="stat-row">
                <span class="stat-label">Speed</span>
                <div class="stat-bar-bg"><div class="stat-bar speed" style="width:${speedPct}%"></div></div>
            </div>
            <div class="stat-row">
                <span class="stat-label">Size</span>
                <div class="stat-bar-bg"><div class="stat-bar size" style="width:${sizePct}%"></div></div>
            </div>
            <div class="stat-row">
                <span class="stat-label">Accel</span>
                <div class="stat-bar-bg"><div class="stat-bar accel" style="width:${accelPct}%"></div></div>
            </div>
        `;
        card.appendChild(statsDiv);

        card.addEventListener('click', () => {
            bodyContainer.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            G.selectedBody = i;
            Audio.click();
            updateReadyButton();
        });

        bodyContainer.appendChild(card);
    });

    G.swordOptions.forEach((sword, i) => {
        const card = document.createElement('div');
        card.className = 'option-card';
        card.dataset.index = i;

        const preview = document.createElement('canvas');
        preview.className = 'preview';
        preview.width = 80;
        preview.height = 80;
        drawSwordPreview(preview, sword);

        // Length stat: normalize 25-90
        const lengthPct = ((sword.length - 25) / 65) * 100;
        // Swing speed: invert duration 80-300 → faster = higher bar
        const swingPct = ((300 - sword.swingDur) / 220) * 100;
        // Arc: normalize 55-130
        const arcPct = ((sword.arcAngle - 55) / 75) * 100;

        card.appendChild(preview);

        const sNameDiv = document.createElement('div');
        sNameDiv.className = 'name';
        sNameDiv.textContent = sword.name;
        card.appendChild(sNameDiv);

        const sStatsDiv = document.createElement('div');
        sStatsDiv.className = 'stats';
        sStatsDiv.innerHTML = `
            <div class="stat-row">
                <span class="stat-label">Length</span>
                <div class="stat-bar-bg"><div class="stat-bar length" style="width:${lengthPct}%"></div></div>
            </div>
            <div class="stat-row">
                <span class="stat-label">Speed</span>
                <div class="stat-bar-bg"><div class="stat-bar swing" style="width:${swingPct}%"></div></div>
            </div>
            <div class="stat-row">
                <span class="stat-label">Arc</span>
                <div class="stat-bar-bg"><div class="stat-bar arc" style="width:${arcPct}%"></div></div>
            </div>
        `;
        card.appendChild(sStatsDiv);

        card.addEventListener('click', () => {
            swordContainer.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            G.selectedSword = i;
            Audio.click();
            updateReadyButton();
        });

        swordContainer.appendChild(card);
    });
}

function updateReadyButton() {
    const btn = document.getElementById('ready-btn');
    if (G.localReady) return;
    if (G.selectedBody >= 0 && G.selectedSword >= 0) {
        btn.disabled = false;
        btn.textContent = 'Ready!';
    }
}

// ===== DRAW EYES ON BODY ====================================
function drawEyes(ctx, shape, x, y, radius, lookAngle) {
    const eyeOff = radius * 0.3;
    const eyeR = Math.max(radius * 0.15, 2.5);
    const pupilR = eyeR * 0.55;

    const ex1 = x + Math.cos(lookAngle - 0.4) * eyeOff;
    const ey1 = y + Math.sin(lookAngle - 0.4) * eyeOff;
    const ex2 = x + Math.cos(lookAngle + 0.4) * eyeOff;
    const ey2 = y + Math.sin(lookAngle + 0.4) * eyeOff;

    // Pupil offset toward look direction
    const po = eyeR * 0.3;
    const px = Math.cos(lookAngle) * po;
    const py = Math.sin(lookAngle) * po;

    for (const [ex, ey] of [[ex1, ey1], [ex2, ey2]]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(ex + px, ey + py, pupilR, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ===== NETWORK MESSAGES =====================================
let remoteBody = null;
let remoteSword = null;

function handleNetMessage(data) {
    switch (data.type) {
        case 'ready':
            G.remoteReady = true;
            remoteBody = data.body;
            remoteSword = data.sword;
            document.getElementById('opponent-status').textContent = 'Opponent is ready!';
            checkBothReady();
            break;

        case 'state':
            if (G.remote && (G.state === 'playing' || G.state === 'countdown')) {
                // Store target for interpolation
                G.remote._targetX = data.x;
                G.remote._targetY = data.y;
                G.remote.vx = data.vx;
                G.remote.vy = data.vy;
                G.remote.swordAngle = data.swordAngle;
                G.remote.swinging = data.swinging;
                G.remote.mouseAngle = data.mouseAngle;
            }
            break;

        case 'swing':
            if (G.remote && G.state === 'playing') {
                G.remote.swinging = true;
                G.remote.swingStart = performance.now();
                G.remote.swingTargetAngle = data.angle;
                G.remote.canSwing = false;
                Audio.whoosh();
            }
            break;

        case 'hit':
            handleHit(data.winner);
            break;

        case 'matchEnd':
            handleMatchEnd(data.winner);
            break;

        case 'startRound':
            startCountdown();
            break;

        case 'nextMatch':
            startSelection();
            break;
    }
}

function checkBothReady() {
    if (G.localReady && G.remoteReady) {
        // Build players
        const myBody = G.bodyOptions[G.selectedBody];
        const mySword = G.swordOptions[G.selectedSword];

        if (G.playerNum === 1) {
            G.p1 = createPlayer(1, myBody, mySword);
            G.p2 = createPlayer(2, remoteBody, remoteSword);
            G.local = G.p1;
            G.remote = G.p2;
        } else {
            G.p1 = createPlayer(1, remoteBody, remoteSword);
            G.p2 = createPlayer(2, myBody, mySword);
            G.local = G.p2;
            G.remote = G.p1;
        }

        G.p1Score = 0;
        G.p2Score = 0;
        G.roundNum = 0;

        showScreen('game');
        resizeCanvas();

        // Host (or AI mode) starts the first round
        if (G.isAIMode || G.net.isHost) {
            setTimeout(() => {
                if (!G.isAIMode) G.net.send({ type: 'startRound' });
                startCountdown();
            }, 500);
        }
    }
}

// ===== COUNTDOWN & ROUND FLOW ===============================
function startCountdown() {
    G.state = 'countdown';
    G.countdownVal = CFG.COUNTDOWN_SEC;
    G.countdownTimer = 0;
    G.roundNum++;

    resetPlayerPosition(G.p1);
    resetPlayerPosition(G.p2);
    Particles.clear();
    G.trails = [];

    if (G.isAIMode) initAIState();
}

function handleHit(winnerNum) {
    G.state = 'roundEnd';

    if (winnerNum === 1) G.p1Score++;
    else G.p2Score++;

    const winnerPlayer = winnerNum === 1 ? G.p1 : G.p2;
    const loserPlayer = winnerNum === 1 ? G.p2 : G.p1;

    // Effects
    Audio.hit();
    G.shakeIntensity = 12;
    G.shakeDur = 0.3;

    Particles.spawn(loserPlayer.x, loserPlayer.y, 30, winnerPlayer.color, 100, 400, 0.8);
    Particles.spawn(loserPlayer.x, loserPlayer.y, 15, '#ffffff', 50, 200, 0.5);

    const isLocalWin = winnerNum === G.playerNum;
    G.overlayText = isLocalWin ? 'You scored!' : (G.isAIMode ? 'AI scored!' : 'Opponent scored!');
    G.overlaySubtext = `${G.p1Score} - ${G.p2Score}`;

    // Check for match end
    if (G.p1Score >= CFG.WINS_NEEDED || G.p2Score >= CFG.WINS_NEEDED) {
        const matchWinner = G.p1Score >= CFG.WINS_NEEDED ? 1 : 2;
        setTimeout(() => {
            if (G.isAIMode || G.net.isHost) {
                if (!G.isAIMode) G.net.send({ type: 'matchEnd', winner: matchWinner });
                handleMatchEnd(matchWinner);
            }
        }, CFG.ROUND_END_PAUSE);
    } else {
        // Next round after pause
        setTimeout(() => {
            if (G.isAIMode || G.net.isHost) {
                if (!G.isAIMode) G.net.send({ type: 'startRound' });
                startCountdown();
            }
        }, CFG.ROUND_END_PAUSE);
    }
}

function handleMatchEnd(winnerNum) {
    G.state = 'matchEnd';
    G.sessionWins[winnerNum] = (G.sessionWins[winnerNum] || 0) + 1;

    Audio.fanfare();

    const isLocalWin = winnerNum === G.playerNum;
    G.overlayText = isLocalWin ? 'You win the match!' : (G.isAIMode ? 'AI wins the match!' : 'You lost the match!');
    G.overlaySubtext = `Final: ${G.p1Score} - ${G.p2Score}   |   Press any key`;
    G.shakeIntensity = 8;
    G.shakeDur = 0.4;

    Particles.spawn(CFG.ARENA_W / 2, CFG.ARENA_H / 2, 50,
        winnerNum === 1 ? '#4488ff' : '#ff4466', 100, 500, 1.2);
    Particles.spawn(CFG.ARENA_W / 2, CFG.ARENA_H / 2, 30, '#ffaa22', 80, 300, 1.0);

    // Wait for keypress to continue
    const handler = () => {
        window.removeEventListener('keydown', handler);
        window.removeEventListener('mousedown', handler);
        if (G.state !== 'matchEnd') return;
        if (!G.isAIMode && G.net.isHost) {
            G.net.send({ type: 'nextMatch' });
        }
        startSelection();
    };

    setTimeout(() => {
        window.addEventListener('keydown', handler);
        window.addEventListener('mousedown', handler);
    }, 800);
}

// ===== GAME LOGIC ===========================================
function updateGame(dt) {
    // Countdown
    if (G.state === 'countdown') {
        G.countdownTimer += dt;
        const newVal = CFG.COUNTDOWN_SEC - Math.floor(G.countdownTimer);
        if (newVal !== G.countdownVal && newVal >= 1) {
            G.countdownVal = newVal;
            Audio.beep(440 + (CFG.COUNTDOWN_SEC - newVal) * 220, 0.15, 0.15);
        }
        if (G.countdownTimer >= CFG.COUNTDOWN_SEC) {
            G.state = 'playing';
            Audio.beep(1100, 0.2, 0.25);
        }
        return;
    }

    if (G.state !== 'playing') return;

    // Local player input
    const p = G.local;
    let ax = 0, ay = 0;
    if (G.keys['w'] || G.keys['arrowup']) ay = -1;
    if (G.keys['s'] || G.keys['arrowdown']) ay = 1;
    if (G.keys['a'] || G.keys['arrowleft']) ax = -1;
    if (G.keys['d'] || G.keys['arrowright']) ax = 1;

    // Normalize diagonal
    if (ax !== 0 && ay !== 0) {
        const inv = 1 / Math.SQRT2;
        ax *= inv;
        ay *= inv;
    }

    // Apply acceleration
    p.vx += ax * p.body.accel * dt;
    p.vy += ay * p.body.accel * dt;

    // Friction
    p.vx *= Math.pow(p.body.friction, dt * 60);
    p.vy *= Math.pow(p.body.friction, dt * 60);

    // Speed cap
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > p.body.maxSpeed) {
        const s = p.body.maxSpeed / speed;
        p.vx *= s;
        p.vy *= s;
    }

    // Position
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Arena bounds with bounce
    const minX = CFG.ARENA_PAD + p.body.radius;
    const maxX = CFG.ARENA_W - CFG.ARENA_PAD - p.body.radius;
    const minY = CFG.ARENA_PAD + p.body.radius;
    const maxY = CFG.ARENA_H - CFG.ARENA_PAD - p.body.radius;

    if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx) * CFG.WALL_BOUNCE; }
    if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx) * CFG.WALL_BOUNCE; }
    if (p.y < minY) { p.y = minY; p.vy = Math.abs(p.vy) * CFG.WALL_BOUNCE; }
    if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy) * CFG.WALL_BOUNCE; }

    // Body-body collision (push apart)
    const r = G.remote;
    const d = dist(p.x, p.y, r.x, r.y);
    const minDist = p.body.radius + r.body.radius;
    if (d < minDist && d > 0.1) {
        const overlap = minDist - d;
        const nx = (p.x - r.x) / d;
        const ny = (p.y - r.y) / d;
        // Push local player out (remote is authoritative over their own pos)
        p.x += nx * overlap * 0.6;
        p.y += ny * overlap * 0.6;
        // Bounce velocity
        const dot = p.vx * nx + p.vy * ny;
        if (dot < 0) {
            p.vx -= nx * dot * 1.2;
            p.vy -= ny * dot * 1.2;
        }
    }

    // Mouse angle
    p.mouseAngle = angle(p.x, p.y, G.mouseX, G.mouseY);

    // Sword swing
    const now = performance.now();

    if (G.mouseClicked && p.canSwing && !p.swinging) {
        p.swinging = true;
        p.swingStart = now;
        p.swingTargetAngle = p.mouseAngle;
        p.canSwing = false;
        Audio.whoosh();

        if (!G.isAIMode) G.net.send({ type: 'swing', angle: p.mouseAngle });
    }

    if (p.swinging) {
        const elapsed = now - p.swingStart;
        if (elapsed >= p.sword.swingDur) {
            p.swinging = false;
            p.swingCooldownEnd = now + p.sword.cooldown;
        } else {
            const arcRad = (p.sword.arcAngle * Math.PI) / 180;
            const t = elapsed / p.sword.swingDur;
            p.swordAngle = p.swingTargetAngle - arcRad / 2 + arcRad * t;

            // Add trail
            const tipX = p.x + Math.cos(p.swordAngle) * (p.body.radius + p.sword.length);
            const tipY = p.y + Math.sin(p.swordAngle) * (p.body.radius + p.sword.length);
            G.trails.push({ x: tipX, y: tipY, life: 0.15, maxLife: 0.15, color: p.color });
        }
    } else {
        // Sword follows mouse when not swinging
        p.swordAngle = p.mouseAngle;
        if (!p.canSwing && now >= p.swingCooldownEnd) {
            p.canSwing = true;
        }
    }

    // AI mode: run AI logic with full physics
    if (G.isAIMode) {
        updateAI(dt, now);
    } else {
        // Interpolate remote player position toward last received state
        if (G.remote._targetX !== undefined) {
            G.remote.x = lerp(G.remote.x, G.remote._targetX, 0.3);
            G.remote.y = lerp(G.remote.y, G.remote._targetY, 0.3);
        }
    }

    // Update remote player's swing
    if (G.remote.swinging) {
        const elapsed = now - r.swingStart;
        if (elapsed >= r.sword.swingDur) {
            r.swinging = false;
            r.swingCooldownEnd = now + r.sword.cooldown;
        } else {
            const arcRad = (r.sword.arcAngle * Math.PI) / 180;
            const t = elapsed / r.sword.swingDur;
            r.swordAngle = r.swingTargetAngle - arcRad / 2 + arcRad * t;

            const tipX = r.x + Math.cos(r.swordAngle) * (r.body.radius + r.sword.length);
            const tipY = r.y + Math.sin(r.swordAngle) * (r.body.radius + r.sword.length);
            G.trails.push({ x: tipX, y: tipY, life: 0.15, maxLife: 0.15, color: r.color });
        }
    } else {
        r.swordAngle = r.mouseAngle;
        if (!r.canSwing && now >= r.swingCooldownEnd) {
            r.canSwing = true;
        }
    }

    // Update trails
    for (let i = G.trails.length - 1; i >= 0; i--) {
        G.trails[i].life -= dt;
        if (G.trails[i].life <= 0) G.trails.splice(i, 1);
    }

    // Hit detection (host or AI mode)
    if (G.isAIMode || G.net.isHost) {
        const hitResult = checkHits(now);
        if (hitResult) {
            if (!G.isAIMode) G.net.send({ type: 'hit', winner: hitResult });
            handleHit(hitResult);
        }
    }

    // Send state (multiplayer only)
    if (!G.isAIMode && now - G.lastStateSend >= CFG.STATE_RATE) {
        G.lastStateSend = now;
        G.net.send({
            type: 'state',
            x: p.x, y: p.y,
            vx: p.vx, vy: p.vy,
            swordAngle: p.swordAngle,
            swinging: p.swinging,
            mouseAngle: p.mouseAngle,
        });
    }

    // mouseClicked is reset in gameLoop, not here
}

function checkHits(now) {
    // Check if P1's sword hits P2
    const h1 = checkSwordHit(G.p1, G.p2, now);
    const h2 = checkSwordHit(G.p2, G.p1, now);

    if (h1 && h2) return null; // Simultaneous – no point
    if (h1) return 1;
    if (h2) return 2;
    return null;
}

function checkSwordHit(attacker, target, now) {
    if (!attacker.swinging) return false;

    const elapsed = now - attacker.swingStart;
    if (elapsed < 0 || elapsed > attacker.sword.swingDur) return false;

    // Sword line
    const sAngle = attacker.swordAngle;
    const sStart_x = attacker.x + Math.cos(sAngle) * attacker.body.radius;
    const sStart_y = attacker.y + Math.sin(sAngle) * attacker.body.radius;
    const sEnd_x = attacker.x + Math.cos(sAngle) * (attacker.body.radius + attacker.sword.length);
    const sEnd_y = attacker.y + Math.sin(sAngle) * (attacker.body.radius + attacker.sword.length);

    return segCircle(sStart_x, sStart_y, sEnd_x, sEnd_y, target.x, target.y, target.body.radius);
}

// ===== AI LOGIC =============================================
function initAIState() {
    G.aiState = {
        behavior: 'approach',   // approach, circle, attack, retreat, dodge
        behaviorTimer: 0,       // time remaining in current behavior
        circleDir: 1,           // 1 or -1 for strafe direction
        reactionQueue: [],      // delayed actions: [{time, action}]
        lastSwingTime: 0,
        retreatAngle: 0,
        dodgeAngle: 0,
    };
}

function updateAI(dt, now) {
    const ai = G.remote;   // AI is always player 2 (remote)
    const pl = G.local;    // human is player 1
    const st = G.aiState;

    if (!st.behavior) initAIState();

    const d = dist(ai.x, ai.y, pl.x, pl.y);
    const angleToPlayer = angle(ai.x, ai.y, pl.x, pl.y);
    const attackRange = ai.body.radius + ai.sword.length + pl.body.radius + 15;
    const approachRange = attackRange + 80;

    // --- Reaction to player swinging: queue a dodge ---
    if (pl.swinging && st.behavior !== 'dodge' && d < attackRange + 40) {
        const reactionDelay = rand(0.15, 0.30);
        if (!st._dodgeQueued) {
            st._dodgeQueued = true;
            st.reactionQueue.push({
                time: now + reactionDelay * 1000,
                action: 'dodge',
            });
        }
    }
    if (!pl.swinging) st._dodgeQueued = false;

    // Process reaction queue
    for (let i = st.reactionQueue.length - 1; i >= 0; i--) {
        if (now >= st.reactionQueue[i].time) {
            const act = st.reactionQueue[i].action;
            st.reactionQueue.splice(i, 1);
            if (act === 'dodge' && st.behavior !== 'retreat') {
                st.behavior = 'dodge';
                st.behaviorTimer = rand(0.2, 0.4);
                // Dodge perpendicular to player's facing
                st.dodgeAngle = angleToPlayer + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
            }
        }
    }

    // --- Behavior timer ---
    st.behaviorTimer -= dt;

    // --- State transitions ---
    if (st.behaviorTimer <= 0) {
        if (st.behavior === 'dodge') {
            st.behavior = d < approachRange ? 'circle' : 'approach';
            st.behaviorTimer = rand(0.3, 0.8);
        } else if (st.behavior === 'retreat') {
            st.behavior = 'circle';
            st.behaviorTimer = rand(0.5, 1.2);
            st.circleDir = Math.random() < 0.5 ? 1 : -1;
        } else if (st.behavior === 'attack') {
            st.behavior = 'retreat';
            st.behaviorTimer = rand(0.3, 0.6);
            st.retreatAngle = angleToPlayer + Math.PI + rand(-0.5, 0.5);
        } else if (d > approachRange) {
            st.behavior = 'approach';
            st.behaviorTimer = rand(0.3, 0.6);
        } else if (d < attackRange && ai.canSwing && !ai.swinging) {
            st.behavior = 'attack';
            st.behaviorTimer = rand(0.1, 0.25);
        } else {
            st.behavior = 'circle';
            st.behaviorTimer = rand(0.5, 1.5);
            if (Math.random() < 0.3) st.circleDir *= -1;
        }
    }

    // Attempt attack from circle/approach when in range
    if ((st.behavior === 'circle' || st.behavior === 'approach') &&
        d < attackRange && ai.canSwing && !ai.swinging &&
        now - st.lastSwingTime > 400) {
        st.behavior = 'attack';
        st.behaviorTimer = rand(0.05, 0.15);
    }

    // --- Compute desired movement direction ---
    let ax = 0, ay = 0;

    switch (st.behavior) {
        case 'approach': {
            ax = Math.cos(angleToPlayer);
            ay = Math.sin(angleToPlayer);
            break;
        }
        case 'circle': {
            const strafeAngle = angleToPlayer + (Math.PI / 2) * st.circleDir;
            // Slight inward drift to maintain range
            const drift = d > approachRange ? 0.4 : (d < attackRange - 20 ? -0.3 : 0);
            ax = Math.cos(strafeAngle) + Math.cos(angleToPlayer) * drift;
            ay = Math.sin(strafeAngle) + Math.sin(angleToPlayer) * drift;
            break;
        }
        case 'attack': {
            // Move slightly toward player during attack wind-up
            ax = Math.cos(angleToPlayer) * 0.5;
            ay = Math.sin(angleToPlayer) * 0.5;
            break;
        }
        case 'retreat': {
            ax = Math.cos(st.retreatAngle);
            ay = Math.sin(st.retreatAngle);
            break;
        }
        case 'dodge': {
            ax = Math.cos(st.dodgeAngle);
            ay = Math.sin(st.dodgeAngle);
            break;
        }
    }

    // Normalize
    const mag = Math.hypot(ax, ay);
    if (mag > 0.01) { ax /= mag; ay /= mag; }

    // --- Apply same physics as local player ---
    ai.vx += ax * ai.body.accel * dt;
    ai.vy += ay * ai.body.accel * dt;

    ai.vx *= Math.pow(ai.body.friction, dt * 60);
    ai.vy *= Math.pow(ai.body.friction, dt * 60);

    const speed = Math.hypot(ai.vx, ai.vy);
    if (speed > ai.body.maxSpeed) {
        const s = ai.body.maxSpeed / speed;
        ai.vx *= s;
        ai.vy *= s;
    }

    ai.x += ai.vx * dt;
    ai.y += ai.vy * dt;

    // Arena bounds with bounce
    const minX = CFG.ARENA_PAD + ai.body.radius;
    const maxX = CFG.ARENA_W - CFG.ARENA_PAD - ai.body.radius;
    const minY = CFG.ARENA_PAD + ai.body.radius;
    const maxY = CFG.ARENA_H - CFG.ARENA_PAD - ai.body.radius;

    if (ai.x < minX) { ai.x = minX; ai.vx = Math.abs(ai.vx) * CFG.WALL_BOUNCE; }
    if (ai.x > maxX) { ai.x = maxX; ai.vx = -Math.abs(ai.vx) * CFG.WALL_BOUNCE; }
    if (ai.y < minY) { ai.y = minY; ai.vy = Math.abs(ai.vy) * CFG.WALL_BOUNCE; }
    if (ai.y > maxY) { ai.y = maxY; ai.vy = -Math.abs(ai.vy) * CFG.WALL_BOUNCE; }

    // Body-body collision (push AI out)
    const bd = dist(ai.x, ai.y, pl.x, pl.y);
    const minDist = ai.body.radius + pl.body.radius;
    if (bd < minDist && bd > 0.1) {
        const overlap = minDist - bd;
        const nx = (ai.x - pl.x) / bd;
        const ny = (ai.y - pl.y) / bd;
        ai.x += nx * overlap * 0.6;
        ai.y += ny * overlap * 0.6;
        const dot = ai.vx * nx + ai.vy * ny;
        if (dot < 0) {
            ai.vx -= nx * dot * 1.2;
            ai.vy -= ny * dot * 1.2;
        }
    }

    // --- Sword aiming ---
    // AI aims toward player with slight inaccuracy
    const aimNoise = rand(-0.15, 0.15);
    ai.mouseAngle = angleToPlayer + aimNoise;

    // --- Swing decision ---
    if (st.behavior === 'attack' && ai.canSwing && !ai.swinging) {
        ai.swinging = true;
        ai.swingStart = now;
        ai.swingTargetAngle = angleToPlayer + rand(-0.2, 0.2);
        ai.canSwing = false;
        st.lastSwingTime = now;
        st.behavior = 'retreat';
        st.behaviorTimer = rand(0.3, 0.6);
        st.retreatAngle = angleToPlayer + Math.PI + rand(-0.5, 0.5);
        Audio.whoosh();
    }
}

// ===== RENDERING ============================================
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    G.canvas.width = window.innerWidth * dpr;
    G.canvas.height = window.innerHeight * dpr;

    // Calculate scale to fit arena
    const scaleX = G.canvas.width / CFG.ARENA_W;
    const scaleY = G.canvas.height / CFG.ARENA_H;
    G.scale = Math.min(scaleX, scaleY) * 0.92; // 92% to leave margin
    G.offsetX = (G.canvas.width - CFG.ARENA_W * G.scale) / 2;
    G.offsetY = (G.canvas.height - CFG.ARENA_H * G.scale) / 2;
}

function render() {
    const ctx = G.ctx;
    const w = G.canvas.width;
    const h = G.canvas.height;

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    if (G.state === 'menu' || G.state === 'lobby' || G.state === 'select') return;

    ctx.save();

    // Screen shake
    let sx = 0, sy = 0;
    if (G.shakeDur > 0) {
        sx = (Math.random() * 2 - 1) * G.shakeIntensity;
        sy = (Math.random() * 2 - 1) * G.shakeIntensity;
    }

    ctx.translate(G.offsetX + sx, G.offsetY + sy);
    ctx.scale(G.scale, G.scale);

    // Arena background
    drawArena(ctx);

    // Trails
    for (const t of G.trails) {
        const alpha = t.life / t.maxLife;
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Particles
    Particles.draw(ctx);

    // Players
    if (G.p1 && G.p2) {
        drawPlayer(ctx, G.p1);
        drawPlayer(ctx, G.p2);
    }

    // Score HUD
    drawHUD(ctx);

    // Overlay text (countdown, round end, match end)
    drawOverlay(ctx);

    ctx.restore();
}

function drawArena(ctx) {
    // Floor
    ctx.fillStyle = '#0e0e24';
    ctx.fillRect(0, 0, CFG.ARENA_W, CFG.ARENA_H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = gridSize; x < CFG.ARENA_W; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CFG.ARENA_H); ctx.stroke();
    }
    for (let y = gridSize; y < CFG.ARENA_H; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.ARENA_W, y); ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.moveTo(CFG.ARENA_W / 2, CFG.ARENA_PAD);
    ctx.lineTo(CFG.ARENA_W / 2, CFG.ARENA_H - CFG.ARENA_PAD);
    ctx.stroke();
    ctx.setLineDash([]);

    // Border
    ctx.strokeStyle = '#2a2a5a';
    ctx.lineWidth = 3;
    ctx.strokeRect(CFG.ARENA_PAD / 2, CFG.ARENA_PAD / 2,
        CFG.ARENA_W - CFG.ARENA_PAD, CFG.ARENA_H - CFG.ARENA_PAD);

    // Corner accents
    const cornerLen = 20;
    ctx.strokeStyle = '#4a4a8a';
    ctx.lineWidth = 3;
    const corners = [
        [CFG.ARENA_PAD / 2, CFG.ARENA_PAD / 2],
        [CFG.ARENA_W - CFG.ARENA_PAD / 2, CFG.ARENA_PAD / 2],
        [CFG.ARENA_W - CFG.ARENA_PAD / 2, CFG.ARENA_H - CFG.ARENA_PAD / 2],
        [CFG.ARENA_PAD / 2, CFG.ARENA_H - CFG.ARENA_PAD / 2],
    ];
    corners.forEach(([cx, cy], i) => {
        const dx = (i === 0 || i === 3) ? 1 : -1;
        const dy = (i < 2) ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx + dx * cornerLen, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * cornerLen);
        ctx.stroke();
    });
}

function drawPlayer(ctx, player) {
    const p = player;

    // Sword
    const sAngle = p.swordAngle;
    const sStartDist = p.body.radius;
    const sEndDist = p.body.radius + p.sword.length;

    const sx1 = p.x + Math.cos(sAngle) * sStartDist;
    const sy1 = p.y + Math.sin(sAngle) * sStartDist;
    const sx2 = p.x + Math.cos(sAngle) * sEndDist;
    const sy2 = p.y + Math.sin(sAngle) * sEndDist;

    // Sword glow when swinging
    if (p.swinging) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.lineWidth = p.sword.width + 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
        ctx.restore();
    }

    // Sword blade
    ctx.save();
    ctx.strokeStyle = p.swinging ? '#ffffff' : 'rgba(200, 210, 230, 0.6)';
    ctx.lineWidth = p.sword.width;
    ctx.lineCap = 'round';
    if (p.swinging) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
    }
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();

    // Sword tip
    ctx.fillStyle = p.swinging ? '#ffeecc' : 'rgba(200, 210, 230, 0.5)';
    ctx.beginPath();
    ctx.arc(sx2, sy2, p.sword.width * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Guard (small line perpendicular to sword at base)
    const guardLen = p.sword.width * 2 + 2;
    const perpAngle = sAngle + Math.PI / 2;
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx1 + Math.cos(perpAngle) * guardLen, sy1 + Math.sin(perpAngle) * guardLen);
    ctx.lineTo(sx1 - Math.cos(perpAngle) * guardLen, sy1 - Math.sin(perpAngle) * guardLen);
    ctx.stroke();

    // Body
    drawShape(ctx, p.body.shape, p.x, p.y, p.body.radius, p.color, p.glowColor);

    // Eyes (look toward sword direction)
    const lookAngle = p.swinging ? p.swordAngle : p.mouseAngle;
    drawEyes(ctx, p.body.shape, p.x, p.y, p.body.radius, lookAngle);

    // Cooldown indicator
    if (!p.canSwing && !p.swinging) {
        const now = performance.now();
        const cdLeft = (p.swingCooldownEnd - now) / p.sword.cooldown;
        if (cdLeft > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.body.radius + 5, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * (1 - cdLeft));
            ctx.stroke();
        }
    }
}

function drawHUD(ctx) {
    const midX = CFG.ARENA_W / 2;
    const y = 18;

    // Score
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 28px Bungee, monospace';

    // P1 score
    ctx.fillStyle = G.p1 ? G.p1.color : '#4488ff';
    ctx.fillText(G.p1Score, midX - 40, y);

    // Dash
    ctx.fillStyle = '#555';
    ctx.fillText('-', midX, y);

    // P2 score
    ctx.fillStyle = G.p2 ? G.p2.color : '#ff4466';
    ctx.fillText(G.p2Score, midX + 40, y);

    // Round indicator
    ctx.font = '12px Outfit, sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText(`Round ${G.roundNum}`, midX, y + 32);

    // Player labels
    ctx.font = '11px Outfit, sans-serif';
    const oppLabel = G.isAIMode ? 'AI' : 'OPP';
    if (G.p1) {
        ctx.fillStyle = G.p1.color;
        ctx.textAlign = 'left';
        ctx.fillText(G.playerNum === 1 ? 'YOU' : oppLabel, CFG.ARENA_PAD, y);
    }
    if (G.p2) {
        ctx.fillStyle = G.p2.color;
        ctx.textAlign = 'right';
        ctx.fillText(G.playerNum === 2 ? 'YOU' : oppLabel, CFG.ARENA_W - CFG.ARENA_PAD, y);
    }
    ctx.textAlign = 'center';
}

function drawOverlay(ctx) {
    const midX = CFG.ARENA_W / 2;
    const midY = CFG.ARENA_H / 2;

    if (G.state === 'countdown') {
        const val = G.countdownVal;
        const timer = G.countdownTimer;
        const frac = timer - Math.floor(timer);

        // Animated countdown number
        const scale = 1 + (1 - frac) * 0.5;
        const alpha = frac < 0.7 ? 1 : 1 - (frac - 0.7) / 0.3;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(midX, midY);
        ctx.scale(scale, scale);
        ctx.font = 'bold 80px Bungee, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffaa22';
        ctx.shadowColor = '#ffaa22';
        ctx.shadowBlur = 30;
        ctx.fillText(val <= 0 ? 'GO!' : val, 0, 0);
        ctx.restore();

        // Control hint on first round
        if (G.roundNum === 1 && G.countdownVal === CFG.COUNTDOWN_SEC) {
            ctx.font = '14px Outfit, sans-serif';
            ctx.fillStyle = 'rgba(200,200,220,0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('WASD to move  •  Click to swing', midX, CFG.ARENA_H - 20);
        }
        return;
    }

    if (G.state === 'roundEnd' || G.state === 'matchEnd') {
        // Dim background
        ctx.fillStyle = 'rgba(10, 10, 26, 0.5)';
        ctx.fillRect(0, 0, CFG.ARENA_W, CFG.ARENA_H);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.font = 'bold 36px Bungee, monospace';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffaa22';
        ctx.shadowBlur = 20;
        ctx.fillText(G.overlayText, midX, midY - 20);

        ctx.shadowBlur = 0;
        ctx.font = '20px Outfit, sans-serif';
        ctx.fillStyle = '#aaaacc';
        ctx.fillText(G.overlaySubtext, midX, midY + 25);
    }
}

// ===== MAIN LOOP ============================================
function gameLoop(timestamp) {
    if (!G.lastTime) G.lastTime = timestamp;
    const dt = Math.min((timestamp - G.lastTime) / 1000, 0.05); // cap at 50ms
    G.lastTime = timestamp;

    // Update shake
    if (G.shakeDur > 0) {
        G.shakeDur -= dt;
        if (G.shakeDur <= 0) {
            G.shakeIntensity = 0;
        }
    }

    // Update particles
    Particles.update(dt);

    // Game logic
    updateGame(dt);

    // Render
    render();

    // Reset click
    G.mouseClicked = false;

    requestAnimationFrame(gameLoop);
}

// ===== INIT =================================================
function init() {
    G.canvas = document.getElementById('game-canvas');
    G.ctx = G.canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    initInput();
    initUI();

    requestAnimationFrame(gameLoop);
}

// Wait for DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
