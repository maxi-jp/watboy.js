class GameBoyTimer {

    get DIV () { return this.memory[0xFF04]; }
    get TIMA() { return this.memory[0xFF05]; } // Timer counter
    get TMA () { return this.memory[0xFF06]; }
    get TAC () { return this.memory[0xFF07]; }

    set DIV (v) { this.memory[0xFF04] = v; }
    set TIMA(v) { this.memory[0xFF05] = v; }
    set TMA (v) { this.memory[0xFF06] = v; }
    set TAC (v) { this.memory[0xFF07] = v; }

    constructor() {
        // Internal counters for DIV and TIMA, measured in T-cycles (CPU clock cycles)
        this.divCounter = 0;
        this.timaCounter = 0;

        // CPU clock cycles needed for one TIMA increment
        this.clockDividers = [1024, 16, 64, 256]; // CPU Clock (4194304 Hz) dividers
    }

    setCPU(cpu, memory) {
        this.cpu = cpu;
        this.memory = memory;
    }

    update(cycles) {
        // DIV update (increments every T-cycle)
        this.divCounter = (this.divCounter + cycles) & 0xFFFF; // Keep it 16-bit
        // The DIV register is the upper 8 bits of this 16-bit counter.
        // It increments at 16384 Hz (4194304 / 256).
        this.DIV = (this.divCounter >> 8);

        // TIMA Update (if timer is enabled (bit 2 of TAC))
        if ((this.TAC & 0x04) === 0) {
            return; // Timer is disabled
        }
        
        // Increment internal counter
        this.timaCounter += cycles;

        // Get the frequency divider from TAC
        const freqBits = this.TAC & 0x03;
        const divider = this.clockDividers[freqBits];

        console.log(`Timer update: cycles=${cycles}, timaCounter=${this.timaCounter}, TIMA=0x${this.TIMA.toString(16)}, divider=${divider}`);

        // Check if enough cycles have passed to increment TIMA
        while (this.timaCounter >= divider) {
            this.timaCounter -= divider;
            
            // Increment TIMA
            let tima = this.TIMA + 1;

            if (tima > 0xFF) {
                // Overflow occurred: reset TIMA to TMA value and request interrupt
                tima = this.TMA; // Reset TIMA to the value in TMA
                this.cpu.requestInterrupt(this.cpu.INT.TIMER); // Request a timer interrupt

                console.log(`Timer overflow: TIMA reset to 0x${this.TMA.toString(16)}, interrupt requested, IF=0x${this.memory[0xFF0F].toString(16)}, A=0x${this.cpu.registers.A.toString(16)}`);
            }
            
            this.TIMA = tima

            console.log(`TIMA incremented to 0x${this.TIMA.toString(16)}`);
        }
    }

    resetDiv() {
        this.divCounter = 0;
        this.DIV = 0;
    }
}