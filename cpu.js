class GameBoyCPU {
    constructor() {
        this.registers = {
            A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, H: 0, L: 0, 
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
            0x10: this.opcodeSTOP.bind(this),
            0x13: this.opcodeINC_DE.bind(this),
            0x1A: this.opcodeLD_A_DE.bind(this),
            0x20: this.opcodeJR_NZ_n.bind(this),
            0x21: this.opcodeLD_HL_nn.bind(this),
            0x22: this.opcodeLD_HLplus_A.bind(this),
            0x23: this.opcodeINC_HL.bind(this),
            0x26: this.opcodeLD_H_n.bind(this),
            0x30: this.opcodeJR_NZ_nn.bind(this),
            0x31: this.opcodeLD_SP_nn.bind(this),
            0x32: this.opcodeLD_HLm_A.bind(this),
            0x3C: this.opcodeINC_A.bind(this),
            0x3E: this.opcodeLD_A_n.bind(this),
            0x44: this.opcodeLD_B_H.bind(this),
            0x6E: this.opcodeLD_L_HL.bind(this),
            0x73: this.opcodeLD_HL_E.bind(this),
            0x76: this.opcodeHALT.bind(this),
            0x7F: this.opcodeLD_A_A.bind(this),
            0x80: this.opcodeADD_A_B.bind(this),
            0x81: this.opcodeADD_A_C.bind(this),
            0x83: this.opcodeADD_A_E.bind(this),
            0x88: this.opcodeADC_A_B.bind(this),
            0x89: this.opcodeADC_A_C.bind(this),
            0x94: this.opcodeSUB_A_H.bind(this),
            0xAF: this.opcodeXOR_A_A.bind(this),
            0xC3: this.opcodeJP_nn.bind(this),
            0xC9: this.opcodeRET.bind(this),
            0xCC: this.opcodeCALL_Z_nn.bind(this),
            0xD6: this.opcodeSUB_n.bind(this),
            0xD9: this.opcodeRETI.bind(this),
            0xDC: this.opcodeCALL_C_nn.bind(this),
            0xDF: this.opcodeRST_18H.bind(this),
            0xE0: this.opcodeLDH_n_A.bind(this),
            0xE6: this.opcodeAND_n.bind(this),
            0xF0: this.opcodeLDAFromImmediateIO.bind(this),
            0xF3: this.opcodeDI.bind(this),
            0xFA: this.opcodeLD_A_nn.bind(this),
            0xFE: this.opcodeCPAImmediate.bind(this),
            0xFF: this.opcodeRST38.bind(this),
        };

        this.lastOpcodeHandlerName = "";
    }

    reset() {
        // Initialize registers to their power-on state
        this.registers = {
            A: 0x01,   // Accumulator
            F: 0xB0,   // Flags
            B: 0x00,
            C: 0x13,
            D: 0x00,
            E: 0xD8,
            H: 0x01,
            L: 0x4D,
            SP: 0xFFFE, // Stack Pointer
            PC: 0x0, // Program Counter (after BIOS)
            lastPC: 0x0
        };

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
        } else {
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
        this.lastOpcodeHandlerName = handler.name.split(" ")[1].split("opcode")[1];

        //this.executeOpcode(opcode); // Execute opcode
        let elapsedClockTicks = 0;
        if (handler) {
            handler();
            // TODO each instruction has different clock ticks
            elapsedClockTicks = 4;
        }
        else {
            console.warn(`Unimplemented opcode: ${opcode.toString(16)}`);
            this.registers.PC++; // Skip the unhandled opcode
        }
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
                } else {
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
                } else {
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
                } else {
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
                } else {
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
        const result = this.registers.A + value;
        this.registers.A = result & 0xFF; // Keep only the lower 8 bits
        this.updateFlags(result);
    }

    // Helper function to set the Zero flag based on register value
    setZeroFlag(value) {
        if (value === 0) {
            this.registers.F |= 0x80; // Set Z flag (bit 7)
        } else {
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
        } else {
            this.registers.F &= ~0x20; // Clear H flag (bit 5)
        }
    }

    // Set the Carry flag (C) based on the subtraction result
    setCarryFlag(result) {
        if (result < 0) {
            this.registers.F |= 0x10; // Set C flag (bit 4)
        } else {
            this.registers.F &= ~0x10; // Clear C flag (bit 4)
        }
    }

    // Update flags after an addition operation
    updateFlags(result) {
        // Set Zero flag
        if ((result & 0xFF) === 0) {
            this.registers.F |= 0x80; // Set Z flag
        } else {
            this.registers.F &= ~0x80; // Clear Z flag
        }

        // Set the Carry flag (if result overflows 8 bits)
        if (result > 0xFF) {
            this.registers.F |= 0x10; // Set C flag (bit 4)
        } else {
            this.registers.F &= ~0x10; // Clear C flag (bit 4)
        }

        // Set the Half Carry flag (if carry from bit 3 to 4)
        if (((this.registers.A & 0xF) + (result & 0xF)) > 0xF) {
            this.registers.F |= 0x20; // Set H flag (bit 5)
        } else {
            this.registers.F &= ~0x20; // Clear H flag (bit 5)
        }

        // Set the Subtract flag (this is not set for ADD operations)
        this.registers.F &= ~0x40; // Clear N flag (bit 6)
    }

    disableInterrupts() {
        this.interruptsEnabled = false; // Disable interrupt handling
    }

    //#region opcode functions
    // ---------------------- opcode functions ------------------------
    // Opcode handlers (e.g., NOP, LD, ADD, etc.)
    // https://pastraiser.com/cpu/gameboy/gameboy_opcodes.html

    opcodeNOP() { // 0x00: NOP - No operation
        // Does nothing, just moves to the next instruction
        this.registers.PC++;
    }

    opcodeLD_BC_nn() { // 0x01: LD BC, nn - Load 16-bit immediate value into BC register pair
        this.registers.C = this.memory[this.registers.PC + 1];
        this.registers.B = this.memory[this.registers.PC + 2];

        this.registers.PC += 3; // Opcode consumes 3 bytes
    }

    opcodeLD_BC_A() { // 0x02: LD (BC), A - Store A into memory address BC
        const bc = (this.registers.B << 8) | this.registers.C;
        this.memory[bc] = this.registers.A;
        
        this.registers.PC++;
    }

    opcodeINC_BC() { // 0x03: INC BC - Increment BC register pair
        this.registers.C++;
        if (this.registers.C === 0) {
            this.registers.B++;
        }

        this.registers.PC++;
    }

    opcodeINC_B() { // 0x04: INC B
        // Increment B
        this.registers.B++;
        this.setZeroFlag(this.registers.B);

        this.registers.PC++;
    }

    opcodeDEC_B() { // 0x05: DEC B
        //  Decrement B
        this.registers.B = (this.registers.B - 1) & 0xFF;

        // Update the flags
        this.setZeroFlag(this.registers.B); // Set Z flag if result is 0
        this.setSubtractFlag();            // Set N flag since this is a subtraction
        this.setHalfCarryFlag(this.registers.B + 1, 1); // Check for half-carry during subtraction

        this.registers.PC++;
    }

    opcodeLD_B_n() { // 0x06: LD B, n
        // Load immediate value into B
        this.registers.B = this.memory[this.registers.PC + 1];
        
        this.registers.PC += 2; // Opcode consumes 2 bytes
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
    } 

    opcodeINC_C() { // 0x0C: INC C
        this.registers.C = (this.registers.C + 1) & 0xFF; // Increment C and ensure it stays within 8 bits
    
        // Update the flags
        this.setZeroFlag(this.registers.C); // Set Z flag if result is 0
        this.clearSubtractFlag();           // Clear N flag since this is not a subtraction
        this.setHalfCarryFlag(this.registers.C - 1, 1); // Check for half-carry during addition
    
        this.registers.PC++;
    }

    opcodeDEC_C() { // 0x0D: DEC C
        this.registers.C = (this.registers.C - 1) & 0xFF; // Decrement C and ensure it stays within 8 bits
    
        // Update the flags
        this.setZeroFlag(this.registers.C); // Set Z flag if result is 0
        this.setSubtractFlag();            // Set N flag since this is a subtraction
        this.setHalfCarryFlag(this.registers.C + 1, 1); // Check for half-carry during subtraction
    
        this.registers.PC++;
    }

    opcodeLD_C_n() { // 0x0E: LD C, n
        this.registers.C = this.memory[this.registers.PC + 1]; // Fetch the immediate value

        this.registers.PC += 2; // Increment PC by 2 (opcode + immediate value)
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
    }

    opcodeSTOP() { // 0x10: STOP - Halt the CPU
        this.stopEnabled = true;
        console.log("STOP instruction executed");

        this.registers.PC++;
    }

    opcodeINC_DE() { // 0x13: INC DE
        // Increment the value of DE by 1
        this.registers.DE = (this.registers.DE + 1) & 0xFFFF; // Increment and wrap to 16 bits
        
        this.registers.PC += 1;
    }

    opcodeLD_A_DE() { // 0x1A: LD A, (DE)
        // Load the value at the memory address pointed by DE register into A.
        const address = this.registers.DE;
        this.registers.A = this.memory[address];

        this.registers.PC += 1;
    }

    opcodeJR_NZ_n() { // 0x20: JR NZ, n
        // Jump to the address PC + n if the Zero flag is not set.
        const n = this.memory[this.registers.PC + 1]; // Fetch the signed offset n
        if ((this.registers.F & 0x80) === 0) { // Check if Z flag is not set
            this.registers.PC += signedValue(n) + 2; // Jump by the offset and advance PC
        }
        else {
            this.registers.PC += 2; // Skip the jump
        }
    }

    opcodeLD_HL_nn() { // 0x21: LD HL, nn
        // Load the immediate 16-bit value nn into the HL register pair.
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch lower byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte
        this.registers.H = highByte;
        this.registers.L = lowByte;

        this.registers.PC += 3; // Advance PC by 3
    }

    opcodeLD_HLplus_A() { // 0x22: LD (HL+), A
        // Stores the value of A into the memory address pointed to by HL,
        // then increment the value of HL
        this.memory[this.registers.HL] = this.registers.A;
        this.registers.HL = (this.registers.HL + 1) & 0xFFFF; // Ensure HL stays within 16 bits

        this.registers.PC += 1;
    }

    opcodeINC_HL() { // 0x23: INC HL 
        // Increment the HL register pair by 1
        this.registers.HL = (this.registers.HL + 1) & 0xFFFF; // Ensure it stays within 16 bits

        this.registers.PC += 1;
    }

    opcodeLD_H_n() { // 0x26: LD H, n
        // Load the immediate 8-bit value n into register H.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value
        this.registers.H = n;

        this.registers.PC += 2; // Advance PC by 2
    }

    opcodeJR_NZ_nn() { // 0x30: JR NZ, nn
        // Jump to address (PC + signed nn) if Zero flag is not set
        const offset = this.memory[this.registers.PC + 1]; // Fetch the signed offset (byte at PC + 1)
        
        // Check if the Zero flag is not set (NZ condition)
        if ((this.registers.F & 0x80) === 0) {
            // If Zero flag is not set, perform the jump
            this.registers.PC += offset; // Jump to the new address (PC + signed offset)
        }
        else {
            // If Zero flag is set, do nothing (just increment PC normally)
            this.registers.PC++;
        }
    }

    opcodeLD_SP_nn() { // 0x31: LD SP, nn
        // Load 16-bit immediate value into SP
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch low byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch high byte
        
        // Combine the low and high bytes into a 16-bit value (nn)
        this.registers.SP = (highByte << 8) | lowByte;
        
        // Increment the program counter to point to the next instruction
        this.registers.PC += 2;
    }

    opcodeLD_HLm_A() { // 0x32: LD (HL-), A
        // stores the contents of register A into the memory location pointed to by the HL register pair,
        // then decrements the value of HL
        const address = (this.registers.H << 8) | this.registers.L; // Combine H and L into an address
        this.memory[address] = this.registers.A; // Store A at the memory location (HL)
        
        // Decrement HL
        if (this.registers.L === 0) {
            this.registers.L = 0xFF;
            this.registers.H--;
        }
        else {
            this.registers.L--;
        }

        this.registers.PC++;
    }

    opcodeINC_A() { // 0x3C: INC A
        this.registers.A = (this.registers.A + 1) & 0xFF; // Increment A and keep it within 8 bits
    
        // Update flags
        this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
        this.registers.F &= ~0x40;         // Clear N flag (bit 6)
        if ((this.registers.A & 0x0F) === 0) {
            this.registers.F |= 0x20;      // Set H flag (bit 5) if carry from bit 3
        } else {
            this.registers.F &= ~0x20;     // Clear H flag (bit 5)
        }

        this.registers.PC++;
    }

    opcodeLD_A_n() { // 0x3E: LD A, n
        // Fetch the immediate value and load it into register A
        const value = this.memory[this.registers.PC + 1]; 
        this.registers.A = value;
        
        this.registers.PC += 2; // Advance the program counter
    }

    opcodeLD_B_H() { // 0x44: LD B, H
        // Load the value of register H into register B.
        this.registers.B = this.registers.H;

        this.registers.PC++;
    }

    opcodeLD_L_HL() { // 0x6E: LD L, (HL)
        const hlAddress = (this.registers.H << 8) | this.registers.L; // Combine H and L registers into a 16-bit address
        this.registers.L = this.memory[hlAddress]; // Load the value from memory at address HL into register L

        this.registers.PC++;
    }

    opcodeLD_HL_E() { // 0x73: LD (HL), E
        const hlAddress = (this.registers.H << 8) | this.registers.L; // Combine H and L to form the 16-bit address
        this.memory[hlAddress] = this.registers.E; // Store the value of register E into memory at HL

        this.registers.PC++;
    }
            
    opcodeHALT() { // 0x76: HALT - Freeze the CPU until reset
        this.haltEnabled = true;
        console.log("HALT instruction executed");

        this.registers.PC++;
    }
            
    opcodeLD_A_A() { // 0x7F: LD A, A
        // No operation, just move to the next instruction
        this.registers.PC++;
    }

    opcodeADD_A_B() { // 0x80: ADD A, B - Add B to A
        this.add(this.registers.B);

        this.registers.PC++;
    }

    opcodeADD_A_C() { // 0x81: ADD A, C - Add C to A
        this.add(this.registers.C);

        this.registers.PC++;
    }

    opcodeADD_A_E() { // 0x83: ADD A, E
        const value = this.registers.E; // Get the value of register E
        const result = this.registers.A + value; // Perform the addition
    
        // Update the A register with the lower 8 bits of the result
        this.registers.A = result & 0xFF;
    
        // Use the updateFlags method to handle Z, H, and C flags
        this.updateFlags(result);
    
        this.registers.PC++;
    }

    opcodeADC_A_B() { // 0x88: ADC A, B
        const carry = (this.registers.F & 0x10) ? 1 : 0; // Extract the carry flag (C)
        const value = this.registers.B; // Value to add from register B
        const result = this.registers.A + value + carry; // Add A, B, and carry
    
        this.registers.A = result & 0xFF; // Store the lower 8 bits back in A
    
        // Update flags
        this.setZeroFlag(this.registers.A); // Set Z flag if the result is zero
        this.setSubtractFlag(false); // Clear N flag (this is an addition)
        this.setHalfCarryFlag((this.registers.A - value - carry) & 0xF, (value + carry) & 0xF); // Set H flag
        this.setCarryFlag(result); // Set C flag if there's a carry out of bit 7
    
        this.registers.PC++;
    }

    opcodeADC_A_C() { // 0x89: ADC A, C
        const carry = (this.registers.F & 0x10) ? 1 : 0; // Extract the carry flag (C)
        const value = this.registers.C; // Value to add from register C
        const result = this.registers.A + value + carry; // Add A, C, and carry

        this.registers.A = result & 0xFF; // Store the lower 8 bits back in A

        // Update flags
        this.setZeroFlag(this.registers.A); // Set Z flag if the result is zero
        this.setSubtractFlag(false); // Clear N flag (this is an addition)
        this.setHalfCarryFlag((this.registers.A - value - carry) & 0xF, (value + carry) & 0xF); // Set H flag
        this.setCarryFlag(result); // Set C flag if there's a carry out of bit 7

        this.registers.PC++;
    }

    opcodeSUB_A_H() { // 0x94: SUB A, H
        // Subtract the value in H from A.
        const result = this.registers.A - this.registers.H;

        this.registers.A = result & 0xFF; // Store only the lower 8 bits
        this.setZeroFlag(this.registers.A);
        this.setSubtractFlag(); // Subtraction operation
        this.setHalfCarryFlag(this.registers.A, this.registers.H);
        this.setCarryFlag(result);
    
        this.registers.PC++;
    }

    opcodeXOR_A_A() { // 0xAF: XOR A, A
        // Exclusive OR the A register with itself.
        // This operation always results in 0, clearing the A register.
        this.registers.A = 0; // XOR A with itself results in 0
        this.registers.F = 0x80; // Set Z flag, clear N, H, and C flags

        this.registers.PC++;
    }
            
    opcodeJP_nn() { // 0xC3: JP nn - Jump to address nn (16-bit immediate)
        const lowByte = this.memory[this.registers.PC + 1];  // Fetch lower byte (byte at PC+1)
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte (byte at PC+2)
        
        // Combine the two bytes into a 16-bit address (little-endian format)
        const address = (highByte << 8) | lowByte;
        
        this.registers.PC = address; // Set PC to the new address
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
    }

    opcodeCALL_Z_nn() { // 0xCC: CALL Z, nn
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
    }

    opcodeSUB_n() { // 0xD6: SUB n - Subtract immediate value n from A
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
        
        this.registers.PC++;
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
    }

    opcodeCALL_C_nn() { // 0xDC: CALL C, nn
        if (this.registers.F & 0x10) { // Check if the Carry flag (C) is set
            const lowByte = this.memory[this.registers.PC + 1];  // Fetch the lower byte of the address
            const highByte = this.memory[this.registers.PC + 2]; // Fetch the higher byte of the address
            const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address
    
            // Push the current PC + 3 (next instruction) onto the stack
            this.registers.SP -= 2; // Decrement SP by 2 to reserve space
            this.memory[this.registers.SP] = (this.registers.PC + 3) & 0xFF;         // Store lower byte of PC
            this.memory[this.registers.SP + 1] = ((this.registers.PC + 3) >> 8);    // Store higher byte of PC
    
            this.registers.PC = address; // Jump to the subroutine
        } else {
            this.registers.PC += 3; // Skip the immediate value if condition is not met
        }
    }

    opcodeRST_18H() { // 0xDF: RST 18H
        // restart instruction
        // Push the current PC onto the stack
        this.memory[--this.registers.SP] = (this.registers.PC >> 8) & 0xFF; // High byte
        this.memory[--this.registers.SP] = this.registers.PC & 0xFF;        // Low byte
    
        // Set the PC to 0x0018
        this.registers.PC = 0x0018;
    }

    opcodeLDH_n_A() { // 0xE0: LDH (n), A
        // Loads the value in the A register into memory at the address 0xFF00 + n, where n is an 8-bit immediate value
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value
        const address = 0xFF00 + n;                   // Calculate the target address
        this.memory[address] = this.registers.A;      // Store the value in A at the address

        this.registers.PC += 2; // Advance the program counter
    }

    opcodeAND_n() { // 0xE6: AND n
        const immediateValue = this.memory[this.registers.PC + 1]; // Fetch the immediate 8-bit value
        this.registers.A &= immediateValue; // Perform bitwise AND and store result in A
    
        // Update flags
        this.registers.F = 0; // Clear all flags
        this.setZeroFlag(this.registers.A); // Set Z flag if result is zero
        this.registers.F |= 0x20; // Set H flag (bit 5), always set for AND
    
        this.registers.PC += 2; // Advance PC by 2 (1 for opcode + 1 for immediate value)
    }

    opcodeLDAFromImmediateIO() { // 0xF0: LD A, (n)
        // Load the value from memory at address 0xFF00 + n into register A.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n
        this.registers.A = this.memory[0xFF00 + n];  // Load from memory address (0xFF00 + n)

        this.registers.PC += 2; // Advance PC by 2 (opcode + immediate value)
    }

    opcodeDI() { // 0xF3: DI - Disable interrupts
        this.disableInterrupts(); // Disable interrupt handling

        this.registers.PC++;
    }

    opcodeLD_A_nn() {
        // Load the value from memory at address nn into A.
        const lowByte = this.memory[this.registers.PC + 1]; // Fetch lower byte
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte
        const address = (highByte << 8) | lowByte; // Combine into 16-bit address

        this.registers.A = this.memory[address]; // Load value into A

        this.registers.PC += 3; // Advance PC by 3
    }

    opcodeCPAImmediate() { // 0xFE: CP A, n
        // Compare the value in A with the immediate value n.
        // This is a subtraction (A - n) without storing the result.
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n
        const result = this.registers.A - n;
    
        this.setZeroFlag(result & 0xFF);
        this.setSubtractFlag(); // Subtraction operation
        this.setHalfCarryFlag(this.registers.A, n);
        this.setCarryFlag(result);
    
        this.registers.PC += 2; // Advance PC by 2
    }

    opcodeRST38() { // 0xFF: RST 38H
        // Restart instruction, essentially a call to a fixed address (0x0038).
        // It pushes the PC onto the stack and then jumps to the specified address.
        const highByte = (this.registers.PC >> 8) & 0xFF;
        const lowByte = this.registers.PC & 0xFF;

        this.registers.SP -= 1;
        this.memory[this.registers.SP] = highByte; // Push high byte
        this.registers.SP -= 1;
        this.memory[this.registers.SP] = lowByte; // Push low byte

        // Jump to address 0x0038
        this.registers.PC = 0x0038;
    }
    //#endregion
}