class Joypad {
    constructor(cpu) {
        this.cpu = cpu;
        this.previousState = 0xFF; // All buttons up

        // Input management is done in the global variable "Input" (script input.js)
    }

    Update() {
        // P1 register is at 0xFF00
        let p1 = this.cpu.memory[0xFF00];
        
        // Start with the current selection bits (4 and 5) and set input bits to high (unpressed)
        let p1Input = 0x0F;

        // Bit 5: Action buttons (0=selected)
        if ((p1 & 0x20) === 0) {
            if (Input.IsKeyPressed(KEY_A    )) p1Input &= ~0x01;
            if (Input.IsKeyPressed(KEY_Z    )) p1Input &= ~0x02;
            if (Input.IsKeyPressed(KEY_SPACE)) p1Input &= ~0x04;
            if (Input.IsKeyPressed(KEY_ENTER)) p1Input &= ~0x08;
        }

        // Bit 4: Direction buttons (0=selected)
        if ((p1 & 0x10) === 0) {
            if (Input.IsKeyPressed(KEY_RIGHT)) p1Input &= ~0x01;
            if (Input.IsKeyPressed(KEY_LEFT )) p1Input &= ~0x02;
            if (Input.IsKeyPressed(KEY_UP   )) p1Input &= ~0x04;
            if (Input.IsKeyPressed(KEY_DOWN )) p1Input &= ~0x08;
        }

        // If any button bit changed from 1 (unpressed) to 0 (pressed), request an interrupt
        const newlyPressed = this.previousState & (~p1Input);
        if (newlyPressed !== 0) {
            this.cpu.RequestInterrupt(this.cpu.INT.JOYPAD);
        }
        this.previousState = p1Input;

        // Combine selection bits with input bits and write back to memory
        // Unused bits 7 and 6 are kept high.
        this.cpu.memory[0xFF00] = (p1 & 0x30) | p1Input | 0xC0;
    }
}