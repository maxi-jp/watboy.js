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
        this.gpu = new GameBoyGPU(canvas, ctx, this.screenWidth, this.screenHeight, this.cpu.memory);
    }
    
    LoadRom(romData) {
        this.romLoaded = romData;
        this.cpu.loadROM(romData);
        this.cpu.start(); // Start the emulation
        //gameboy.cpu.run(); 
    }

    RunFrame() {
        const cyclesPerFrame = 70224; // Number of CPU cycles per frame
        let cyclesThisFrame = 0;

        while (cyclesThisFrame < cyclesPerFrame) {
            const cycles = this.cpu.runStep();
            cyclesThisFrame += cycles;
            this.gpu.update(cycles);
        }
    }

    RunCPUStep() {
        this.cpu.runStep();
    }

    GPURender() {
        this.gpu.drawFrame();
    }
}