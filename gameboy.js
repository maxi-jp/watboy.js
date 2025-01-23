class GameBoy {
    constructor() {
        this.screenWidth = 160;
        this.screenHeight = 144;
        this.cpu = null;
        this.gpu = null;
        this.romLoaded = null;
    }

    Initialize(canvas, ctx) {
        this.cpu = new GameBoyCPU();
        this.gpu = new GameBoyGPU(canvas, ctx, this.screenWidth, this.screenHeight);
    }
    
    UpdateFrameBuffer() {
        for (let i = 0; i < this.screenWidth * this.screenHeight; i++) {
            const vramAddress = 0x8000 + i;  // Calculate corresponding VRAM address
            this.gpu.frameBuffer[i] = this.cpu.memory[vramAddress]; // Fetch pixel data
        }
    }

    LoadRom(romData) {
        this.romLoaded = romData;
        this.cpu.loadROM(romData);
        this.cpu.start(); // Start the emulation
        //gameboy.cpu.run(); 
    }

    RunFullCycle() {
        let vblank = false;
        while (!vblank) {
            this.cpu.runStep();

            vblank = this.gpu.update();
        }
    }

    RunCPUStep() {
        this.cpu.runStep();
    }

    GPURender() {
        this.gpu.drawFrame();
    }
}