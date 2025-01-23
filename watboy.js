// GameBoy CPU Manual https://news.ycombinator.com/item?id=19663009
// test rooms https://github.com/retrio/gb-test-roms


var canvas = /** @type {HTMLCanvasElement} */(null);
var ctx = /** @type {CanvasRenderingContext2D} */(null);

var romInput = null;

const gameboy = new GameBoy();

const debugData = {
    registers: {
        a: null,
        b: null,
        c: null,
        d: null,
        e: null,
        f: null,
        h: null,
        l: null,
        sp: null,
        pc: null,
    },
    flags: {
        ie: null
    },
    lastInstruction: null
}

var requestAnimationFrameID = -1;

var targetDT = 1/60; // 60fps
var globalDT;
var time = 0,
    fps = 0,
    framesAcum = 0,
    acumDelta = 0;

function Init() {
    canvas = document.getElementById("myCanvas");
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // get html debug element references
    for (const prop in debugData.registers) {
        debugData.registers[prop] = document.getElementById(`reg_${prop}`);
    }
    for (const prop in debugData.flags) {
        debugData.flags[prop] = document.getElementById(`flags_${prop}`);
    }
    debugData.lastInstruction = document.getElementById('last_inst');

    // input setup
    SetupKeyboardEvents();
    SetupMouseEvents();

    gameboy.Initialize(canvas, ctx);
    
    updateDebugData();

    // load BIOS file
    /*loadBIOS('./bios.gb', () => {
        Start();
        Loop();
    });*/
    // room input field
    romInput = document.getElementById('fileInput');
    romInput.addEventListener('change', (event) => loadROM(event.target.files[0], () => {
        Start();
        Loop();
    }));
}

function Start() {
    // start the timer
    time = performance.now();
}

function Loop() {
    requestAnimationFrameID = requestAnimationFrame(Loop);

    // compute FPS
    let now = performance.now();
    let deltaTime = (now - time) / 1000;
    globalDT = deltaTime;

    time = now;

    framesAcum++;
    acumDelta += deltaTime;

    if (acumDelta >= 1) {
        fps = framesAcum;
        framesAcum = 0;
        acumDelta -= 1;
    }

    if (deltaTime > 1)
        return;

    if (Input.IsKeyDown(KEY_SPACE) || Input.IsKeyPressed(KEY_A)) {
        // Game logic ---------
        Update(deltaTime);
        
        // Draw the game ------
        Draw(ctx);
    }

    // reset input data ---
    Input.PostUpdate();
}

function Update(deltaTime) {
    gameboy.RunCPUStep();

    updateDebugData();

    gameboy.UpdateFrameBuffer();
}

function Draw(/** @type {CanvasRenderingContext2D} */ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    gameboy.GPURender();

    DrawStats(ctx);
}

function DrawStats(ctx) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(2, 2, 132, 54);

    ctx.fillStyle = "white";
    ctx.textAlign = "start";
    ctx.font = "12px Comic Sans MS regular";

    ctx.fillText("FPS: " + fps, 6, 14);
    ctx.fillText("FPS (dt): " + (1 / globalDT).toFixed(2), 6, 32);
    ctx.fillText("deltaTime (ms): " + (globalDT * 1000).toFixed(2), 6, 50);
}

async function loadBIOS(BIOSPath, onload) {
    try {
        const response = await fetch(BIOSPath);

        if (!response.ok) {
            throw new Error(`Failed to fetch BIOS file: ${response.statusText}`);
        }

        // Read the binary data
        const biosArrayBuffer = await response.arrayBuffer();
        const biosData = new Uint8Array(biosArrayBuffer);

        if (biosData.length < 0x00FF) {
            console.error("BIOS file is too small");
            return;
        }

        gameboy.cpu.loadBIOS(biosData);

        onload();
    }
    catch (error) {
        console.error(`Failed to load BIOS: ${error.message}`);
    }
}

function loadROM(file, onload) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const romData = new Uint8Array(e.target.result);
        if (romData.length < 0x0100) {
            console.error("ROM is too small");
            return;
        }
        gameboy.LoadRom(romData);
        onload();
    };
    reader.readAsArrayBuffer(file);
}

function updateDebugData() {
    for (const prop in debugData.registers) {
        const val = gameboy.cpu.registers[prop.toUpperCase()];
        const newStr = `0x${val.toString(16)} (${val})`;

        if (debugData.registers[prop].innerText !== newStr)
            debugData.registers[prop].classList.add('red');
        else
            debugData.registers[prop].classList.remove('red');
        
        debugData.registers[prop].innerText = newStr;
    }
    
    debugData.flags.ie.innerText = gameboy.cpu.interruptsEnabled;
    
    const newOpcode = `${gameboy.cpu.lastOpcodeHandlerName} (0x${gameboy.cpu.memory[gameboy.cpu.registers.lastPC].toString(16)})`;
    if (debugData.lastInstruction.innerText !== newOpcode)
        debugData.lastInstruction.classList.add('red');
    else
        debugData.lastInstruction.classList.remove('red');
    debugData.lastInstruction.innerText = newOpcode;
}

// Helper function to interpret an 8-bit value as signed
function signedValue(n) {
    return n < 0x80 ? n : n - 0x100;
}

const cartridgeHeaderAdress = [0x100, 0x14F];
const cartridgeNLogoAdress = [0x104, 0x133];
const cartridgeNameAdress = [0x134 , 0x143];
const cartridgeRegionAdress = 0x14a;
const cartridgeGBorSGBAdress = 0x146; // 0x80 = GB, 0x03 = SGB
const cartridgeTypeAddress = 0x147;
const romSizeTypeAdress = 0x148;
const ramSizeTypeAdress = 0x149;
const destinationCodeAdress = 0x14A; // 0x00 = Japanese, 0x01 = Non-Japanese
const oldLicenseeCodeAdress = 0x14B;
const maskROMVersionNumberAdress = 0x14C;
const headerChecksumAdress = 0x14D;
const globalChecksumAdress = [0x14E, 0x14F];

window.onload = Init;