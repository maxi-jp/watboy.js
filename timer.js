class GameBoyTimer {

    get DIV () { return this.memory[0xFF04]; }
    get TIMA() { return this.memory[0xFF05]; }
    get TMA () { return this.memory[0xFF06]; }
    get TAC () { return this.memory[0xFF07]; }

    set DIV (v) { this.memory[0xFF04] = v}
    set TIMA(v) { this.memory[0xFF05] = v}
    set TMA (v) { this.memory[0xFF06] = v}
    set TAC (v) { this.memory[0xFF07] = v}

    constructor(cpu, memory) {
        this.cpu = cpu;
        this.memory = memory;

        this.timer = 0;

        // Frequencies in Hz: 4096, 262144, 65536, 16384
        this.clockDividers = [1024, 16, 64, 256]; // CPU Clock (4194304 Hz) dividers
    }

    update(cycles) {
        // TODO update the DIV register internal clock

        // Check if timer is enabled (bit 2 of TAC)
        if (this.TAC & 0x04) {
            // Increment internal counter
            this.timer += cycles;

            // Get clock select bits from TAC
            const freqBits = this.TAC & 0x03;
            const divider = this.clockDividers[freqBits];

            console.log(`Timer update: cycles=${cycles}, timerCounter=${this.timer}, TIMA=0x${this.TIMA.toString(16)}, divider=${divider}`);

            // Check if we need to increment TIMA
            while (this.timer >= divider) {
                this.timer -= divider;
                
                // Increment TIMA
                this.TIMA++;
                console.log(`TIMA incremented to 0x${this.TIMA.toString(16)}`);

                // Check for TIMA overflow
                if (this.TIMA > 0xFF) {
                    // Reset TIMA to TMA value and request interrupt
                    this.TIMA = this.TMA; // Load from TMA
                    this.cpu.requestInterrupt(this.cpu.INT.TIMER); // Request timer interrupt
                    
                    console.log(`Timer overflow: TIMA reset to 0x${this.TMA.toString(16)}, interrupt requested, IF=0x${this.memory[0xFF0F].toString(16)}, A=0x${this.registers.A.toString(16)}`);
                }
            }
        }
    }
}