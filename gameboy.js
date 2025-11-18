class GameBoy {
    constructor() {
        this.screenWidth = 160;
        this.screenHeight = 144;
        this.cpu = null;
        this.gpu = null;
        this.timer = null;
        this.joypad = null;
        this.apu = null;
        this.romLoaded = null;
    }

    Initialize(canvas, ctx) {
        this.timer = new GameBoyTimer();
        this.cpu = new GameBoyCPU(this.timer);
        this.gpu = new GameBoyGPU(canvas, ctx, this.screenWidth, this.screenHeight, this.cpu);
        this.joypad = new Joypad(this.cpu);
        this.apu = new APU(this.cpu);

        this.timer.SetCPU(this.cpu, this.cpu.memory);
        this.cpu.SetGPU(this.gpu);
        this.cpu.SetAPU(this.apu);
    }
    
    LoadRom(romData) {
        this.romLoaded = romData;
        this.apu.Initialize(); // Initialize audio context on ROM load
        this.cpu.LoadROM(romData);
        this.cpu.Start(); // Start the emulation

        // this.cpu.PrintRegisters();
    }

    RunFrame() {
        const cyclesPerFrame = 70224; // Number of CPU cycles per frame
        let totalCycles = 0;

        while (totalCycles < cyclesPerFrame) {
            let cycles = 0;

            // Execute normal CPU instruction or handle halt
            if (!this.cpu.haltEnabled) {
                cycles = this.cpu.RunStep();
                this.cpu.steps++;

                // Process EI delay on instruction ticks
                if (this.cpu.imeCounter > 0) {
                    this.cpu.imeCounter--;
                    if (this.cpu.imeCounter === 0)
                        this.cpu.EnableInterrupts();
                }
            }
            else {
                cycles = 4; // If halted, just burn 4 cycles
            }

            // Update hardware components (they may set interrupt flags)
            this.timer.Update(cycles);
            this.gpu.Update(cycles);
            this.apu.Update(cycles);
            this.joypad.Update();

            // Check for interrupts AFTER hardware updates (matches reference implementations)
            const interruptCycles = this.cpu.HandleInterrupts();
            if (interruptCycles > 0)
                totalCycles += interruptCycles; // Add interrupt service cycles to total

            totalCycles += cycles;
        }
    }

    RunCPUStep() {
        this.cpu.RunStep();
    }

    GPURender() {
        this.gpu.DrawFrame();
    }

    SetColorPallete(id) {
        this.gpu.SetColorPallete(id);
    }

    SetAudioEnabled(enabled) {
        if (this.apu) {
            this.apu.SetEnabled(enabled);
        }
    }
}