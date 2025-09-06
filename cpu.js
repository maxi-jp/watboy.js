class GameBoyCPU {
    constructor() {
        // Private storage for 8-bit registers
        const _r = {
            A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, H: 0, L: 0, 
        };

        this.registers = {
            // 8-bit registers
            get A() { return _r.A; }, set A(v) { _r.A = v & 0xFF; },
            get B() { return _r.B; }, set B(v) { _r.B = v & 0xFF; },
            get C() { return _r.C; }, set C(v) { _r.C = v & 0xFF; },
            get D() { return _r.D; }, set D(v) { _r.D = v & 0xFF; },
            get E() { return _r.E; }, set E(v) { _r.E = v & 0xFF; },
            get F() { return _r.F; }, set F(v) { _r.F = v & 0xF0; }, // Lower 4 bits of F are always 0
            get H() { return _r.H; }, set H(v) { _r.H = v & 0xFF; },
            get L() { return _r.L; }, set L(v) { _r.L = v & 0xFF; },

            // 16-bit register pairs
            get BC() { return (_r.B << 8) | _r.C; }, set BC(v) { _r.B = (v >> 8) & 0xFF; _r.C = v & 0xFF; },
            get DE() { return (_r.D << 8) | _r.E; }, set DE(v) { _r.D = (v >> 8) & 0xFF; _r.E = v & 0xFF; },
            get HL() { return (_r.H << 8) | _r.L; }, set HL(v) { _r.H = (v >> 8) & 0xFF; _r.L = v & 0xFF; },

            SP: 0xFFFE, // Stack pointer
            PC: 0x0, // Program counter
            lastPC: 0 // copy of the last PC
        };

        this.memory = new Uint8Array(0x10000); // 64KB memory 
        // ROM bank 0 (16KB): 0x0000–0x3FFF
        // Switchable ROM bank (16KB): 0x4000–0x7FFF
        // VRAM: 0x8000–0x9FFF
        // External RAM (8KB): 0xA000–0xBFFF
        // Internal RAM (8KB): 0xC000–0xDFFF
        // Echo RAM (8KB): 0xE000–0xFDFF (copy of 0xC000–0xDFFF)
        // OAM (Sprite Attrib Memory): 0xFE00–0xFE9F
        // Empty but unusable for I/O: 0xFEA0–0xFEFF
        // I/O Registers: 0xFF00–0xFF4B
        // Empty but unusable for I/O: 0xFF4C–0xFF7F
        // HRAM (High RAM): 0xFF80–0xFFFE
        // Interrupt Enable Register: 0xFFFF

        this.memoryBankSize = 0x4000; // 2KB

        this.MBC = null;

        this.BIOSLoaded = false;
        this.BIOSExecuted = false;

        this.interruptsEnabled = false; // Disable interrupt handling
        this.stopEnabled = false;
        this.haltEnabled = false;

        this.opcodeHandlers = {
            0x00: this.opcodeNOP.bind(this),
            0x01: this.opcodeLD_BC_nn.bind(this),
            0x02: this.opcodeLD_BC_A.bind(this),
            0x03: this.opcodeINC_BC.bind(this),
            0x04: this.opcodeINC_B.bind(this),
            0x05: this.opcodeDEC_B.bind(this),
            0x06: this.opcodeLD_B_n.bind(this),
            0x08: this.opcodeLD_nn_SP.bind(this),
            0x0C: this.opcodeINC_C.bind(this),
            0x0D: this.opcodeDEC_C.bind(this),
            0x0E: this.opcodeLD_C_n.bind(this),
            0x0F: this.opcodeRRCA.bind(this),
            0x11: this.opcodeLD_DE_nn.bind(this),
            0x10: this.opcodeSTOP.bind(this),
            0x1D: this.opcodeDEC_E.bind(this),
            0x18: this.opcodeJR_n.bind(this),
            0x13: this.opcodeINC_DE.bind(this),
            0x1A: this.opcodeLD_A_DE.bind(this),
            0x20: this.opcodeJR_NZ_n.bind(this),
            0x21: this.opcodeLD_HL_nn.bind(this),
            0x22: this.opcodeLD_HLplus_A.bind(this),
            0x23: this.opcodeINC_HL.bind(this),
            0x24: this.opcodeINC_H.bind(this),
            0x26: this.opcodeLD_H_n.bind(this),
            0x2A: this.opcodeLD_A_HLplus.bind(this),
            0x2C: this.opcodeINC_L.bind(this),
            0x29: this.opcodeADD_HL_HL.bind(this),
            0x2D: this.opcodeDEC_L.bind(this),
            0x28: this.opcodeJR_Z_n.bind(this),
            0x30: this.opcodeJR_NC_n.bind(this),
            0x31: this.opcodeLD_SP_nn.bind(this),
            0x32: this.opcodeLD_HLm_A.bind(this),
            0x3C: this.opcodeINC_A.bind(this),
            0x3E: this.opcodeLD_A_n.bind(this),
            0x44: this.opcodeLD_B_H.bind(this),
            0x46: this.opcodeLD_B_HL.bind(this),
            0x4E: this.opcodeLD_C_HL.bind(this),
            0x56: this.opcodeLD_D_HL.bind(this),
            0x6F: this.opcodeLD_L_A.bind(this),
            0x6E: this.opcodeLD_L_HL.bind(this),
            0x73: this.opcodeLD_HL_E.bind(this),
            0x76: this.opcodeHALT.bind(this),
            0x77: this.opcodeLD_HL_A.bind(this),
            0x78: this.opcodeLD_A_B.bind(this),
            0x79: this.opcodeLD_A_C.bind(this),
            0x7B: this.opcodeLD_A_E.bind(this),
            0x7C: this.opcodeLD_A_H.bind(this),
            0x7D: this.opcodeLD_A_L.bind(this),
            0x7F: this.opcodeLD_A_A.bind(this),
            0x80: this.opcodeADD_A_B.bind(this),
            0x81: this.opcodeADD_A_C.bind(this),
            0x83: this.opcodeADD_A_E.bind(this),
            0x88: this.opcodeADC_A_B.bind(this),
            0x89: this.opcodeADC_A_C.bind(this),
            0x94: this.opcodeSUB_A_H.bind(this),
            0xAE: this.opcodeXOR_HL.bind(this),
            0xA9: this.opcodeXOR_C.bind(this),
            0xB1: this.opcodeOR_C.bind(this),
            0xB7: this.opcodeOR_A.bind(this),
            0xAF: this.opcodeXOR_A_A.bind(this),
            0xC1: this.opcodePOP_BC.bind(this),
            0xC6: this.opcodeADD_A_n.bind(this),
            0xC3: this.opcodeJP_nn.bind(this),
            0xC5: this.opcodePUSH_BC.bind(this),
            0xCB: this.opcodeCB.bind(this),
            0xC4: this.opcodeCALL_NZ_nn.bind(this),
            0xC9: this.opcodeRET.bind(this),
            0xCC: this.opcodeCALL_Z_nn.bind(this),
            0xCD: this.opcodeCALL_nn.bind(this),
            0xD5: this.opcodePUSH_DE.bind(this),
            0xD6: this.opcodeSUB_n.bind(this),
            0xD9: this.opcodeRETI.bind(this),
            0xD4: this.opcodeCALL_NC_nn.bind(this),
            0xDC: this.opcodeCALL_C_nn.bind(this),
            0xDF: this.opcodeRST_18H.bind(this),
            0xE1: this.opcodePOP_HL.bind(this),
            0xE5: this.opcodePUSH_HL.bind(this),
            0xE9: this.opcodeJP_HL.bind(this),
            0xE0: this.opcodeLDH_n_A.bind(this),
            0xE6: this.opcodeAND_n.bind(this),
            0xEA: this.opcodeLD_nn_A.bind(this),
            0xF1: this.opcodePOP_AF.bind(this),
            0xF0: this.opcodeLDAFromImmediateIO.bind(this),
            0xF3: this.opcodeDI.bind(this),
            0xF5: this.opcodePUSH_AF.bind(this),
            0xFA: this.opcodeLD_A_nn.bind(this),
            0xFE: this.opcodeCPAImmediate.bind(this),
            0xFF: this.opcodeRST38.bind(this),
        };

        this.lastOpcodeHandlerName = "";
    }

    reset() {
        // Initialize registers to their power-on state
        this.registers.A = 0x01; // Accumulator
        this.registers.F = 0xB0; // Flags
        this.registers.BC = 0x0013;
        this.registers.DE = 0x00D8;
        this.registers.HL = 0x014D;
        this.registers.SP = 0xFFFE; // Stack Pointer
        this.registers.PC = 0x0;    // Program Counter (after BIOS)
        this.registers.lastPC = 0x0;

        this.memory.fill(0);

        // Load BIOS (optional, if implemented)
        // Example: Load BIOS into memory (addresses 0x0000-0x00FF)
        // for (let i = 0; i < BIOS.length; i++) {
        //     this.memory[i] = BIOS[i];
        // }

        // Set memory with typical boot state values (after BIOS execution)
        this.memory[0xFF05] = 0x00; // TIMA
        this.memory[0xFF06] = 0x00; // TMA
        this.memory[0xFF07] = 0x00; // TAC
        this.memory[0xFF10] = 0x80; // NR10
        this.memory[0xFF11] = 0xBF; // NR11
        this.memory[0xFF12] = 0xF3; // NR12
        this.memory[0xFF14] = 0xBF; // NR14
        this.memory[0xFF16] = 0x3F; // NR21
        this.memory[0xFF17] = 0x00; // NR22
        this.memory[0xFF19] = 0xBF; // NR24
        this.memory[0xFF1A] = 0x7F; // NR30
        this.memory[0xFF1B] = 0xFF; // NR31
        this.memory[0xFF1C] = 0x9F; // NR32
        this.memory[0xFF1E] = 0xBF; // NR33
        this.memory[0xFF20] = 0xFF; // NR41
        this.memory[0xFF21] = 0x00; // NR42
        this.memory[0xFF22] = 0x00; // NR43
        this.memory[0xFF23] = 0xBF; // NR44
        this.memory[0xFF24] = 0x77; // NR50
        this.memory[0xFF25] = 0xF3; // NR51
        this.memory[0xFF26] = 0xF1; // NR52 (0xF0 on SGB)
        this.memory[0xFF40] = 0x91; // LCDC
        this.memory[0xFF42] = 0x00; // SCY
        this.memory[0xFF43] = 0x00; // SCX
        this.memory[0xFF45] = 0x00; // LYC
        this.memory[0xFF47] = 0xFC; // BGP
        this.memory[0xFF48] = 0xFF; // OBP0
        this.memory[0xFF49] = 0xFF; // OBP1
        this.memory[0xFF4A] = 0x00; // WY
        this.memory[0xFF4B] = 0x00; // WX
        this.memory[0xFFFF] = 0x00; // IE

        this.interruptsEnabled = this.stopEnabled = this.haltEnabled = false;
    }

    loadBIOS(biosData) {
        // Copy BIOS data into memory (0x0000 - 0x00FF)
        this.memory.set(biosData, 0x0000);

        this.BIOSLoaded = true;
        console.log('BIOS loaded successfully.');
    }

    unmapBIOS() {
        if (this.BIOSLoaded) {
            for (let i = 0; i < 0x100; i++) {
                this.memory[i] = this.memory[0x0100 + i];
            }
            this.BIOSLoaded = false;
            console.log('BIOS unmapped. Memory mapped to cartridge ROM.');
        }
    }

    loadROM(romData) {
        console.log("ROM size: " + romData.length);

        if (romData.length !== 0x10000) {
            // Check if ROM is the expected size (64KB)
            console.warn("Invalid ROM size. Expected 64KB, got " + romData.length);
        }

        if (romData.length < 0x0100) {
            console.error("Invalid ROM size (too small).");
            return;
        }
        if (romData.length > 0x10000) {
            console.warn("ROM is too large for standard Game Boy memory.");
            return;
        }

        // Check if the ROM size fits in the memory starting at 0x0100
        /*let startAddr = 0x0100; // after the BIOS
        let endAddr = startAddr + romData.length;
    
        if (endAddr > this.memory.length) {
            console.warn(`Error: Trying to set memory beyond bounds. End address: 0x${endAddr.toString(16)} exceeds 0xFFFF`);
            console.warn(`Will try to overwrite the BIOS section of the memory`);

            startAddr = 0x0;
            endAddr = startAddr + romData.length;
        }

        if (endAddr > 0x8000) {
            console.warn("ROM overlaps into VRAM space!");
        }

        try {
            this.reset();

            console.log(`Loading ROM into memory starting at ` + startAddr);
            // Load ROM into memory at 0x0100 (after the BIOS)
            this.memory.set(romData, startAddr);
            console.log("ROM successfully loaded into memory.");
        } catch (e) {
            console.error("Error during memory.set operation:", e);
        }
    
        // log a small segment of memory to confirm it was loaded correctly
        console.log("First few bytes of loaded ROM (at 0x0100): ", this.memory.slice(0x0100, 0x010F));
        console.log("First few bytes VRAM (at 0x8000): ", this.memory.slice(0x8100, 0x810F));

        //console.log("ROM loaded into memory at address 0x0100");*/

        let startAddr = 0x0;
        // load the first 2KB
        for (let i = 0; i < this.memoryBankSize; i++) {
            this.memory[i + startAddr] = romData[startAddr + i];
        }

        console.log("Loaded first 2KB of the ROM.");
        console.log(this.memory.slice(0x0, 0x100));

        console.log("Game name: ", this.getGameNameFromMemory())

        // check for the type of MBC
        // https://b13rg.github.io/Gameboy-MBC-Analysis/
        console.log("Cartrige ROM type: ", this.memory[cartridgeTypeAddress]);
        // 0: no bank controller (max ROM 32KB, max RAM 8KB), like Tetris
        this.MBC = {
            memory: this.memory,
        }

        // load ROM bank
        let romStart = 0x4000;
        for (let i = 0; i < this.memoryBankSize; i++) {
            this.memory[i + romStart] = romData[romStart + i];
        }

        // get the ram size
        let ramSize = this.memory[ramSizeTypeAdress];
        // MBC = 0, no need to load RAM
    }

    start() {
        if (this.BIOSLoaded) {
            this.registers.PC = 0x0000;
        }
        else {
            this.registers.PC = 0x0100;
        }
    }

    run() {
        // Execute instructions based on PC and handle cycles
        while (true) {
            this.runStep();
        }
    }

    runStep() {
        this.registers.lastPC = this.registers.PC;

        if (!this.BIOSExecuted && this.BIOSLoaded && this.registers.PC >= 0x0100) {
            // BIOS finished execution
            this.unmapBIOS(); // switch to cartridge ROM

            this.BIOSExecuted = true;
        }

        const opcode = this.memory[this.registers.PC]; // Fetch opcode
        const handler = this.opcodeHandlers[opcode];

        let elapsedClockTicks = 4; // Default cycles
        if (handler) {
            this.lastOpcodeHandlerName = handler.name.split(" ")[1].split("opcode")[1];
            // handlers returns their cycle count
            const cycles = handler();
            elapsedClockTicks = (cycles !== undefined) ? cycles : 4;
        }
        else {
            this.lastOpcodeHandlerName = "UNKNOWN";
            console.warn(`Unimplemented opcode: 0x${opcode.toString(16)} at address 0x${this.registers.PC.toString(16)}`);
            this.registers.PC++; // Skip the unhandled opcode
        }
        return elapsedClockTicks;
    }

    getGameNameFromMemory() {
        return String.fromCharCode(...this.memory.slice(cartridgeNameAdress[0], cartridgeNameAdress[1]));
    }

    /*
    executeOpcode(opcode) {
        switch (opcode) {
            case 0x00: // NOP - No operation
                // Does nothing, just moves to the next instruction
                this.registers.PC++;
                break;

            case 0x01: // LD BC, nn - Load 16-bit immediate value into BC register pair
                this.registers.C = this.memory[this.registers.PC + 1];
                this.registers.B = this.memory[this.registers.PC + 2];
                this.registers.PC += 3; // Opcode consumes 3 bytes
                break;

            case 0x02: // LD (BC), A - Store A into memory address BC
                const bc = (this.registers.B << 8) | this.registers.C;
                this.memory[bc] = this.registers.A;
                this.registers.PC++;
                break;

            case 0x03: // INC BC - Increment BC register pair
                this.registers.C++;
                if (this.registers.C === 0) {
                    this.registers.B++;
                }
                this.registers.PC++;
                break;

            case 0x04: // INC B - Increment B register
                this.registers.B++;
                this.setZeroFlag(this.registers.B);
                this.registers.PC++;
                break;

            case 0x05: // DEC B - Decrement B register
                this.registers.B--;
                this.setZeroFlag(this.registers.B);
                this.registers.PC++;
                break;

            case 0x06: // LD B, n - Load immediate value into B
                this.registers.B = this.memory[this.registers.PC + 1];
                this.registers.PC += 2; // Opcode consumes 2 bytes
                break;

            case 0x08: { // LD (nn), SP
                // Fetch the 16-bit address from the next two bytes in memory (little-endian)
                const lowByte = this.memory[this.registers.PC + 1];
                const highByte = this.memory[this.registers.PC + 2];
                const address = (highByte << 8) | lowByte;
            
                // Store the lower and upper bytes of SP into memory at the specified address
                this.memory[address] = this.registers.SP & 0xFF;         // Low byte of SP
                this.memory[address + 1] = (this.registers.SP >> 8) & 0xFF; // High byte of SP
            
                // Increment the Program Counter
                this.registers.PC += 3; // Instruction size is 3 bytes
            }    break;

            case 0x0C: // INC C
                this.registers.C = (this.registers.C + 1) & 0xFF; // Increment C and ensure it stays within 8 bits
            
                // Update the flags
                this.setZeroFlag(this.registers.C); // Set Z flag if result is 0
                this.clearSubtractFlag();           // Clear N flag since this is not a subtraction
                this.setHalfCarryFlag(this.registers.C - 1, 1); // Check for half-carry during addition
            
                // Increment the Program Counter
                this.registers.PC++; // 1-byte instruction
                break;

            case 0x0D: // DEC C
                this.registers.C = (this.registers.C - 1) & 0xFF; // Decrement C and ensure it stays within 8 bits
            
                // Update the flags
                this.setZeroFlag(this.registers.C); // Set Z flag if result is 0
                this.setSubtractFlag();            // Set N flag since this is a subtraction
                this.setHalfCarryFlag(this.registers.C + 1, 1); // Check for half-carry during subtraction
            
                // Increment the Program Counter
                this.registers.PC++; // 1-byte instruction
                break;

            case 0x0E: // LD C, n
                this.registers.C = this.memory[this.registers.PC + 1]; // Fetch the immediate value

                this.registers.PC += 2; // Increment PC by 2 (opcode + immediate value)
                break;

            case 0x10: // STOP - Halt the CPU
                console.log("STOP instruction executed");
                this.registers.PC++;
                break;

            case 0x30: // JR NZ, nn - Jump to address (PC + signed nn) if Zero flag is not set
                const offset = this.memory[this.registers.PC + 1]; // Fetch the signed offset (byte at PC + 1)
                
                // Check if the Zero flag is not set (NZ condition)
                if ((this.registers.F & 0x80) === 0) {
                    // If Zero flag is not set, perform the jump
                    this.registers.PC += offset; // Jump to the new address (PC + signed offset)
                }
                else {
                    // If Zero flag is set, do nothing (just increment PC normally)
                    this.registers.PC++; // Move to the next instruction
                }
                break;

            case 0x31: { // LD SP, nn - Load 16-bit immediate value into SP
                // Fetch the 16-bit immediate value from memory
                const lowByte = this.memory[this.registers.PC + 1]; // Fetch low byte
                const highByte = this.memory[this.registers.PC + 2]; // Fetch high byte
                
                // Combine the low and high bytes into a 16-bit value (nn)
                this.registers.SP = (highByte << 8) | lowByte;
            
                // Increment the program counter to point to the next instruction
                this.registers.PC += 2;
                }
                break;

            case 0x3C: // INC A
                this.registers.A = (this.registers.A + 1) & 0xFF; // Increment A and keep it within 8 bits
            
                // Update flags
                this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
                this.registers.F &= ~0x40;         // Clear N flag (bit 6)
                if ((this.registers.A & 0x0F) === 0) {
                    this.registers.F |= 0x20;      // Set H flag (bit 5) if carry from bit 3
                }
                else {
                    this.registers.F &= ~0x20;     // Clear H flag (bit 5)
                }

                this.registers.PC++; // Increment the Program Counter
                break;

            case 0x6E: { // LD L, (HL)
                const hlAddress = (this.registers.H << 8) | this.registers.L; // Combine H and L registers into a 16-bit address
                this.registers.L = this.memory[hlAddress]; // Load the value from memory at address HL into register L

                this.registers.PC++; // Increment the Program Counter
            }    break;

            case 0x73: // LD (HL), E
                const hlAddress = (this.registers.H << 8) | this.registers.L; // Combine H and L to form the 16-bit address
                this.memory[hlAddress] = this.registers.E; // Store the value of register E into memory at HL

                this.registers.PC++; // Increment the Program Counter
                break;
            
            case 0x76: // HALT - Freeze the CPU until reset
                console.log("HALT instruction executed");
                this.registers.PC++;
                break;
            
            case 0x7F: // LD A, A
                // No operation, just move to the next instruction
                this.registers.PC++; // 1-byte instruction
                break;

            case 0x80: // ADD A, B - Add B to A
                this.add(this.registers.B);
                this.registers.PC++; // 1-byte instruction
                break;

            case 0x81: // ADD A, C - Add C to A
                this.add(this.registers.C);
                this.registers.PC++; // 1-byte instruction
                break;

            case 0x83: { // ADD A, E
                const value = this.registers.E; // Get the value of register E
                const result = this.registers.A + value; // Perform the addition
            
                // Update the A register with the lower 8 bits of the result
                this.registers.A = result & 0xFF;
            
                // Use the updateFlags method to handle Z, H, and C flags
                this.updateFlags(result);
            
                // Increment the Program Counter
                this.registers.PC++; // 1-byte instruction
                }
                break;

            case 0x88: { // ADC A, B
                const carry = (this.registers.F & 0x10) ? 1 : 0; // Extract the carry flag (C)
                const value = this.registers.B; // Value to add from register B
                const result = this.registers.A + value + carry; // Add A, B, and carry
            
                this.registers.A = result & 0xFF; // Store the lower 8 bits back in A
            
                // Update flags
                this.setZeroFlag(this.registers.A); // Set Z flag if the result is zero
                this.setSubtractFlag(false); // Clear N flag (this is an addition)
                this.setHalfCarryFlag((this.registers.A - value - carry) & 0xF, (value + carry) & 0xF); // Set H flag
                this.setCarryFlag(result); // Set C flag if there's a carry out of bit 7
            
                this.registers.PC++; // Increment the Program Counter
            }   break;

            case 0x89: { // ADC A, C
                const carry = (this.registers.F & 0x10) ? 1 : 0; // Extract the carry flag (C)
                const value = this.registers.C; // Value to add from register C
                const result = this.registers.A + value + carry; // Add A, C, and carry

                this.registers.A = result & 0xFF; // Store the lower 8 bits back in A

                // Update flags
                this.setZeroFlag(this.registers.A); // Set Z flag if the result is zero
                this.setSubtractFlag(false); // Clear N flag (this is an addition)
                this.setHalfCarryFlag((this.registers.A - value - carry) & 0xF, (value + carry) & 0xF); // Set H flag
                this.setCarryFlag(result); // Set C flag if there's a carry out of bit 7

                this.registers.PC++; // Increment the Program Counter
            }    break;
            
            case 0xC3: // JP nn - Jump to address nn (16-bit immediate)
                const lowByte = this.memory[this.registers.PC + 1];  // Fetch lower byte (byte at PC+1)
                const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte (byte at PC+2)
                
                // Combine the two bytes into a 16-bit address (little-endian format)
                const address = (highByte << 8) | lowByte;
                
                this.registers.PC = address; // Set PC to the new address
                break;

            case 0xC9: { // RET - Return from subroutine
                // Pop the 16-bit return address from the stack
                const lowByte = this.memory[this.registers.SP];       // Fetch the lower byte from the stack
                const highByte = this.memory[this.registers.SP + 1];  // Fetch the higher byte from the stack
                
                // Combine the two bytes into a 16-bit address (little-endian format)
                const returnAddress = (highByte << 8) | lowByte;
                
                // Set the program counter (PC) to the return address
                this.registers.PC = returnAddress;
                
                // Increment the stack pointer (SP) by 2 to pop the return address
                this.registers.SP += 2;
            }   break;

            case 0xCC: // CALL Z, nn
                if (this.registers.F & 0x80) { // Check if the Zero flag (Z) is set
                    const lowByte = this.memory[this.registers.PC + 1];  // Fetch the lower byte of the address
                    const highByte = this.memory[this.registers.PC + 2]; // Fetch the higher byte of the address
                    const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address

                    // Push the current PC + 3 (next instruction) onto the stack
                    this.registers.SP -= 2; // Decrement SP by 2 to reserve space
                    this.memory[this.registers.SP] = (this.registers.PC + 3) & 0xFF;         // Store lower byte of PC
                    this.memory[this.registers.SP + 1] = ((this.registers.PC + 3) >> 8);    // Store higher byte of PC

                    this.registers.PC = address; // Jump to the subroutine
                }
                else {
                    this.registers.PC += 3; // Skip the immediate value if condition is not met
                }
                break;

            case 0xD6: // SUB n - Subtract immediate value n from A
                const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n (byte at PC + 1)
                
                // Perform the subtraction
                const result = this.registers.A - n;
            
                // Update the A register with the result (only lower 8 bits)
                this.registers.A = result & 0xFF;
                
                // Update the flags
                this.setSubtractFlag(); // Set N flag
                this.setZeroFlag(this.registers.A); // Set Z flag based on the result
                this.setHalfCarryFlag(this.registers.A, n); // Set H flag for half carry
                this.setCarryFlag(result); // Set C flag for carry/borrow
                
                this.registers.PC++; // Move to the next instruction
                break;

            case 0xD9: { // RETI - Return and enable interrupts
                // Pop the 16-bit return address from the stack
                const lowByte = this.memory[this.registers.SP];
                const highByte = this.memory[this.registers.SP + 1];
                const returnAddress = (highByte << 8) | lowByte;
            
                // Update the program counter
                this.registers.PC = returnAddress;
            
                // Increment the stack pointer by 2 (popping the address)
                this.registers.SP += 2;
            
                // Enable interrupts
                this.interruptsEnabled = true;
            
                console.log("RETI executed, returning to 0x" + returnAddress.toString(16));
            }   break;

            case 0xDC: // CALL C, nn
                if (this.registers.F & 0x10) { // Check if the Carry flag (C) is set
                    const lowByte = this.memory[this.registers.PC + 1];  // Fetch the lower byte of the address
                    const highByte = this.memory[this.registers.PC + 2]; // Fetch the higher byte of the address
                    const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address
            
                    // Push the current PC + 3 (next instruction) onto the stack
                    this.registers.SP -= 2; // Decrement SP by 2 to reserve space
                    this.memory[this.registers.SP] = (this.registers.PC + 3) & 0xFF;         // Store lower byte of PC
                    this.memory[this.registers.SP + 1] = ((this.registers.PC + 3) >> 8);    // Store higher byte of PC
            
                    this.registers.PC = address; // Jump to the subroutine
                }
                else {
                    this.registers.PC += 3; // Skip the immediate value if condition is not met
                }
                break;

            case 0xDF: // RST 18H
                // restart instruction
                // Push the current PC onto the stack
                this.memory[--this.registers.SP] = (this.registers.PC >> 8) & 0xFF; // High byte
                this.memory[--this.registers.SP] = this.registers.PC & 0xFF;        // Low byte
            
                // Set the PC to 0x0018
                this.registers.PC = 0x0018;
                break;

            case 0xE6: // AND n
                const immediateValue = this.memory[this.registers.PC + 1]; // Fetch the immediate 8-bit value
                this.registers.A &= immediateValue; // Perform bitwise AND and store result in A
            
                // Update flags
                this.registers.F = 0; // Clear all flags
                this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
                this.registers.F |= 0x20; // Set H flag (bit 5), always set for AND
            
                this.registers.PC += 2; // Advance PC by 2 (1 for opcode + 1 for immediate value)
                break;

            case 0xF3: // DI - Disable interrupts
                this.disableInterrupts(); // Disable interrupt handling
                this.registers.PC++; // Move to the next instruction
                break;

            // Add more opcodes as needed...
            default:
                console.log(`Unimplemented opcode: ${opcode.toString(16)}`);
                this.registers.PC++; // Move to the next instruction
                break;
        }
    }
    */

    // Helper function to add a value to the A register and update flags
    add(value) {
        const originalA = this.registers.A;
        const result = originalA + value;
        this.registers.A = result & 0xFF; // Keep only the lower 8 bits

        // Update flags
        this.registers.F = 0; // Clear N, H, C flags. Z is set based on result.
        if (this.registers.A === 0) {
            this.registers.F |= 0x80; // Set Z flag
        }
        // N flag is cleared for additions
        if ((originalA & 0xF) + (value & 0xF) > 0xF) {
            this.registers.F |= 0x20; // Set H flag
        }
        if (result > 0xFF) {
            this.registers.F |= 0x10; // Set C flag
        }
    }

    // Helper function to add with carry a value to the A register and update flags
    adc(value) {
        const originalA = this.registers.A;
        const carry = (this.registers.F & 0x10) ? 1 : 0;
        const result = originalA + value + carry;
        this.registers.A = result & 0xFF;

        // Update flags
        this.registers.F = 0; // Clear N, H, C flags. Z is set based on result.
        if (this.registers.A === 0) {
            this.registers.F |= 0x80; // Set Z flag
        }
        // N flag is cleared for additions
        if ((originalA & 0xF) + (value & 0xF) + carry > 0xF) {
            this.registers.F |= 0x20; // Set H flag
        }
        if (result > 0xFF) {
            this.registers.F |= 0x10; // Set C flag
        }
    }

    // Helper function to OR a value with the A register and update flags
    or(value) {
        this.registers.A |= value;

        this.registers.F = 0x00; // Clear N, H, C flags
        if (this.registers.A === 0) {
            this.registers.F |= 0x80; // Set Z flag if result is 0
        }
    }

    // Helper function to XOR a value with the A register and update flags
    xor(value) {
        this.registers.A ^= value;

        this.registers.F = 0x00; // Clear N, H, C flags
        if (this.registers.A === 0) {
            this.registers.F |= 0x80; // Set Z flag if result is 0
        }
    }

    // Helper function to set the Zero flag based on register value
    setZeroFlag(value) {
        if (value === 0) {
            this.registers.F |= 0x80; // Set Z flag (bit 7)
        }
        else {
            this.registers.F &= ~0x80; // Clear Z flag (bit 7)
        }
    }

    // Set the Negative flag (N) for subtraction
    setSubtractFlag() {
        this.registers.F |= 0x40; // Set N flag (bit 6) for subtraction
    }

    clearSubtractFlag() {
        this.registers.F &= ~0x40; // Clear N flag (bit 6)
    }

    // Set the Half Carry flag (H) based on the subtraction
    setHalfCarryFlag(A, n) {
        // Half carry occurs if there's a borrow from bit 4
        if (((A & 0xF) - (n & 0xF)) < 0) {
            this.registers.F |= 0x20; // Set H flag (bit 5)
        }
        else {
            this.registers.F &= ~0x20; // Clear H flag (bit 5)
        }
    }

    // Set the Carry flag (C) based on the subtraction result
    setCarryFlag(result) {
        if (result < 0) {
            this.registers.F |= 0x10; // Set C flag (bit 4)
        }
        else {
            this.registers.F &= ~0x10; // Clear C flag (bit 4)
        }
    }

    disableInterrupts() {
        this.interruptsEnabled = false; // Disable interrupt handling
    }

    // Helper for PUSH opcodes
    push(highByte, lowByte) {
        this.registers.SP--;
        this.memory[this.registers.SP] = highByte;
        this.registers.SP--;
        this.memory[this.registers.SP] = lowByte;
    }

    // Helper for POP opcodes
    pop() {
        const lowByte = this.memory[this.registers.SP];
        const highByte = this.memory[this.registers.SP + 1];
        this.registers.SP += 2;
        return (highByte << 8) | lowByte;
    }

    // Helper to get register value based on 3-bit opcode
    _cb_get_r(code) {
        switch (code) {
            case 0: return this.registers.B;
            case 1: return this.registers.C;
            case 2: return this.registers.D;
            case 3: return this.registers.E;
            case 4: return this.registers.H;
            case 5: return this.registers.L;
            case 6: return this.memory[this.registers.HL]; // (HL)
            case 7: return this.registers.A;
        }
    }

    // Helper to set register value based on 3-bit opcode
    _cb_set_r(code, value) {
        switch (code) {
            case 0: this.registers.B = value; break;
            case 1: this.registers.C = value; break;
            case 2: this.registers.D = value; break;
            case 3: this.registers.E = value; break;
            case 4: this.registers.H = value; break;
            case 5: this.registers.L = value; break;
            case 6: this.memory[this.registers.HL] = value; break; // (HL)
            case 7: this.registers.A = value; break;
        }
    }

    //#region opcode functions
    // ---------------------- opcode functions ------------------------
    // Opcode handlers (e.g., NOP, LD, ADD, etc.)
    // https://pastraiser.com/cpu/gameboy/gameboy_opcodes.html

    opcodeNOP() { // 0x00: NOP - No operation
        // Does nothing, just moves to the next instruction
        this.registers.PC++;
        return 4;
    }

    opcodeLD_BC_nn() { // 0x01: LD BC, nn - Load 16-bit immediate value into BC register pair
        this.registers.C = this.memory[this.registers.PC + 1];
        this.registers.B = this.memory[this.registers.PC + 2];

        this.registers.PC += 3; // Opcode consumes 3 bytes
        return 12;
    }

    opcodeLD_BC_A() { // 0x02: LD (BC), A - Store A into memory address BC
        const bc = (this.registers.B << 8) | this.registers.C;
        this.memory[bc] = this.registers.A;
        
        this.registers.PC++;
        return 8;
    }

    opcodeINC_BC() { // 0x03: INC BC - Increment BC register pair
        this.registers.BC++;

        this.registers.PC++;
        return 8;
    }

    opcodeINC_B() { // 0x04: INC B
        this.registers.B = (this.registers.B + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.B);
        this.clearSubtractFlag(); // N is cleared
        // Set H if carry from bit 3
        if ((this.registers.B & 0x0F) === 0x00) {
            this.registers.F |= 0x20; // Set H flag
        }
        else {
            this.registers.F &= ~0x20; // Clear H flag
        }

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_B() { // 0x05: DEC B
        //  Decrement B
        const originalB = this.registers.B;
        this.registers.B = (this.registers.B - 1) & 0xFF;

        // Update the flags
        this.setZeroFlag(this.registers.B); // Set Z flag if result is 0
        this.setSubtractFlag();            // Set N flag since this is a subtraction
        this.setHalfCarryFlag(originalB, 1); // Check for half-carry during subtraction

        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_n() { // 0x06: LD B, n
        // Load immediate value into B
        this.registers.B = this.memory[this.registers.PC + 1];
        
        this.registers.PC += 2; // Opcode consumes 2 bytes
        return 8;
    }

    opcodeLD_nn_SP() { // 0x08: { // LD (nn), SP
        // Fetch the 16-bit address from the next two bytes in memory (little-endian)
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        const address = (highByte << 8) | lowByte;
    
        // Store the lower and upper bytes of SP into memory at the specified address
        this.memory[address] = this.registers.SP & 0xFF;            // Low byte of SP
        this.memory[address + 1] = (this.registers.SP >> 8) & 0xFF; // High byte of SP
    
        this.registers.PC += 3; // Instruction size is 3 bytes
        return 20;
    } 

    opcodeINC_C() { // 0x0C: INC C
        this.registers.C = (this.registers.C + 1) & 0xFF; // Increment C and ensure it stays within 8 bits
    
        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.C);
        this.clearSubtractFlag(); // N is cleared
        // Set H if carry from bit 3
        if ((this.registers.C & 0x0F) === 0x00) {
            this.registers.F |= 0x20; // Set H flag
        }
        else {
            this.registers.F &= ~0x20; // Clear H flag
        }
    
        this.registers.PC++;
        return 4;
    }

    opcodeDEC_C() { // 0x0D: DEC C
        const originalC = this.registers.C;
        this.registers.C = (this.registers.C - 1) & 0xFF; // Decrement C and ensure it stays within 8 bits
    
        // Update the flags
        this.setZeroFlag(this.registers.C); // Set Z flag if result is 0
        this.setSubtractFlag();            // Set N flag since this is a subtraction
        this.setHalfCarryFlag(originalC, 1); // Check for half-carry during subtraction
    
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_n() { // 0x0E: LD C, n
        this.registers.C = this.memory[this.registers.PC + 1]; // Fetch the immediate value

        this.registers.PC += 2; // Increment PC by 2 (opcode + immediate value)
        return 8;
    }

    opcodeRRCA() { // 0x0F: RRCA
        // Performs a rotate right operation on the A register.
        // The least significant bit (LSB) of A is rotated into the carry flag (C),
        // and also becomes the most significant bit (MSB) of A.
        const lsb = this.registers.A & 0x01; // Extract the least significant bit
        this.registers.A = (this.registers.A >> 1) | (lsb << 7); // Rotate right, MSB becomes LSB

        // Update flags
        this.registers.F = 0; // Clear all flags
        if (lsb)
            this.registers.F |= 0x10; // Set carry flag if LSB was 1

        this.registers.PC++;
        return 4;
    }

    opcodeLD_DE_nn() { // 0x11: LD DE, nn
        // Load 16-bit immediate value into DE.
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        this.registers.DE = (highByte << 8) | lowByte;
        this.registers.PC += 3;
        return 12;
    }

    opcodeDEC_E() { // 0x1D: DEC E
        const originalE = this.registers.E;
        this.registers.E = (originalE - 1) & 0xFF;

        this.setZeroFlag(this.registers.E);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalE, 1); // A = originalE, n = 1

        this.registers.PC++;
        return 4;
    }

    opcodeSTOP() { // 0x10: STOP - Halt the CPU
        this.stopEnabled = true;
        console.log("STOP instruction executed");

        this.registers.PC++;
        return 4;
    }

    opcodeJR_n() { // 0x18: JR n
        // Unconditional relative jump by n.
        const n = this.memory[this.registers.PC + 1]; // Fetch the signed offset n
        this.registers.PC += signedValue(n) + 2; // Jump by the offset
        return 12;
    }

    opcodeINC_DE() { // 0x13: INC DE
        // Increment the value of DE by 1
        this.registers.DE++;
        
        this.registers.PC += 1;
        return 8;
    }

    opcodeLD_A_DE() { // 0x1A: LD A, (DE)
        // Load the value at the memory address pointed by DE register into A.
        const address = this.registers.DE; // Now this works!
        this.registers.A = this.memory[address];

        this.registers.PC += 1;
        return 8;
    }

    opcodeJR_NZ_n() { // 0x20: JR NZ, n
        // Jump to the address PC + n if the Zero flag is not set.
        const n = this.memory[this.registers.PC + 1]; // Fetch the signed offset n
        if ((this.registers.F & 0x80) === 0) { // Check if Z flag is not set
            this.registers.PC += signedValue(n) + 2; // Jump by the offset and advance PC
            return 12;
        }
        else {
            this.registers.PC += 2; // Skip the jump
            return 8;
        }
    }

    opcodeLD_HL_nn() { // 0x21: LD HL, nn
        // Load the immediate 16-bit value nn into the HL register pair.
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch lower byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte
        this.registers.HL = (highByte << 8) | lowByte;

        this.registers.PC += 3; // Advance PC by 3
        return 12;
    }

    opcodeLD_HLplus_A() { // 0x22: LD (HL+), A
        // Stores the value of A into the memory address pointed to by HL,
        // then increment the value of HL
        this.memory[this.registers.HL] = this.registers.A;
        this.registers.HL++;

        this.registers.PC += 1;
        return 8;
    }

    opcodeINC_HL() { // 0x23: INC HL 
        // Increment the HL register pair by 1
        this.registers.HL++;

        this.registers.PC += 1;
        return 8;
    }

    opcodeINC_H() { // 0x24: INC H
        // Increments the H register by one, updating the necessary flags
        this.registers.H = (this.registers.H + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.H);
        this.clearSubtractFlag(); // N is cleared
        // Set H if carry from bit 3
        if ((this.registers.H & 0x0F) === 0x00) {
            this.registers.F |= 0x20; // Set H flag
        } else {
            this.registers.F &= ~0x20; // Clear H flag
        }
        // C flag is not affected

        this.registers.PC++;
        return 4;
    }

    opcodeLD_H_n() { // 0x26: LD H, n
        // Load the immediate 8-bit value n into register H.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value
        this.registers.H = n;

        this.registers.PC += 2; // Advance PC by 2
        return 8;
    }

    opcodeINC_L() { // 0x2C: INC L
        this.registers.L = (this.registers.L + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.L);
        this.clearSubtractFlag(); // N is cleared
        // Set H if carry from bit 3
        if ((this.registers.L & 0x0F) === 0x00) {
            this.registers.F |= 0x20; // Set H flag
        } else {
            this.registers.F &= ~0x20; // Clear H flag
        }
        // C flag is not affected

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_L() { // 0x2D: DEC L
        // Decrements the L register.
        const originalL = this.registers.L;
        this.registers.L = (originalL - 1) & 0xFF;

        this.setZeroFlag(this.registers.L);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalL, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeADD_HL_HL() { // 0x29: ADD HL, HL
        const originalHL = this.registers.HL;
        const result = originalHL + originalHL;

        // N is reset
        this.registers.F &= ~0x40;

        // H is set if carry from bit 11
        if ((originalHL & 0x0FFF) + (originalHL & 0x0FFF) > 0x0FFF) {
            this.registers.F |= 0x20;
        } else {
            this.registers.F &= ~0x20;
        }

        // C is set if carry from bit 15
        if (result > 0xFFFF) {
            this.registers.F |= 0x10;
        } else {
            this.registers.F &= ~0x10;
        }

        this.registers.HL = result & 0xFFFF;
        this.registers.PC++;
        return 8;
    }

    opcodeJR_Z_n() { // 0x28: JR Z, n
        // Jump to the address PC + n if the Zero flag is set.
        const n = this.memory[this.registers.PC + 1]; // Fetch the signed offset n
        if ((this.registers.F & 0x80) !== 0) { // Check if Z flag is set
            this.registers.PC += signedValue(n) + 2; // Jump by the offset and advance PC
            return 12;
        }
        else {
            this.registers.PC += 2; // Skip the jump
            return 8;
        }
    }

    opcodeLD_A_HLplus() { // 0x2A: LD A, (HL+)
        // Load value from address HL into A, then increment HL.
        this.registers.A = this.memory[this.registers.HL];
        this.registers.HL++;
        this.registers.PC++;
        return 8;
    }

    opcodeJR_NC_n() { // 0x30: JR NC, n
        // Jump relative by n if Carry flag is not set.
        const n = this.memory[this.registers.PC + 1]; // Fetch the signed offset n
        
        if ((this.registers.F & 0x10) === 0) { // Check if Carry flag is NOT set
            this.registers.PC += signedValue(n) + 2; // Jump by the offset
            return 12; // Cycles for jump taken
        }
        else {
            this.registers.PC += 2; // Skip the jump, just advance PC
            return 8; // Cycles for jump not taken
        }
    }

    opcodeLD_SP_nn() { // 0x31: LD SP, nn
        // Load 16-bit immediate value into SP
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch low byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch high byte
        
        // Combine the low and high bytes into a 16-bit value (nn)
        this.registers.SP = (highByte << 8) | lowByte;
        
        // Increment the program counter to point to the next instruction
        this.registers.PC += 3;
        return 12;
    }

    opcodeLD_HLm_A() { // 0x32: LD (HL-), A
        // stores the contents of register A into the memory location pointed to by the HL register pair,
        // then decrements the value of HL
        this.memory[this.registers.HL] = this.registers.A;
        this.registers.HL--;

        this.registers.PC++;
        return 8;
    }

    opcodeINC_A() { // 0x3C: INC A
        this.registers.A = (this.registers.A + 1) & 0xFF; // Increment A and keep it within 8 bits
    
        // Update flags
        this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
        this.registers.F &= ~0x40;         // Clear N flag (bit 6)
        // Set H if carry from bit 3
        if ((this.registers.A & 0x0F) === 0x00) {
            this.registers.F |= 0x20;      // Set H flag (bit 5) if carry from bit 3
        }
        else {
            this.registers.F &= ~0x20;     // Clear H flag (bit 5)
        }

        this.registers.PC++;
        return 4;
    }

    opcodeLD_A_n() { // 0x3E: LD A, n
        // Fetch the immediate value and load it into register A
        const value = this.memory[this.registers.PC + 1]; 
        this.registers.A = value;
        
        this.registers.PC += 2; // Advance the program counter
        return 8;
    }

    opcodeLD_B_H() { // 0x44: LD B, H
        // Load the value of register H into register B.
        this.registers.B = this.registers.H;

        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_HL() { // 0x46: LD B, (HL)
        // Loads a byte from the memory address in HL into register B.
        this.registers.B = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_C_HL() { // 0x4E: LD C, (HL)
        // Loads a byte from the memory address in HL into register C.
        this.registers.C = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_D_HL() { // 0x56: LD D, (HL)
        // Loads a byte from the memory address in HL into register D.
        this.registers.D = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_L_A() { // 0x6F: LD L, A
        // Load the value of register A into register L.
        this.registers.L = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_L_HL() { // 0x6E: LD L, (HL)
        this.registers.L = this.memory[this.registers.HL]; // Load the value from memory at address HL into register L

        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_E() { // 0x73: LD (HL), E
        this.memory[this.registers.HL] = this.registers.E; // Store the value of register E into memory at HL

        this.registers.PC++;
        return 8;
    }
            
    opcodeHALT() { // 0x76: HALT - Freeze the CPU until reset
        this.haltEnabled = true;
        console.log("HALT instruction executed");

        this.registers.PC++;
        return 4;
    }

    opcodeLD_HL_A() { // 0x77: LD (HL), A
        // Store the value of register A into the memory address pointed to by HL.
        this.memory[this.registers.HL] = this.registers.A;
        this.registers.PC++;
        return 8;
    }

    opcodeLD_A_E() { // 0x7B: LD A, E
        // Load the value of register E into register A.
        this.registers.A = this.registers.E;
        this.registers.PC++;
        return 4;
    }
            
    opcodeLD_A_C() { // 0x79: LD A, C
        // Load the value of register C into register A.
        this.registers.A = this.registers.C;
        this.registers.PC++;
        return 4;
    }
            
    opcodeLD_A_B() { // 0x78: LD A, B
        // Load the value of register B into register A.
        this.registers.A = this.registers.B;
        this.registers.PC++;
        return 4;
    }
            
    opcodeLD_A_H() { // 0x7C: LD A, H
        // Load the value of register H into register A.
        this.registers.A = this.registers.H;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_A_A() { // 0x7F: LD A, A
        // No operation, just move to the next instruction
        this.registers.PC++;
        return 4;
    }

    opcodeLD_A_L() { // 0x7D: LD A, L
        // Load the value of register L into register A.
        this.registers.A = this.registers.L;
        this.registers.PC++;
        return 4;
    }

    opcodeADD_A_B() { // 0x80: ADD A, B - Add B to A
        this.add(this.registers.B);

        this.registers.PC++;
        return 4;
    }

    opcodeADD_A_C() { // 0x81: ADD A, C - Add C to A
        this.add(this.registers.C);

        this.registers.PC++;
        return 4;
    }

    opcodeADD_A_E() { // 0x83: ADD A, E
        this.add(this.registers.E);
        this.registers.PC++;
        return 4;
    }

    opcodeADC_A_B() { // 0x88: ADC A, B
        this.adc(this.registers.B);
        this.registers.PC++;
        return 4;
    }

    opcodeADC_A_C() { // 0x89: ADC A, C
        this.adc(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeSUB_A_H() { // 0x94: SUB A, H
        // Subtract the value in H from A.
        const originalA = this.registers.A;
        const value = this.registers.H;
        const result = originalA - value;

        this.registers.A = result & 0xFF;
        this.setZeroFlag(this.registers.A);
        this.setSubtractFlag(); // Subtraction operation
        this.setHalfCarryFlag(originalA, value);
        this.setCarryFlag(result);
    
        this.registers.PC++;
        return 4;
    }

    opcodeOR_C() { // 0xB1: OR C
        this.or(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeOR_A() { // 0xB7: OR A
        this.or(this.registers.A);
        this.registers.PC++;
        return 4;
    }

    opcodeXOR_C() { // 0xA9: XOR C
        this.xor(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeXOR_HL() { // 0xAE: XOR (HL)
        // Performs a bitwise XOR between A and the byte at the memory address in HL.
        const value = this.memory[this.registers.HL];
        this.xor(value);
        this.registers.PC++;
        return 8;
    }

    opcodeXOR_A_A() { // 0xAF: XOR A, A
        // Exclusive OR the A register with itself.
        this.xor(this.registers.A);
        this.registers.PC++;
        return 4;
    }
            
    opcodeJP_nn() { // 0xC3: JP nn - Jump to address nn (16-bit immediate)
        const lowByte = this.memory[this.registers.PC + 1];  // Fetch lower byte (byte at PC+1)
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte (byte at PC+2)
        
        // Combine the two bytes into a 16-bit address (little-endian format)
        const address = (highByte << 8) | lowByte;
        
        this.registers.PC = address; // Set PC to the new address
        return 16;
    }

    opcodeADD_A_n() { // 0xC6: ADD A, n
        const n = this.memory[this.registers.PC + 1];
        this.add(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodePOP_BC() { // 0xC1: POP BC
        // Pop 16-bit value from stack into BC.
        this.registers.BC = this.pop();
        this.registers.PC++;
        return 12;
    }

    opcodeCB() { // 0xCB: Prefix for bit manipulation instructions
        const cbOpcode = this.memory[this.registers.PC + 1];
        this.registers.PC += 2; // All CB instructions are 2 bytes long

        const opType = cbOpcode >> 6;    // 00: rotate, 01: BIT, 10: RES, 11: SET
        const bit = (cbOpcode >> 3) & 7; // Bit number (0-7)
        const regCode = cbOpcode & 7;    // Register code (0-7)

        let cycles = 8;
        if (regCode === 6) { // Operations on (HL) take more cycles
            cycles = (opType === 1) ? 12 : 16; // BIT is 12, RES/SET are 16
        }

        const value = this._cb_get_r(regCode);
        let result;

        switch (opType) {
            case 0: // Rotates and Shifts (RLC, RRC, RL, RR, SLA, SRA, SWAP, SRL)
                // TODO: Implement rotate and shift operations
                console.warn(`Unimplemented CB rotate/shift opcode: 0x${cbOpcode.toString(16)}`);
                break;

            case 1: // BIT b, r
                const isBitZero = (value & (1 << bit)) === 0;
                // Preserve C flag, clear N, set H
                this.registers.F = (this.registers.F & 0x10) | 0x20;
                if (isBitZero) {
                    this.registers.F |= 0x80; // Set Z flag
                }
                break;

            case 2: // RES b, r
                result = value & ~(1 << bit);
                this._cb_set_r(regCode, result);
                break;

            case 3: // SET b, r
                result = value | (1 << bit);
                this._cb_set_r(regCode, result);
                break;
        }
        return cycles;
    }

    opcodePUSH_BC() { // 0xC5: PUSH BC
        // Push register pair BC onto the stack.
        this.push(this.registers.B, this.registers.C);
        this.registers.PC++;
        return 16;
    }

    opcodePUSH_DE() { // 0xD5: PUSH DE
        // Push register pair DE onto the stack.
        this.push(this.registers.D, this.registers.E);
        this.registers.PC++;
        return 16;
    }

    opcodePUSH_HL() { // 0xE5: PUSH HL
        // Push register pair HL onto the stack.
        this.push(this.registers.H, this.registers.L);
        this.registers.PC++;
        return 16;
    }

    opcodePUSH_AF() { // 0xF5: PUSH AF
        // Push register pair AF onto the stack.
        // Note: The lower 4 bits of F are always 0, the F register setter handles this.
        this.push(this.registers.A, this.registers.F);
        this.registers.PC++;
        return 16;
    }

    opcodeCALL_NZ_nn() { // 0xC4: CALL NZ, nn
        // If Z flag is not set, call address nn
        if ((this.registers.F & 0x80) === 0) {
            const lowByte = this.memory[this.registers.PC + 1];
            const highByte = this.memory[this.registers.PC + 2];
            const address = (highByte << 8) | lowByte;

            const returnAddress = this.registers.PC + 3;
            this.registers.SP -= 2;
            this.memory[this.registers.SP] = returnAddress & 0xFF;
            this.memory[this.registers.SP + 1] = (returnAddress >> 8) & 0xFF;

            this.registers.PC = address;
            return 24; // Call taken
        } else {
            // Condition not met, just advance PC
            this.registers.PC += 3;
            return 12; // Call not taken
        }
    }

    opcodeRET() { // 0xC9: RET - Return from subroutine
        // Pop the 16-bit return address from the stack
        const lowByte = this.memory[this.registers.SP];       // Fetch the lower byte from the stack
        const highByte = this.memory[this.registers.SP + 1];  // Fetch the higher byte from the stack
        
        // Combine the two bytes into a 16-bit address (little-endian format)
        const returnAddress = (highByte << 8) | lowByte;
        
        // Set the program counter (PC) to the return address
        this.registers.PC = returnAddress;
        
        // Increment the stack pointer (SP) by 2 to pop the return address
        this.registers.SP += 2;
        return 16;
    }

    opcodeCALL_Z_nn() { // 0xCC: CALL Z, nn
        // If Z flag is set, call address nn
        if ((this.registers.F & 0x80) !== 0) {
            const lowByte = this.memory[this.registers.PC + 1];  // Fetch the lower byte of the address
            const highByte = this.memory[this.registers.PC + 2]; // Fetch the higher byte of the address
            const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address

            // Push the current PC + 3 (next instruction) onto the stack
            const returnAddress = this.registers.PC + 3;
            this.registers.SP -= 2; // Decrement SP by 2 to reserve space
            this.memory[this.registers.SP] = returnAddress & 0xFF;         // Store lower byte of PC
            this.memory[this.registers.SP + 1] = (returnAddress >> 8) & 0xFF;    // Store higher byte of PC

            this.registers.PC = address; // Jump to the subroutine
            return 24; // Call taken
        }
        else {
            this.registers.PC += 3; // Skip the immediate value if condition is not met
            return 12; // Call not taken
        }
    }

    opcodeCALL_nn() { // 0xCD: CALL nn
        // Unconditionally call address nn
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        const address = (highByte << 8) | lowByte;

        // Push the address of the next instruction (PC + 3) onto the stack
        const returnAddress = this.registers.PC + 3;
        this.registers.SP -= 2;
        this.memory[this.registers.SP] = returnAddress & 0xFF;      // Low byte
        this.memory[this.registers.SP + 1] = (returnAddress >> 8) & 0xFF; // High byte

        this.registers.PC = address;
        return 24;
    }

    opcodeSUB_n() { // 0xD6: SUB n - Subtract immediate value n from A
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n (byte at PC + 1)
        const originalA = this.registers.A;
        // Perform the subtraction
        const result = originalA - n;
    
        // Update the A register with the result (only lower 8 bits)
        this.registers.A = result & 0xFF;
        
        // Update the flags
        this.setSubtractFlag(); // Set N flag
        this.setZeroFlag(this.registers.A); // Set Z flag based on the result
        this.setHalfCarryFlag(originalA, n); // Set H flag for half carry
        this.setCarryFlag(result); // Set C flag for carry/borrow
        
        this.registers.PC += 2;
        return 8;
    }

    opcodeRETI() { // 0xD9: RETI - Return and enable interrupts
        // Pop the 16-bit return address from the stack
        const lowByte = this.memory[this.registers.SP];
        const highByte = this.memory[this.registers.SP + 1];
        const returnAddress = (highByte << 8) | lowByte;
    
        // Update the program counter
        this.registers.PC = returnAddress;
    
        // Increment the stack pointer by 2 (popping the address)
        this.registers.SP += 2;
    
        // Enable interrupts
        this.interruptsEnabled = true;
    
        console.log("RETI executed, returning to 0x" + returnAddress.toString(16));
        return 16;
    }

    opcodeCALL_NC_nn() { // 0xD4: CALL NC, nn
        // If C flag is not set, call address nn
        if ((this.registers.F & 0x10) === 0) {
            const lowByte = this.memory[this.registers.PC + 1];
            const highByte = this.memory[this.registers.PC + 2];
            const address = (highByte << 8) | lowByte;

            const returnAddress = this.registers.PC + 3;
            this.registers.SP -= 2;
            this.memory[this.registers.SP] = returnAddress & 0xFF;
            this.memory[this.registers.SP + 1] = (returnAddress >> 8) & 0xFF;

            this.registers.PC = address;
            return 24; // Call taken
        } else {
            this.registers.PC += 3;
            return 12; // Call not taken
        }
    }

    opcodeCALL_C_nn() { // 0xDC: CALL C, nn
        // If C flag is set, call address nn
        if ((this.registers.F & 0x10) !== 0) {
            const lowByte = this.memory[this.registers.PC + 1];  // Fetch the lower byte of the address
            const highByte = this.memory[this.registers.PC + 2]; // Fetch the higher byte of the address
            const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address
    
            // Push the current PC + 3 (next instruction) onto the stack
            const returnAddress = this.registers.PC + 3;
            this.registers.SP -= 2; // Decrement SP by 2 to reserve space
            this.memory[this.registers.SP] = returnAddress & 0xFF;         // Store lower byte of PC
            this.memory[this.registers.SP + 1] = (returnAddress >> 8) & 0xFF;    // Store higher byte of PC
    
            this.registers.PC = address; // Jump to the subroutine
            return 24; // Call taken
        }
        else {
            this.registers.PC += 3; // Skip the immediate value if condition is not met
            return 12; // Call not taken
        }
    }

    opcodeRST_18H() { // 0xDF: RST 18H
        // restart instruction
        const returnAddress = this.registers.PC + 1;
        this.push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
    
        // Set the PC to 0x0018
        this.registers.PC = 0x0018;
        return 16;
    }

    opcodeLDH_n_A() { // 0xE0: LDH (n), A
        // Loads the value in the A register into memory at the address 0xFF00 + n, where n is an 8-bit immediate value
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value
        const address = 0xFF00 + n;                   // Calculate the target address
        this.memory[address] = this.registers.A;      // Store the value in A at the address

        this.registers.PC += 2; // Advance the program counter
        return 12;
    }

    opcodePOP_HL() { // 0xE1: POP HL
        // Pop 16-bit value from stack into HL.
        this.registers.HL = this.pop();
        this.registers.PC++;
        return 12;
    }

    opcodeJP_HL() { // 0xE9: JP (HL)
        // Jump to the address contained in HL.
        this.registers.PC = this.registers.HL;
        return 4;
    }

    opcodeAND_n() { // 0xE6: AND n
        const immediateValue = this.memory[this.registers.PC + 1]; // Fetch the immediate 8-bit value
        this.registers.A &= immediateValue; // Perform bitwise AND and store result in A
    
        // Update flags
        this.registers.F = 0; // Clear all flags
        this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
        this.registers.F |= 0x20; // Set H flag (bit 5), always set for AND
    
        this.registers.PC += 2; // Advance PC by 2 (1 for opcode + 1 for immediate value)
        return 8;
    }

    opcodeLD_nn_A() { // 0xEA: LD (nn), A
        // Store the value of register A into the memory address specified by nn.
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        const address = (highByte << 8) | lowByte;

        this.memory[address] = this.registers.A;
        this.registers.PC += 3;
        return 16;
    }

    opcodeLDAFromImmediateIO() { // 0xF0: LD A, (n)
        // Load the value from memory at address 0xFF00 + n into register A.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n
        this.registers.A = this.memory[0xFF00 + n];  // Load from memory address (0xFF00 + n)

        this.registers.PC += 2; // Advance PC by 2 (opcode + immediate value)
        return 12;
    }

    opcodePOP_AF() { // 0xF1: POP AF
        // Pop 16-bit value from stack into AF.
        const poppedValue = this.pop();
        this.registers.A = (poppedValue >> 8) & 0xFF;
        this.registers.F = poppedValue & 0xFF; // The setter for F will handle masking to 0xF0
        this.registers.PC++;
        return 12;
    }

    opcodeDI() { // 0xF3: DI - Disable interrupts
        this.disableInterrupts(); // Disable interrupt handling

        this.registers.PC++;
        return 4;
    }

    opcodeLD_A_nn() { // 0xFA: LD A, (nn)
        // Load the value from memory at address nn into A.
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch lower byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte
        const address = (highByte << 8) | lowByte; // Combine into 16-bit address

        this.registers.A = this.memory[address]; // Load value into A

        this.registers.PC += 3; // Advance PC by 3
        return 16;
    }

    opcodeCPAImmediate() { // 0xFE: CP A, n
        // Compare the value in A with the immediate value n.
        // This is a subtraction (A - n) without storing the result.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n
        const originalA = this.registers.A;
        const result = originalA - n;
    
        this.setZeroFlag(result & 0xFF);
        this.setSubtractFlag(); // Subtraction operation
        this.setHalfCarryFlag(originalA, n);
        this.setCarryFlag(result);
    
        this.registers.PC += 2; // Advance PC by 2
        return 8;
    }

    opcodeRST38() { // 0xFF: RST 38H
        // Restart instruction, essentially a call to a fixed address (0x0038).
        // It pushes the PC+1 onto the stack and then jumps to the specified address.
        const returnAddress = this.registers.PC + 1;
        this.push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

        // Jump to address 0x0038
        this.registers.PC = 0x0038;
        return 16;
    }
    //#endregion
}