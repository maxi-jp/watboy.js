class GameBoyCPU {

    get IF() { return this.memory[0xFF0F]; }
    get IE() { return this.memory[0XFFFF]; } // Interrupt Enable Register

    set IF(v) { this.memory[0xFF0F] = v; }
    set IE(v) { this.memory[0XFFFF] = v; }

    constructor(timer) {
        this.timer = timer;

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

        // Flags map -------------
        // Instruction Z  N  H  C
        // INC	       ✔  0  ✔  -
        // DEC	       ✔  1  ✔  -
        // ADD	       ✔  0  ✔  ✔
        // ADC	       ✔  0  ✔  ✔
        // SUB	       ✔  1  ✔  ✔
        // SBC	       ✔  1  ✔  ✔
        // CP	       ✔  1  ✔  ✔
        // AND	       ✔  0  1  0
        // OR/XOR      ✔  0  0  0
        // DAA         ✔  -  0  ✔

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

        this.serialBuffer = "";

        this.MBC = null;

        this.BIOSLoaded = false;
        this.BIOSExecuted = false;

        this.interruptsEnabled = false; // Disable interrupt handling
        this.stopEnabled = false;
        this.haltEnabled = false;
        this.imeScheduled = false; // Flag to delay enabling interrupts
        this.imeDelay = false;
        this.haltBug = false;

        this.INT = {
            VBLANK: 0x01,
            LCD:    0x02,
            TIMER:  0x04,
            SERIAL: 0x08,
            JOYPAD: 0x10
        };

        this.opcodeHandlers = {
            0x00: this.opcodeNOP.bind(this),
            0x01: this.opcodeLD_BC_nn.bind(this),
            0x02: this.opcodeLD_BC_A.bind(this),
            0x03: this.opcodeINC_BC.bind(this),
            0x04: this.opcodeINC_B.bind(this),
            0x05: this.opcodeDEC_B.bind(this),
            0x06: this.opcodeLD_B_n.bind(this),
            0x07: this.opcodeRLCA.bind(this),
            0x08: this.opcodeLD_nn_SP.bind(this),
            0x09: this.opcodeADD_HL_BC.bind(this),
            0x0A: this.opcodeLD_A_BC.bind(this),
            0x0B: this.opcodeDEC_BC.bind(this),
            0x0C: this.opcodeINC_C.bind(this),
            0x0D: this.opcodeDEC_C.bind(this),
            0x0E: this.opcodeLD_C_n.bind(this),
            0x0F: this.opcodeRRCA.bind(this),
            0x10: this.opcodeSTOP.bind(this),
            0x11: this.opcodeLD_DE_nn.bind(this),
            0x12: this.opcodeLD_DE_A.bind(this),
            0x13: this.opcodeINC_DE.bind(this),
            0x14: this.opcodeINC_D.bind(this),
            0x15: this.opcodeDEC_D.bind(this),
            0x16: this.opcodeLD_D_n.bind(this),
            0x17: this.opcodeRLA.bind(this),
            0x18: this.opcodeJR_n.bind(this),
            0x19: this.opcodeADD_HL_DE.bind(this),
            0x1A: this.opcodeLD_A_DE.bind(this),
            0x1B: this.opcodeDEC_DE.bind(this),
            0x1C: this.opcodeINC_E.bind(this),
            0x1D: this.opcodeDEC_E.bind(this),
            0x1E: this.opcodeLD_E_n.bind(this),
            0x1F: this.opcodeRRA.bind(this),
            0x20: this.opcodeJR_NZ_n.bind(this),
            0x21: this.opcodeLD_HL_nn.bind(this),
            0x22: this.opcodeLD_HLplus_A.bind(this),
            0x23: this.opcodeINC_HL.bind(this),
            0x24: this.opcodeINC_H.bind(this),
            0x25: this.opcodeDEC_H.bind(this),
            0x26: this.opcodeLD_H_n.bind(this),
            0x27: this.opcodeDAA.bind(this),
            0x28: this.opcodeJR_Z_n.bind(this),
            0x29: this.opcodeADD_HL_HL.bind(this),
            0x2A: this.opcodeLD_A_HLplus.bind(this),
            0x2B: this.opcodeDEC_HL.bind(this),
            0x2C: this.opcodeINC_L.bind(this),
            0x2D: this.opcodeDEC_L.bind(this),
            0x2E: this.opcodeLD_L_n.bind(this),
            0x2F: this.opcodeCPL.bind(this),
            0x30: this.opcodeJR_NC_n.bind(this),
            0x31: this.opcodeLD_SP_nn.bind(this),
            0x32: this.opcodeLD_HLm_A.bind(this),
            0x33: this.opcodeINC_SP.bind(this),
            0x34: this.opcodeINC_HL_mem.bind(this),
            0x35: this.opcodeDEC_HL_mem.bind(this),
            0x36: this.opcodeLD_HL_n.bind(this),
            0x37: this.opcodeSCF.bind(this),
            0x38: this.opcodeJR_C_n.bind(this),
            0x39: this.opcodeADD_HL_SP.bind(this),
            0x3A: this.opcodeLD_A_HLminus.bind(this),
            0x3B: this.opcodeDEC_SP.bind(this),
            0x3C: this.opcodeINC_A.bind(this),
            0x3D: this.opcodeDEC_A.bind(this),
            0x3E: this.opcodeLD_A_n.bind(this),
            0x3F: this.opcodeCCF.bind(this),
            0x40: this.opcodeLD_B_B.bind(this),
            0x41: this.opcodeLD_B_C.bind(this),
            0x42: this.opcodeLD_B_D.bind(this),
            0x43: this.opcodeLD_B_E.bind(this),
            0x44: this.opcodeLD_B_H.bind(this),
            0x45: this.opcodeLD_B_L.bind(this),
            0x46: this.opcodeLD_B_HL.bind(this),
            0x47: this.opcodeLD_B_A.bind(this),
            0x48: this.opcodeLD_C_B.bind(this),
            0x49: this.opcodeLD_C_C.bind(this),
            0x4A: this.opcodeLD_C_D.bind(this),
            0x4B: this.opcodeLD_C_E.bind(this),
            0x4C: this.opcodeLD_C_H.bind(this),
            0x4D: this.opcodeLD_C_L.bind(this),
            0x4E: this.opcodeLD_C_HL.bind(this),
            0x4F: this.opcodeLD_C_A.bind(this),
            0x50: this.opcodeLD_D_B.bind(this),
            0x56: this.opcodeLD_D_HL.bind(this),
            0x57: this.opcodeLD_D_A.bind(this),
            0x5C: this.opcodeLD_E_H.bind(this),
            0x5D: this.opcodeLD_E_L.bind(this),
            0x5E: this.opcodeLD_E_HL.bind(this),
            0x5F: this.opcodeLD_E_A.bind(this),
            0x60: this.opcodeLD_H_B.bind(this),
            0x62: this.opcodeLD_H_D.bind(this),
            0x66: this.opcodeLD_H_HL.bind(this),
            0x67: this.opcodeLD_H_A.bind(this),
            0x6B: this.opcodeLD_L_E.bind(this),
            0x6E: this.opcodeLD_L_HL.bind(this),
            0x6F: this.opcodeLD_L_A.bind(this),
            0x70: this.opcodeLD_HL_B.bind(this),
            0x71: this.opcodeLD_HL_C.bind(this),
            0x72: this.opcodeLD_HL_D.bind(this),
            0x73: this.opcodeLD_HL_E.bind(this),
            0x75: this.opcodeLD_HL_L.bind(this),
            0x76: this.opcodeHALT.bind(this),
            0x77: this.opcodeLD_HL_A.bind(this),
            0x78: this.opcodeLD_A_B.bind(this),
            0x79: this.opcodeLD_A_C.bind(this),
            0x7A: this.opcodeLD_A_D.bind(this),
            0x7B: this.opcodeLD_A_E.bind(this),
            0x7C: this.opcodeLD_A_H.bind(this),
            0x7D: this.opcodeLD_A_L.bind(this),
            0x7E: this.opcodeLD_A_HL.bind(this),
            0x7F: this.opcodeLD_A_A.bind(this),
            0x80: this.opcodeADD_A_B.bind(this),
            0x81: this.opcodeADD_A_C.bind(this),
            0x83: this.opcodeADD_A_E.bind(this),
            0x84: this.opcodeADD_A_H.bind(this),
            0x85: this.opcodeADD_A_L.bind(this),
            0x86: this.opcodeADD_A_HL_mem.bind(this),
            0x87: this.opcodeADD_A_A.bind(this),
            0x88: this.opcodeADC_A_B.bind(this),
            0x89: this.opcodeADC_A_C.bind(this),
            0x8C: this.opcodeADC_A_H.bind(this),
            0x91: this.opcodeSUB_C.bind(this),
            0x94: this.opcodeSUB_A_H.bind(this),
            0x9A: this.opcodeSBC_A_D.bind(this),
            0xA1: this.opcodeAND_C.bind(this),
            0xA7: this.opcodeAND_A.bind(this),
            0xA9: this.opcodeXOR_C.bind(this),
            0xAD: this.opcodeXOR_L.bind(this),
            0xAE: this.opcodeXOR_HL.bind(this),
            0xAF: this.opcodeXOR_A_A.bind(this),
            0xB0: this.opcodeOR_B.bind(this),
            0xB1: this.opcodeOR_C.bind(this),
            0xB4: this.opcodeOR_H.bind(this),
            0xB6: this.opcodeOR_HL_mem.bind(this),
            0xB7: this.opcodeOR_A.bind(this),
            0xB8: this.opcodeCP_B.bind(this),
            0xB9: this.opcodeCP_C.bind(this),
            0xBA: this.opcodeCP_D.bind(this),
            0xBB: this.opcodeCP_E.bind(this),
            0xBC: this.opcodeCP_H.bind(this),
            0xBD: this.opcodeCP_L.bind(this),
            0xBE: this.opcodeCP_HL.bind(this),
            0xBF: this.opcodeCP_A.bind(this),
            0xC0: this.opcodeRET_NZ.bind(this),
            0xC1: this.opcodePOP_BC.bind(this),
            0xC2: this.opcodeJP_NZ_nn.bind(this),
            0xC3: this.opcodeJP_nn.bind(this),
            0xC4: this.opcodeCALL_NZ_nn.bind(this),
            0xC5: this.opcodePUSH_BC.bind(this),
            0xC6: this.opcodeADD_A_n.bind(this),
            0xC9: this.opcodeRET.bind(this),
            0xC8: this.opcodeRET_Z.bind(this),
            0xCA: this.opcodeJP_Z_nn.bind(this),
            0xCB: this.opcodeCB.bind(this),
            0xCC: this.opcodeCALL_Z_nn.bind(this),
            0xCD: this.opcodeCALL_nn.bind(this),
            0xCE: this.opcodeADC_A_n.bind(this),
            0xD0: this.opcodeRET_NC.bind(this),
            0xD1: this.opcodePOP_DE.bind(this),
            0xD3: this.opcodeILLEGAL.bind(this),
            0xD5: this.opcodePUSH_DE.bind(this),
            0xD4: this.opcodeCALL_NC_nn.bind(this),
            0xD6: this.opcodeSUB_n.bind(this),
            0xD8: this.opcodeRET_C.bind(this),
            0xD9: this.opcodeRETI.bind(this),
            0xDB: this.opcodeILLEGAL.bind(this),
            0xDE: this.opcodeSBC_A_n.bind(this),
            0xDD: this.opcodeILLEGAL.bind(this),
            0xDC: this.opcodeCALL_C_nn.bind(this),
            0xDF: this.opcodeRST_18H.bind(this),
            0xE0: this.opcodeLDH_n_A.bind(this),
            0xE1: this.opcodePOP_HL.bind(this),
            0xE2: this.opcodeLD_C_mem_A.bind(this),
            0xE3: this.opcodeILLEGAL.bind(this),
            0xE4: this.opcodeILLEGAL.bind(this),
            0xE5: this.opcodePUSH_HL.bind(this),
            0xE6: this.opcodeAND_n.bind(this),
            0xE8: this.opcodeADD_SP_n.bind(this),
            0xE9: this.opcodeJP_HL.bind(this),
            0xEA: this.opcodeLD_nn_A.bind(this),
            0xEB: this.opcodeILLEGAL.bind(this),
            0xEC: this.opcodeILLEGAL.bind(this),
            0xED: this.opcodeILLEGAL.bind(this),
            0xEE: this.opcodeXOR_n.bind(this),
            0xEF: this.opcodeRST_28H.bind(this),
            0xF0: this.opcodeLDAFromImmediateIO.bind(this),
            0xF1: this.opcodePOP_AF.bind(this),
            0xF3: this.opcodeDI.bind(this),
            0xF4: this.opcodeILLEGAL.bind(this),
            0xF5: this.opcodePUSH_AF.bind(this),
            0xF6: this.opcodeOR_n.bind(this),
            0xF8: this.opcodeLD_HL_SP_plus_n.bind(this),
            0xF9: this.opcodeLD_SP_HL.bind(this),
            0xFA: this.opcodeLD_A_nn.bind(this),
            0xFB: this.opcodeEI.bind(this),
            0xFC: this.opcodeILLEGAL.bind(this),
            0xFD: this.opcodeILLEGAL.bind(this),
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

    writeMemory(address, value) {
        // Writing to the DIV register (0xFF04) resets its internal counter to 0 (the value written is ignored).
        if (address === 0xFF04) {
            this.timer.resetDiv();
            return;
        }

        // memory write operation
        this.memory[address] = value;

         // Mirror Work RAM <-> Echo RAM
        if (address >= 0xC000 && address <= 0xDDFF) {
            // Write to Echo RAM
            this.memory[address + 0x2000] = value;
        }
        else if (address >= 0xE000 && address <= 0xFDFF) {
            // Write to Work RAM
            this.memory[address - 0x2000] = value;
        }

        // check for serial output
        if (address === 0xFF02 && value === 0x81) {
            // Print the character in 0xFF01
            const char = String.fromCharCode(this.memory[0xFF01]);
            this.serialBuffer += char;
            if (char === '\n' || this.serialBuffer.endsWith("ok")) {
                console.log("SERIAL:", this.serialBuffer.trim());
                this.serialBuffer = "";
            }
        }
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
        // Clear any delayed IME enable from previous instruction
        if (this.imeDelay) {
            this.enableInterrupts();
            this.imeDelay = false;
        }

        const interruptCycles = this.handleInterrupts();
        if (interruptCycles > 0) {
            this.timer.update(interruptCycles);
            return interruptCycles;
        }

        const pcBefore = this.registers.PC;
        // console.log(`Before instruction: PC=0x${pcBefore.toString(16)}, A=0x${this.registers.A.toString(16)}, F=0x${this.registers.F.toString(16)}, IF=0x${this.IF.toString(16)}, IE=0x${this.IE.toString(16)}, IME=${this.interruptsEnabled}`);

        if (this.haltEnabled) {
            // return 4; // CPU is halted, burn 4 cycles and check for interrupts again next time.

            const pendingInterrupts = (this.IF & this.IE & 0x1F) !== 0;
            if (!pendingInterrupts) {
                console.log(`CPU halted, no pending interrupts (IF=0x${this.IF.toString(16)}, IE=0x${this.IE.toString(16)})`);
                this.timer.update(4);
                return 4;
            }
            console.log("Resuming from HALT due to pending interrupt");
            this.haltEnabled = false;
        }

        if (!this.BIOSExecuted && this.BIOSLoaded && this.registers.PC >= 0x0100) {
            // BIOS finished execution
            console.log(`Unmapping BIOS at PC=0x${this.registers.PC.toString(16)}`);
            
            this.unmapBIOS(); // switch to cartridge ROM

            this.BIOSExecuted = true;
        }

        const opcode = this.memory[pcBefore];
        const handler = this.opcodeHandlers[opcode];

        let elapsedClockTicks = 4; // Default cycles
        if (handler) {
            this.lastOpcodeHandlerName = handler.name.split(" ")[1].split("opcode")[1];

            elapsedClockTicks = handler() || 4;
        }
        else {
            this.lastOpcodeHandlerName = "UNKNOWN";
            console.warn(`Unimplemented opcode: 0x${opcode.toString(16)} at address 0x${this.registers.PC.toString(16)}`);
            this.registers.PC = (this.registers.PC + 1) & 0xFFFF; // Skip the unhandled opcode
        }

        if (this.haltBug) {
            // The HALT bug causes the PC to not be incremented after the instruction following HALT.
            // We emulate this by setting the PC back to what it was before the instruction ran.
            console.log(`HALT bug: Re-executing instruction at PC=0x${pcBefore.toString(16)}, Opcode=0x${this.memory[pcBefore].toString(16)}, A=0x${this.registers.A.toString(16)}`);
            this.registers.PC = pcBefore;
            this.haltBug = false;
        }

        // The IME scheduled by EI should take effect after the next instruction
        if (this.imeScheduled) {
            this.imeDelay = true;
            this.imeScheduled = false;
        }

        // Update timer after instruction execution
        this.timer.update(elapsedClockTicks);

        return elapsedClockTicks;
    }

    getGameNameFromMemory() {
        return String.fromCharCode(...this.memory.slice(cartridgeNameAdress[0], cartridgeNameAdress[1]));
    }

    handleInterrupts() {
        const IF = this.IF; // Interrupt Flag register
        const IE = this.IE; // Interrupt Enable register

        const fired = IF & IE & 0x1F; // Only check the 5 interrupt bits

        if (!this.interruptsEnabled) {
            if (this.haltEnabled && fired !== 0) {
                // Wake from HALT but don't service interrupts when IME=0
                this.haltEnabled = false;
                console.log("HALT exit due to pending interrupt");
            }
            return 0;
        }

        // console.log(`Interrupt check:
        //     IF=${IF.toString(2).padStart(8,'0')} (${IF.toString(16)})
        //     IE=${IE.toString(2).padStart(8,'0')} (${IE.toString(16)})
        //     Fired=${fired.toString(2).padStart(8,'0')} (${fired.toString(16)})
        //     PC=0x${this.registers.PC.toString(16)}
        // `);
        
        if (fired === 0) {
            return 0;
        }

        // An interrupt occurred, wake from HALT
        this.haltEnabled = false;

        // Standard interrupt sequence (5 M-cycles):
        // M1: Opcode fetch (discarded)
        // M2: Push PCh
        // M3: Push PCl
        // M4-M5: Jump to vector

        // Push current PC to stack before handling interrupt
        const returnAddr = this.registers.PC;
        this.push((returnAddr >> 8) & 0xFF, returnAddr & 0xFF);
        console.log(`Pushed return address 0x${returnAddr.toString(16)} to stack`);

        // Disable master interrupt flag
        this.interruptsEnabled = false;
        console.log("Disabled interrupts for handler");

        // An interrupt handling sequence takes 5 machine cycles (20 clock cycles).
        
        // Handle individual interrupts in priority order
        let handlerAddr = 0;
        // V-Blank Interrupt (Priority 0)
        if (fired & this.INT.VBLANK) {
            this.IF &= ~this.INT.VBLANK; // Clear V-Blank interrupt flag
            handlerAddr = 0x0040;
        }
        // LCD STAT Interrupt (Priority 1)
        else if (fired & this.INT.LCD) {
            this.IF &= ~this.INT.LCD; // Clear LCD STAT interrupt flag
            handlerAddr = 0x0048;
        }
        // Timer Interrupt (Priority 2)
        else if (fired & this.INT.TIMER) {
            this.IF &= ~this.INT.TIMER; // Clear Timer interrupt flag
            handlerAddr = 0x0050;

            console.log("Timer interrupt handled, A=", this.registers.A.toString(16));
        }
        // Serial Interrupt (Piority 3)
        else if (fired & this.INT.SERIAL) {
            this.IF &= ~this.INT.SERIAL; // Clear Serial interrupt flagº
            handlerAddr = 0x0058;
        }
        // Joypad Interrupt (Priority 4)
        else if (fired & this.INT.JOYPAD) {
            this.IF &= ~this.INT.JOYPAD; // Clear Joypad interrupt flag;
            handlerAddr = 0x0060;
        }

        console.log(`Jumping to interrupt handler at 0x${handlerAddr.toString(16)}`);
        console.log(`Handler contains opcodes: ${Array.from(this.memory.slice(handlerAddr, handlerAddr + 4)).map(x => x.toString(16).padStart(2, '0')).join(' ')}`);
        this.registers.PC = handlerAddr;

        return 20; // 5 M-cycles (20 T-cycles)
    }

    requestInterrupt(type) {
        // let IFval = this.IF;
        // IFval |= type
        // this.writeMemory(0xFF0F, IFval);
        this.IF |= type;
        this.haltEnabled = false;
    }

    enableInterrupts() {
        this.interruptsEnabled = true; // Enable interrupt handling
    }

    disableInterrupts() {
        this.interruptsEnabled = false; // Disable interrupt handling
    }

// #region flags update helper functions

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

    setHalfCarryFlagForAdd(a, b, c = 0) {
        if (((a & 0xF) + (b & 0xF) + c) > 0xF) {
            this.registers.F |= 0x20; // Set H flag
        }
        else {
            this.registers.F &= ~0x20; // Clear H flag
        }
    }

    // Set the Carry flag (C) based on the subtraction result
    setCarryFlag(isSet) {
        if (isSet) {
            this.registers.F |= 0x10; // Set C flag (bit 4)
        }
        else {
            this.registers.F &= ~0x10; // Clear C flag (bit 4)
        }
    }

    setHalfCarryFlagForAdd(a, b, c = 0) {
        if (((a & 0xF) + (b & 0xF) + c) > 0xF) {
            this.registers.F |= 0x20; // Set H flag
        }
        else {
            this.registers.F &= ~0x20; // Clear H flag
        }
    }

// #endregion (flags update helper functions)

// #region opcode helper functions

    // Helper function to add a value to the A register and update flags
    add(value) {
        const originalA = this.registers.A;
        const result = originalA + value;
        this.registers.A = result & 0xFF;

        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.setHalfCarryFlagForAdd(originalA, value);
        this.setCarryFlag(result > 0xFF);
    }

    // Helper function for 16-bit additions (ADD HL, rr)
    add16(value) {
        const originalHL = this.registers.HL;
        const result = originalHL + value;

        // N is reset
        this.registers.F &= ~0x40;

        // H is set if carry from bit 11
        if ((originalHL & 0x0FFF) + (value & 0x0FFF) > 0x0FFF) {
            this.registers.F |= 0x20; // Set H
        }
        else {
            this.registers.F &= ~0x20; // Clear H
        }

        // C is set if carry from bit 15
        if (result > 0xFFFF) {
            this.registers.F |= 0x10; // Set C
        }
        else {
            this.registers.F &= ~0x10; // Clear C
        }

        this.registers.HL = result & 0xFFFF;
    }

    // Helper function to add with carry a value to the A register and update flags
    adc(value) {
        const originalA = this.registers.A;
        const carry = (this.registers.F & 0x10) ? 1 : 0;
        const result = originalA + value + carry;
        this.registers.A = result & 0xFF;

        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.setHalfCarryFlagForAdd(originalA, value, carry);
        this.setCarryFlag(result > 0xFF);
    }

    // Helper function to subtract a value from the A register and update flags
    sub(value) {
        const originalA = this.registers.A;
        const result = originalA - value;
        this.registers.A = result & 0xFF;

        this.setZeroFlag(this.registers.A);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalA, value);
        this.setCarryFlag(result < 0);
    }

    // Helper function to subtract with carry a value from the A register and update flags
    sbc(value) {
        const originalA = this.registers.A;
        const carry = (this.registers.F & 0x10) ? 1 : 0;
        const result = originalA - value - carry;
        this.registers.A = result & 0xFF;

        this.setZeroFlag(this.registers.A);
        this.setSubtractFlag();

        // Half Carry: check for borrow from bit 4
        if ((originalA & 0xF) < ((value & 0xF) + carry)) {
            this.registers.F |= 0x20; // Set H
        }
        else {
            this.registers.F &= ~0x20; // Clear H
        }

        this.setCarryFlag(result < 0);
    }

    // Helper function to AND a value with the A register and update flags
    and(value) {
        this.registers.A &= value;

        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.registers.F |= 0x20; // Set H flag
        this.setCarryFlag(false); // Clear C flag
    }

    // Helper function to OR a value with the A register and update flags
    or(value) {
        this.registers.A |= value;

        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.registers.F &= ~0x20; // Clear H flag
        this.setCarryFlag(false); // Clear C flag
    }

    // Helper function to XOR a value with the A register and update flags
    xor(value) {
        this.registers.A ^= value;

        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.registers.F &= ~0x20; // Clear H flag
        this.setCarryFlag(false); // Clear C flag
    }

    // Helper function to compare a value with the A register and update flags
    cp(value) {
        const originalA = this.registers.A;
        const result = originalA - value;

        this.setZeroFlag(result & 0xFF);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalA, value);
        this.setCarryFlag(result < 0);
    }

    // Helper for PUSH opcodes
    push(highByte, lowByte) {
        // write to stack with direct memory access to avoid triggering I/O handlers
        this.registers.SP = (this.registers.SP - 1) & 0xFFFF;
        this.memory[this.registers.SP] = highByte & 0xFF;
        // mirror Work RAM <-> Echo RAM if applicable
        if (this.registers.SP >= 0xC000 && this.registers.SP <= 0xDDFF) {
            this.memory[this.registers.SP + 0x2000] = this.memory[this.registers.SP];
        }

        this.registers.SP = (this.registers.SP - 1) & 0xFFFF;
        this.memory[this.registers.SP] = lowByte & 0xFF;
        if (this.registers.SP >= 0xC000 && this.registers.SP <= 0xDDFF) {
            this.memory[this.registers.SP + 0x2000] = this.memory[this.registers.SP];
        }
    }

    // Helper for POP opcodes
    pop() {
        const lowByte = this.memory[this.registers.SP];
        this.registers.SP = (this.registers.SP + 1) & 0xFFFF;
        const highByte = this.memory[this.registers.SP];
        this.registers.SP = (this.registers.SP + 1) & 0xFFFF;
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
            case 6: this.writeMemory(this.registers.HL, value); break; // (HL)
            case 7: this.registers.A = value; break;
        }
    }

// #endregion (opcode helper functions)

// #region opcode functions

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
        this.writeMemory(bc, this.registers.A);
        
        this.registers.PC++;
        return 8;
    }

    opcodeINC_BC() { // 0x03: INC BC - Increment BC register pair
        this.registers.BC++;

        this.registers.PC++;
        return 8;
    }

    opcodeINC_B() { // 0x04: INC B
        const originalValue = this.registers.B;
        this.registers.B = (originalValue + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.B);
        this.clearSubtractFlag(); // N is cleared
        // Set H if carry from bit 3
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_B() { // 0x05: DEC B
        //  Decrement B
        const originalB = this.registers.B;
        this.registers.B = (this.registers.B - 1) & 0xFF;

        // Update the flags
        this.setZeroFlag(this.registers.B);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalB, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_n() { // 0x06: LD B, n
        // Load immediate value into B
        this.registers.B = this.memory[this.registers.PC + 1];
        
        this.registers.PC += 2; // Opcode consumes 2 bytes
        return 8;
    }

    opcodeRLCA() { // 0x07: RLCA
        // Rotate A left. Bit 7 goes to Carry and to bit 0.
        const msb = (this.registers.A >> 7) & 1; // Most significant bit
        this.registers.A = ((this.registers.A << 1) | msb) & 0xFF;

        // Update flags: Z, N, H are cleared. C is set from old bit 7.
        this.registers.F = 0;
        if (msb) {
            this.registers.F |= 0x10; // Set Carry flag
        }
        this.registers.PC++;
        return 4;
    }

    opcodeLD_nn_SP() { // 0x08: { // LD (nn), SP
        // Fetch the 16-bit address from the next two bytes in memory (little-endian)
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        const address = (highByte << 8) | lowByte;
    
        // Store the lower and upper bytes of SP into memory at the specified address
        this.writeMemory(address, this.registers.SP & 0xFF);         // Low byte of SP
        this.writeMemory(address + 1, (this.registers.SP >> 8) & 0xFF); // High byte of SP
    
        this.registers.PC += 3; // Instruction size is 3 bytes
        return 20;
    }

    opcodeADD_HL_BC() { // 0x09: ADD HL, BC
        // Adds the 16-bit value of BC to HL.
        this.add16(this.registers.BC);
        this.registers.PC++;
        return 8;
    }

    opcodeDEC_BC() { // 0x0B: DEC BC
        // Decrement BC register pair. No flags affected.
        this.registers.BC--;
        this.registers.PC++;
        return 8;
    }

    opcodeLD_A_BC() { // 0x0A: LD A, (BC)
        // Load the byte from the memory address specified by BC into A.
        this.registers.A = this.memory[this.registers.BC];
        this.registers.PC++;
        return 8;
    }

    opcodeINC_C() { // 0x0C: INC C
        const originalValue = this.registers.C;
        this.registers.C = (originalValue + 1) & 0xFF;
    
        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.C);
        this.clearSubtractFlag(); // N is cleared
        this.setHalfCarryFlagForAdd(originalValue, 1);
    
        this.registers.PC++;
        return 4;
    }

    opcodeDEC_C() { // 0x0D: DEC C
        const originalC = this.registers.C;
        this.registers.C = (this.registers.C - 1) & 0xFF; // Decrement C and ensure it stays within 8 bits
    
        // Update the flags
        this.setZeroFlag(this.registers.C);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalC, 1);
    
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

    opcodeLD_DE_A() { // 0x12: LD (DE), A
        // Store A into memory address DE.
        this.writeMemory(this.registers.DE, this.registers.A);
        
        this.registers.PC++;
        return 8;
    }

    opcodeINC_D() { // 0x14: INC D
        const originalValue = this.registers.D;
        this.registers.D = (originalValue + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.D);
        this.clearSubtractFlag(); // N is cleared
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_D() { // 0x15: DEC D
        // Decrements register D.
        const originalD = this.registers.D;
        this.registers.D = (originalD - 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.D);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalD, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeLD_D_n() { // 0x16: LD D, n
        // Loads an immediate 8-bit value into register D.
        this.registers.D = this.memory[this.registers.PC + 1];
        this.registers.PC += 2;
        return 8;
    }

    opcodeADD_HL_DE() { // 0x19: ADD HL, DE
        // Adds the 16-bit value of DE to HL.
        this.add16(this.registers.DE);
        this.registers.PC++;
        return 8;
    }

    opcodeRLA() { // 0x17: RLA
        // Rotates register A left through the Carry flag.
        const oldCarry = (this.registers.F & 0x10) ? 1 : 0;
        const newCarry = (this.registers.A >> 7) & 1;

        this.registers.A = ((this.registers.A << 1) | oldCarry) & 0xFF;

        // Flags: Z, N, H are cleared. C is set from bit 7 of old A.
        this.registers.F = 0;
        if (newCarry) {
            this.registers.F |= 0x10; // Set C flag
        }
        this.registers.PC++;
        return 4;
    }

    opcodeDEC_DE() { // 0x1B: DEC DE
        // Decrement DE register pair. No flags affected.
        this.registers.DE--;
        this.registers.PC++;
        return 8;
    }

    opcodeRRA() { // 0x1F: RRA
        // Rotate A right through Carry flag.
        const oldCarry = (this.registers.F & 0x10) ? 1 : 0; // Get current carry
        const newCarry = this.registers.A & 0x01; // LSB of A will be the new carry

        this.registers.A = (this.registers.A >> 1) | (oldCarry << 7);

        // Update flags: Z, N, H are cleared. C is set from bit 0 of A.
        this.registers.F = 0;
        if (newCarry) {
            this.registers.F |= 0x10; // Set C flag
        }

        this.registers.PC++;
        return 4;
    }

    opcodeINC_E() { // 0x1C: INC E
        const originalValue = this.registers.E;
        this.registers.E = (originalValue + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.E);
        this.clearSubtractFlag(); // N is cleared
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeLD_E_n() { // 0x1E: LD E, n
        // Load immediate 8-bit value into E.
        this.registers.E = this.memory[this.registers.PC + 1];
        this.registers.PC += 2;
        return 8;
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

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.E);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalE, 1);

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

    opcodeDEC_HL() { // 0x2B: DEC HL
        // Decrement HL register pair. No flags affected.
        this.registers.HL--;
        this.registers.PC++;
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
        this.writeMemory(this.registers.HL, this.registers.A);
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
        const originalValue = this.registers.H;
        this.registers.H = (originalValue + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.H);
        this.clearSubtractFlag(); // N is cleared
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_H() { // 0x25: DEC H
        // Decrements the H register by one.
        const originalH = this.registers.H;
        this.registers.H = (originalH - 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.H);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalH, 1);

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
        const originalValue = this.registers.L;
        this.registers.L = (originalValue + 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.L);
        this.clearSubtractFlag(); // N is cleared
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_L() { // 0x2D: DEC L
        // Decrements the L register.
        const originalL = this.registers.L;
        this.registers.L = (originalL - 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.L);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalL, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeLD_L_n() { // 0x2E: LD L, n
        // Load immediate 8-bit value into L.
        this.registers.L = this.memory[this.registers.PC + 1];
        this.registers.PC += 2;
        return 8;
    }

    opcodeCPL() { // 0x2F: CPL
        // Complement A (bitwise NOT).
        this.registers.A = ~this.registers.A;
        // Set N and H flags.
        this.registers.F |= 0x60; // Set N and H flags
        this.registers.PC++;
        return 4;
    }

    opcodeADD_HL_HL() { // 0x29: ADD HL, HL
        this.add16(this.registers.HL);
        this.registers.PC++;
        return 8;
    }

    opcodeDAA() { // 0x27: DAA (Decimal Adjust Accumulator)
        let a = this.registers.A;
        let correction = 0;
        let carry = (this.registers.F & 0x10) !== 0;

        if (!(this.registers.F & 0x40)) { // N flag is not set (addition)
            if (carry || (a > 0x99)) {
                correction = 0x60;
                carry = true;
            }
            if ((this.registers.F & 0x20) || ((a & 0x0F) > 0x09)) {
                correction |= 0x06;
            }
            a += correction;
        }
        else { // N flag is set (subtraction)
            if (carry) {
                correction = 0x60;
            }
            if (this.registers.F & 0x20) {
                correction |= 0x06;
            }
            a -= correction;
        }

        this.registers.A = a & 0xFF;

        // Update flags
        this.setZeroFlag(this.registers.A);
        this.registers.F &= ~0x20; // H flag is always cleared

        if (carry) {
            this.registers.F |= 0x10;
        }
        else {
            this.registers.F &= ~0x10;
        }
        this.registers.PC++;
        return 4;
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

    opcodeJR_C_n() { // 0x38: JR C, n
        // Jump relative by n if Carry flag is set.
        const n = this.memory[this.registers.PC + 1];
        if ((this.registers.F & 0x10) !== 0) {
            this.registers.PC += signedValue(n) + 2;
            return 12; // Cycles for jump taken
        }
        else {
            this.registers.PC += 2;
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
        this.writeMemory(this.registers.HL, this.registers.A);
        this.registers.HL--;

        this.registers.PC++;
        return 8;
    }

    opcodeINC_SP() { // 0x33: INC SP
        // Increment Stack Pointer. No flags affected.
        this.registers.SP = (this.registers.SP + 1) & 0xFFFF;
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_n() { // 0x36: LD (HL), n
        // Load immediate 8-bit value n into memory at address HL.
        const n = this.memory[this.registers.PC + 1];
        this.writeMemory(this.registers.HL, n);
        this.registers.PC += 2;
        return 12;
    }

    opcodeSCF() { // 0x37: SCF (Set Carry Flag)
        // Set Carry flag. Clear N and H flags.
        this.registers.F |= 0x10;  // Set C
        this.registers.F &= ~0x60; // Clear N and H
        this.registers.PC++;
        return 4;
    }

    opcodeADD_HL_SP() { // 0x39: ADD HL, SP
        // Adds the 16-bit value of SP to HL.
        this.add16(this.registers.SP);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_A_HLminus() { // 0x3A: LD A, (HL-)
        // Load value from address HL into A, then decrement HL.
        this.registers.A = this.memory[this.registers.HL];
        this.registers.HL--;
        this.registers.PC++;
        return 8;
    }

    opcodeDEC_SP() { // 0x3B: DEC SP
        // Decrement Stack Pointer. No flags affected.
        this.registers.SP = (this.registers.SP - 1) & 0xFFFF;
        this.registers.PC++;
        return 8;
    }

    opcodeINC_HL_mem() { // 0x34: INC (HL)
        // Increment the byte at the memory address in HL.
        const address = this.registers.HL;
        const originalValue = this.memory[address];
        const result = (originalValue + 1) & 0xFF;
        this.writeMemory(address, result);

        // Update flags (Z, N, H)
        this.setZeroFlag(result);
        this.clearSubtractFlag();
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 12;
    }

    opcodeDEC_HL_mem() { // 0x35: DEC (HL)
        // Decrements the byte at the memory address pointed to by HL.
        const address = this.registers.HL;
        const originalValue = this.memory[address];
        const result = (originalValue - 1) & 0xFF;
        this.writeMemory(address, result);

        // Update flags (Z, N, H)
        this.setZeroFlag(result);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalValue, 1); // Half-carry for decrement is when bit 4 borrows from bit 3
        // C flag is not affected

        this.registers.PC++;
        return 12;
    }

    opcodeINC_A() { // 0x3C: INC A
        const originalValue = this.registers.A;
        this.registers.A = (originalValue + 1) & 0xFF;
    
        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.A);
        this.clearSubtractFlag();
        this.setHalfCarryFlagForAdd(originalValue, 1);

        this.registers.PC++;
        return 4;
    }

    opcodeDEC_A() { // 0x3D: DEC A
        // Decrements register A.
        const originalA = this.registers.A;
        this.registers.A = (originalA - 1) & 0xFF;

        // Update flags (Z, N, H)
        this.setZeroFlag(this.registers.A);
        this.setSubtractFlag();
        this.setHalfCarryFlag(originalA, 1);
        // C flag is not affected

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

    opcodeCCF() { // 0x3F: CCF (Complement Carry Flag)
        // Invert the Carry flag. Clear N and H flags.
        this.registers.F ^= 0x10;  // Toggle C
        this.registers.F &= ~0x60; // Clear N and H
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_B() { // 0x40: LD B, B
        // No operation.
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_C() { // 0x41: LD B, C
        this.registers.B = this.registers.C;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_D() { // 0x42: LD B, D
        // Load the value of register D into register B.
        this.registers.B = this.registers.D;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_E() { // 0x43: LD B, E
        this.registers.B = this.registers.E;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_L() { // 0x45: LD B, L
        this.registers.B = this.registers.L;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_A() { // 0x47: LD B, A
        // Load the value of register A into register B.
        this.registers.B = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_H() { // 0x44: LD B, H
        // Load the value of register H into register B.
        this.registers.B = this.registers.H;

        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_B() { // 0x48: LD C, B
        this.registers.C = this.registers.B;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_C() { // 0x49: LD C, C
        // No operation.
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_D() { // 0x4A: LD C, D
        this.registers.C = this.registers.D;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_E() { // 0x4B: LD C, E
        this.registers.C = this.registers.E;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_H() { // 0x4C: LD C, H
        this.registers.C = this.registers.H;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_L() { // 0x4D: LD C, L
        this.registers.C = this.registers.L;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_B_HL() { // 0x46: LD B, (HL)
        // Loads a byte from the memory address in HL into register B.
        this.registers.B = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_D_B() { // 0x50: LD D, B
        this.registers.D = this.registers.B;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_A() { // 0x4F: LD C, A
        // Load the value of register A into register C.
        this.registers.C = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_C_HL() { // 0x4E: LD C, (HL)
        // Loads a byte from the memory address in HL into register C.
        this.registers.C = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_E_A() { // 0x5F: LD E, A
        // Load the value of register A into register E.
        this.registers.E = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_D_HL() { // 0x56: LD D, (HL)
        // Loads a byte from the memory address in HL into register D.
        this.registers.D = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_E_H() { // 0x5C: LD E, H
        // Loads the value from register H into E.
        this.registers.E = this.registers.H;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_E_L() { // 0x5D: LD E, L
        // Load L into E.
        this.registers.E = this.registers.L;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_E_HL() { // 0x5E: LD E, (HL)
        // Load value from memory at (HL) into E.
        this.registers.E = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_H_B() { // 0x60: LD H, B
        // Load the value of register B into register H.
        this.registers.H = this.registers.B;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_H_A() { // 0x67: LD H, A
        // Loads the value from register A into H.
        this.registers.H = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_H_HL() { // 0x66: LD H, (HL)
        // Load value from memory at (HL) into H.
        this.registers.H = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
    }

    opcodeLD_H_D() { // 0x62: LD H, D
        this.registers.H = this.registers.D;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_L_E() { // 0x6B: LD L, E
        this.registers.L = this.registers.E;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_D_A() { // 0x57: LD D, A
        // Load the value of register A into register D.
        this.registers.D = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_L_A() { // 0x6F: LD L, A
        // Load the value of register A into register L.
        this.registers.L = this.registers.A;
        this.registers.PC++;
        return 4;
    }

    opcodeLD_L_HL() { // 0x6E: LD L, (HL)
        // // Load the value from memory at address HL into register L
        this.registers.L = this.memory[this.registers.HL];

        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_B() { // 0x70: LD (HL), B
        this.writeMemory(this.registers.HL, this.registers.B);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_C() { // 0x71: LD (HL), C
        this.writeMemory(this.registers.HL, this.registers.C);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_D() { // 0x72: LD (HL), D
        this.writeMemory(this.registers.HL, this.registers.D);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_L() { // 0x75: LD (HL), L
        // Store L into memory at address HL.
        this.writeMemory(this.registers.HL, this.registers.L);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_E() { // 0x73: LD (HL), E
        // Store the value of register E into memory at HL
        this.writeMemory(this.registers.HL, this.registers.E);
        this.registers.PC++;
        return 8;
    }
            
    opcodeHALT() { // 0x76: HALT - Freeze the CPU until reset
        // console.log("HALT instruction executed");
        console.log(`HALT at PC=0x${this.registers.PC.toString(16)}, IME=${this.interruptsEnabled}, IF=0x${this.IF.toString(16)}, IE=0x${this.IE.toString(16)}, A=0x${this.registers.A.toString(16)}`);

        const pendingInterrupts = (this.IF & this.IE & 0x1F) !== 0;

        if (!this.interruptsEnabled && pendingInterrupts) {
            // HALT bug occurs when interrupts are disabled but there's a pending interrupt
            console.log("HALT bug triggered: Will re-execute next instruction");
            this.haltBug = true;
        }
        else {
            console.log("Entering HALT state");
            this.haltEnabled = true;
        }

        this.registers.PC = (this.registers.PC + 1) & 0xFFFF;
        return 4;
    }

    opcodeLD_HL_A() { // 0x77: LD (HL), A
        // Store the value of register A into the memory address pointed to by HL.
        this.writeMemory(this.registers.HL, this.registers.A);
        this.registers.PC++;
        return 8;
    }

    opcodeLD_A_D() { // 0x7A: LD A, D
        // Load the value of register D into register A.
        this.registers.A = this.registers.D;
        this.registers.PC++;
        return 4;
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

    opcodeLD_A_HL() { // 0x7E: LD A, (HL)
        // Loads a byte from the memory address in HL into A.
        this.registers.A = this.memory[this.registers.HL];
        this.registers.PC++;
        return 8;
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

    opcodeADD_A_H() { // 0x84: ADD A, H
        this.add(this.registers.H);
        this.registers.PC++;
        return 4;
    }

    opcodeADD_A_L() { // 0x85: ADD A, L
        this.add(this.registers.L);
        this.registers.PC++;
        return 4;
    }

    opcodeADD_A_HL_mem() { // 0x86: ADD A, (HL)
        // Adds the byte from the memory address in HL to A.
        const value = this.memory[this.registers.HL];
        this.add(value);
        this.registers.PC++;
        return 8;
    }

    opcodeADD_A_A() { // 0x87: ADD A, A
        // Adds A to itself.
        this.add(this.registers.A);
        this.registers.PC++;
        return 4;
    }

    opcodeADC_A_B() { // 0x88: ADC A, B
        this.adc(this.registers.B);
        this.registers.PC++;
        return 4;
    }

    opcodeADC_A_H() { // 0x8C: ADC A, H
        // Adds H and the Carry flag to A.
        this.adc(this.registers.H);
        this.registers.PC++;
        return 4;
    }

    opcodeADC_A_C() { // 0x89: ADC A, C
        this.adc(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeSUB_C() { // 0x91: SUB C
        this.sub(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeSUB_A_H() { // 0x94: SUB A, H
        // Subtract the value in H from A.
        this.sub(this.registers.H);
        this.registers.PC++;
        return 4;
    }

    opcodeSBC_A_D() { // 0x9A: SBC A, D
        // Subtract D and the Carry flag from A.
        this.sbc(this.registers.D);
        this.registers.PC++;
        return 4;
    }

    opcodeAND_C() { // 0xA1: AND C
        this.and(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeAND_A() { // 0xA7: AND A
        this.and(this.registers.A);
        this.registers.PC++;
        return 4;
    }

    opcodeOR_B() { // 0xB0: OR B
        // Performs a bitwise OR between register A and register B.
        this.or(this.registers.B);
        this.registers.PC++;
        return 4;
    }

    opcodeOR_H() { // 0xB4: OR H
        // Bitwise OR A with H.
        this.or(this.registers.H);
        this.registers.PC++;
        return 4;
    }

    opcodeOR_C() { // 0xB1: OR C
        this.or(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeOR_HL_mem() { // 0xB6: OR (HL)
        // Performs a bitwise OR between A and the byte at the memory address in HL.
        const value = this.memory[this.registers.HL];
        this.or(value);
        this.registers.PC++;
        return 8;
    }

    opcodeOR_A() { // 0xB7: OR A
        // Bitwise OR A with itself.
        this.or(this.registers.A);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_B() { // 0xB8: CP B
        // Compare A with B.
        this.cp(this.registers.B);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_C() { // 0xB9: CP C
        // Compare A with C.
        this.cp(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_D() { // 0xBA: CP D
        // Compare A with D.
        this.cp(this.registers.D);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_E() { // 0xBB: CP E
        // Compare A with E.
        this.cp(this.registers.E);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_H() { // 0xBC: CP H
        // Compare A with H.
        this.cp(this.registers.H);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_L() { // 0xBD: CP L
        this.cp(this.registers.L);
        this.registers.PC++;
        return 4;
    }

    opcodeCP_HL() { // 0xBE: CP (HL)
        // Compare A with the byte at the memory address in HL.
        const value = this.memory[this.registers.HL];
        this.cp(value);
        this.registers.PC++;
        return 8;
    }

    opcodeCP_A() { // 0xBF: CP A
        // Compare A with itself.
        this.cp(this.registers.A);
        this.registers.PC++;
        return 4;
    }

    opcodeXOR_C() { // 0xA9: XOR C
        this.xor(this.registers.C);
        this.registers.PC++;
        return 4;
    }

    opcodeXOR_L() { // 0xAD: XOR L
        this.xor(this.registers.L);
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
            
    opcodeRET_NZ() { // 0xC0: RET NZ
        // Return if Zero flag is not set.
        if ((this.registers.F & 0x80) === 0) {
            this.registers.PC = this.pop();
            return 20; // Cycles for return taken
        }
        else {
            this.registers.PC++;
            return 8; // Cycles for return not taken
        }
    }

    opcodeJP_nn() { // 0xC3: JP nn - Jump to address nn (16-bit immediate)
        const lowByte = this.memory[this.registers.PC + 1];  // Fetch lower byte (byte at PC+1)
        const highByte = this.memory[this.registers.PC + 2]; // Fetch higher byte (byte at PC+2)
        
        // Combine the two bytes into a 16-bit address (little-endian format)
        const address = (highByte << 8) | lowByte;
        
        this.registers.PC = address; // Set PC to the new address
        return 16;
    }

    opcodeJP_NZ_nn() { // 0xC2: JP NZ, nn
        // Jump to address nn if Zero flag is not set.
        if ((this.registers.F & 0x80) === 0) {
            const lowByte = this.memory[this.registers.PC + 1];
            const highByte = this.memory[this.registers.PC + 2];
            this.registers.PC = (highByte << 8) | lowByte;
            return 16; // Cycles for jump taken
        }
        else {
            this.registers.PC += 3;
            return 12; // Cycles for jump not taken
        }
    }

    opcodeADD_A_n() { // 0xC6: ADD A, n
        const n = this.memory[this.registers.PC + 1];
        this.add(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodeRET_Z() { // 0xC8: RET Z
        // Returns from a subroutine if the Zero flag is set.
        if ((this.registers.F & 0x80) !== 0) {
            this.registers.PC = this.pop();
            return 20; // Cycles for return taken
        }
        else {
            this.registers.PC++;
            return 8; // Cycles for return not taken
        }
    }

    opcodeJP_Z_nn() { // 0xCA: JP Z, nn
        // Jumps to a 16-bit address if the Zero flag is set.
        if ((this.registers.F & 0x80) !== 0) {
            const lowByte = this.memory[this.registers.PC + 1];
            const highByte = this.memory[this.registers.PC + 2];
            this.registers.PC = (highByte << 8) | lowByte;
            return 16; // Cycles for jump taken
        }
        else {
            this.registers.PC += 3;
            return 12; // Cycles for jump not taken
        }
    }

    opcodePOP_BC() { // 0xC1: POP BC
        // Pop 16-bit value from stack into BC.
        this.registers.BC = this.pop();
        this.registers.PC++;
        return 12;
    }

    opcodeADC_A_n() { // 0xCE: ADC A, n
        // Adds an immediate 8-bit value and the Carry flag to register A.
        const n = this.memory[this.registers.PC + 1];
        this.adc(n);
        this.registers.PC += 2;
        return 8;
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
            case 0: // Rotates and Shifts
                {
                    const rotType = (cbOpcode >> 3) & 7;
                    let newCarry = 0;

                    if (rotType === 6) { // SWAP r
                        result = ((value & 0x0F) << 4) | ((value & 0xF0) >> 4);
                        // Flags: Z 0 0 0
                        this.registers.F = (result === 0) ? 0x80 : 0;
                    }
                    else {
                        switch (rotType) {
                            case 0: // RLC r - Rotate Left
                                newCarry = (value >> 7) & 1;
                                result = ((value << 1) | newCarry) & 0xFF;
                                break;
                            case 1: // RRC r - Rotate Right
                                newCarry = value & 1;
                                result = ((value >> 1) | (newCarry << 7)) & 0xFF;
                                break;
                            case 2: // RL r - Rotate Left through Carry
                                newCarry = (value >> 7) & 1;
                                result = ((value << 1) | ((this.registers.F >> 4) & 1)) & 0xFF;
                                break;
                            case 3: // RR r - Rotate Right through Carry
                                newCarry = value & 1;
                                result = ((value >> 1) | (((this.registers.F >> 4) & 1) << 7)) & 0xFF;
                                break;
                            case 4: // SLA r - Shift Left Arithmetic
                                newCarry = (value >> 7) & 1;
                                result = (value << 1) & 0xFF;
                                break;
                            case 5: // SRA r - Shift Right Arithmetic
                                newCarry = value & 1;
                                result = ((value >> 1) | (value & 0x80)) & 0xFF;
                                break;
                            case 7: // SRL r - Shift Right Logical
                                newCarry = value & 1;
                                result = (value >> 1) & 0xFF;
                                break;
                        }
                        // Flags: Z 0 0 C for all non-SWAP rotates/shifts
                        this.registers.F = newCarry ? 0x10 : 0;
                        if (result === 0)
                            this.registers.F |= 0x80;
                    }
                    this._cb_set_r(regCode, result);
                }
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
            this.writeMemory(this.registers.SP, returnAddress & 0xFF);
            this.writeMemory(this.registers.SP + 1, (returnAddress >> 8) & 0xFF);

            this.registers.PC = address;
            return 24; // Call taken
        }
        else {
            // Condition not met, just advance PC
            this.registers.PC += 3;
            return 12; // Call not taken
        }
    }

    opcodeRET() { // 0xC9: RET - Return from subroutine
        // Pop the 16-bit return address from the stack and jump to it.
        this.registers.PC = this.pop();
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
            this.writeMemory(this.registers.SP, returnAddress & 0xFF);            // Store lower byte of PC
            this.writeMemory(this.registers.SP + 1, (returnAddress >> 8) & 0xFF); // Store higher byte of PC

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
        this.writeMemory(this.registers.SP, returnAddress & 0xFF);            // Low byte
        this.writeMemory(this.registers.SP + 1, (returnAddress >> 8) & 0xFF); // High byte

        this.registers.PC = address;
        return 24;
    }

    opcodeRET_NC() { // 0xD0: RET NC
        // Return if Carry flag is not set.
        if ((this.registers.F & 0x10) === 0) {
            this.registers.PC = this.pop();
            return 20; // Cycles for return taken
        }
        else {
            this.registers.PC++;
            return 8; // Cycles for return not taken
        }
    }

    opcodePOP_DE() { // 0xD1: POP DE
        // Pop 16-bit value from stack into DE.
        this.registers.DE = this.pop();
        this.registers.PC++;
        return 12;
    }

    opcodeRET_C() { // 0xD8: RET C
        // Return if Carry flag is set.
        if ((this.registers.F & 0x10) !== 0) {
            this.registers.PC = this.pop();
            return 20; // Cycles for return taken
        }
        else {
            this.registers.PC++;
            return 8; // Cycles for return not taken
        }
    }

    opcodeSUB_n() { // 0xD6: SUB n - Subtract immediate value n from A
        const n = this.memory[this.registers.PC + 1]; // Fetch the immediate value n (byte at PC + 1)
        this.sub(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodeRETI() { // 0xD9: RETI - Return and enable interrupts
        // Pop the 16-bit return address from the stack
        const returnAddress = this.pop();
    
        // Update the program counter
        this.registers.PC = returnAddress;
    
        // Enable interrupts
        this.enableInterrupts();
    
        console.log("RETI executed, returning to 0x" + returnAddress.toString(16));
        return 16;
    }

    opcodeSBC_A_n() { // 0xDE: SBC A, n
        // Subtract immediate 8-bit value n and Carry from A.
        const n = this.memory[this.registers.PC + 1];
        this.sbc(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodeCALL_NC_nn() { // 0xD4: CALL NC, nn
        // If C flag is not set, call address nn
        if ((this.registers.F & 0x10) === 0) {
            const lowByte = this.memory[this.registers.PC + 1];
            const highByte = this.memory[this.registers.PC + 2];
            const address = (highByte << 8) | lowByte;

            const returnAddress = this.registers.PC + 3;
            this.registers.SP -= 2;
            this.writeMemory(this.registers.SP, returnAddress & 0xFF);
            this.writeMemory(this.registers.SP + 1, (returnAddress >> 8) & 0xFF);

            this.registers.PC = address;
            return 24; // Call taken
        }
        else {
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
            this.writeMemory(this.registers.SP, returnAddress & 0xFF);            // Store lower byte of PC
            this.writeMemory(this.registers.SP + 1, (returnAddress >> 8) & 0xFF); // Store higher byte of PC
    
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
        this.writeMemory(address, this.registers.A);  // Store the value in A at the address
        
        this.registers.PC += 2; // Advance the program counter
        return 12;
    }

    opcodeLD_C_mem_A() { // 0xE2: LD (C), A
        // Store A into memory at address 0xFF00 + C.
        this.writeMemory(0xFF00 + this.registers.C, this.registers.A);
        this.registers.PC++;
        return 8;
    }

    opcodePOP_HL() { // 0xE1: POP HL
        // Pop 16-bit value from stack into HL.
        this.registers.HL = this.pop();
        this.registers.PC++;
        return 12;
    }

    opcodeADD_SP_n() { // 0xE8: ADD SP, n
        // Add signed immediate 8-bit value n to SP.
        const n_unsigned = this.memory[this.registers.PC + 1];
        const n_signed = signedValue(n_unsigned);
        const sp = this.registers.SP;

        const result = sp + n_signed;

        // Flags: Z=0, N=0
        this.registers.F = 0;

        // Half Carry: Check carry from bit 3 of (SP_low + n)
        if (((sp & 0xF) + (n_unsigned & 0xF)) > 0xF) {
            this.registers.F |= 0x20; // Set H
        }
        // Carry: Check carry from bit 7 of (SP_low + n)
        if (((sp & 0xFF) + (n_unsigned & 0xFF)) > 0xFF) {
            this.registers.F |= 0x10; // Set C
        }

        this.registers.SP = result & 0xFFFF;
        this.registers.PC += 2;
        return 16;
    }

    opcodeJP_HL() { // 0xE9: JP (HL)
        // Jump to the address contained in HL.
        this.registers.PC = this.registers.HL;
        return 4;
    }

    opcodeXOR_n() { // 0xEE: XOR n
        const n = this.memory[this.registers.PC + 1];
        this.xor(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodeAND_n() { // 0xE6: AND n
        const immediateValue = this.memory[this.registers.PC + 1]; // Fetch the immediate 8-bit value
        this.and(immediateValue);
        this.registers.PC += 2; // Advance PC by 2 (1 for opcode + 1 for immediate value)
        return 8;
    }

    opcodeLD_nn_A() { // 0xEA: LD (nn), A
        // Store the value of register A into the memory address specified by nn.
        const lowByte = this.memory[this.registers.PC + 1];
        const highByte = this.memory[this.registers.PC + 2];
        const address = (highByte << 8) | lowByte;

        this.writeMemory(address, this.registers.A);
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
        this.disableInterrupts();
        this.imeScheduled = false; // DI also cancels a pending EI
        this.registers.PC++;
        return 4;
    }

    opcodeEI() { // 0xFB: EI
        // schedule IME to be enabled after next instruction
        // IME must be enabled after the following instruction executes
        this.imeScheduled = true;
        this.registers.PC = (this.registers.PC + 1) & 0xFFFF;
        return 4;
    }

    opcodeOR_n() { // 0xF6: OR n
        const n = this.memory[this.registers.PC + 1];
        this.or(n);
        this.registers.PC += 2;
        return 8;
    }

    opcodeLD_SP_HL() { // 0xF9: LD SP, HL
        // Load the value of HL into SP.
        this.registers.SP = this.registers.HL;
        this.registers.PC++;
        return 8;
    }

    opcodeLD_HL_SP_plus_n() { // 0xF8: LD HL, SP+n
        // Adds a signed immediate 8-bit value n to SP and stores the result in HL.
        const n_unsigned = this.memory[this.registers.PC + 1];
        const n_signed = signedValue(n_unsigned);
        const sp = this.registers.SP;

        const result = sp + n_signed;

        // Flags: Z=0, N=0
        this.registers.F = 0;

        // Half Carry: Check carry from bit 3 of (SP_low + n)
        if (((sp & 0xF) + (n_unsigned & 0xF)) > 0xF) {
            this.registers.F |= 0x20; // Set H
        }

        // Carry: Check carry from bit 7 of (SP_low + n)
        if (((sp & 0xFF) + (n_unsigned & 0xFF)) > 0xFF) {
            this.registers.F |= 0x10; // Set C
        }

        this.registers.HL = result & 0xFFFF;
        this.registers.PC += 2;
        return 12;
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

    opcodeRST_28H() { // 0xEF: RST 28H
        // Restart instruction, call to 0x0028.
        const returnAddress = this.registers.PC + 1;
        this.push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

        // Jump to address 0x0028
        this.registers.PC = 0x0028;
        return 16;
    }

    opcodeCPAImmediate() { // 0xFE: CP A, n
        // Compare the value in A with the immediate value n.
        // This is a subtraction (A - n) without storing the result.
        const n = this.memory[this.registers.PC + 1];
        this.cp(n);
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

    opcodeILLEGAL() { // Handler for illegal opcodes
        const opcode = this.memory[this.registers.PC];
        console.warn(`Executed illegal opcode: 0x${opcode.toString(16)} at 0x${(this.registers.PC).toString(16)}`);
        this.registers.PC++;
        return 4; // Return default cycles
    }

// #endregion (opcode functions)
}