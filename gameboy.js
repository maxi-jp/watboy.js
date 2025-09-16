class GameBoy {
    constructor() {
        this.screenWidth = 160;
        this.screenHeight = 144;
        this.cpu = null;
        this.gpu = null;
        this.timer = null;
        this.joypad = null;
        this.romLoaded = null;
    }

    Initialize(canvas, ctx) {
        this.timer = new GameBoyTimer();
        this.cpu = new GameBoyCPU(this.timer);
        this.gpu = new GameBoyGPU(canvas, ctx, this.screenWidth, this.screenHeight, this.cpu);
        this.joypad = new Joypad(this.cpu);

        this.timer.setCPU(this.cpu, this.cpu.memory);
    }
    
    LoadRom(romData) {
        this.romLoaded = romData;
        this.cpu.loadROM(romData);
        this.cpu.start(); // Start the emulation
    }

    RunFrame() {
        const cyclesPerFrame = 70224; // Number of CPU cycles per frame
        let cyclesThisFrame = 0;

        while (cyclesThisFrame < cyclesPerFrame) {
            const cycles = this.cpu.runStep();
            cyclesThisFrame += cycles;

            // In STOP mode, the timer and GPU are paused.
            // The CPU will burn cycles until a joypad press wakes it up.
            if (!this.cpu.stopEnabled) {
                this.timer.update(cycles);
                this.gpu.update(cycles);
            }
            else {
                // While in STOP mode, a joypad press will set an interrupt flag.
                // This doesn't service the interrupt, but it does wake the CPU.
                // We need to check for this condition to exit the STOP state.
                if ((this.cpu.IF & this.cpu.INT.JOYPAD) !== 0) {
                    this.cpu.stopEnabled = false;
                }
            }
            this.joypad.update();
        }
    }

    RunCPUStep() {
        this.cpu.runStep();
    }

    GPURender() {
        this.gpu.drawFrame();
    }
}