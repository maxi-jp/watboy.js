class GameBoyCPU {

    get IF() { return this.memory[0xFF0F]; } // Interrupt flag
    get IE() { return this.memory[0XFFFF]; } // Interrupt Enable Register

    set IF(v) { this.memory[0xFF0F] = v; }
    set IE(v) { this.memory[0XFFFF] = v; }

    constructor(timer) {
        this.testPassed = false;
        this.timer = timer;
        this.steps = 0;

        this.strictMode = false; // if true: only wake from STOP on Joypad interrupt

        this.gpu = null;
        this.apu = null;

        // Private storage for 8-bit registers
        const _r = {
            A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, H: 0, L: 0, 
            SP: 0, PC: 0,
        };

        this.registers = {
            // 8-bit registers
            get A() { return _r.A; }, set A(v) { _r.A = v & 0xFF; },
            get B() { return _r.B; }, set B(v) { _r.B = v & 0xFF; },
            get C() { return _r.C; }, set C(v) { _r.C = v & 0xFF; },
            get D() { return _r.D; }, set D(v) { _r.D = v & 0xFF; },
            get E() { return _r.E; }, set E(v) { _r.E = v & 0xFF; },
            get F() { return _r.F; }, set F(v) { _r.F = v & 0xF0; }, // Lower 4 bits of F are always 0, except for POP AF
            get H() { return _r.H; }, set H(v) { _r.H = v & 0xFF; },
            get L() { return _r.L; }, set L(v) { _r.L = v & 0xFF; },

            // 16-bit register pairs
            get BC() { return (_r.B << 8) | _r.C; }, set BC(v) { _r.B = (v >> 8) & 0xFF; _r.C = v & 0xFF; },
            get DE() { return (_r.D << 8) | _r.E; }, set DE(v) { _r.D = (v >> 8) & 0xFF; _r.E = v & 0xFF; },
            get HL() { return (_r.H << 8) | _r.L; }, set HL(v) { _r.H = (v >> 8) & 0xFF; _r.L = v & 0xFF; },

            get SP() { return _r.SP; }, set SP(v) { _r.SP = v & 0xFFFF; },
            get PC() { return _r.PC; }, set PC(v) { _r.PC = v & 0xFFFF; },

            lastPC: 0, // copy of the last PC

            // Special setter for POP AF to bypass the masking
            setF_pop(v) { _r.F = v & 0xFF; }
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
        this.romData = null;

        this.BIOSLoaded = false;
        this.BIOSExecuted = false;

        this.lastInstructionSize = 0; // Bytes size of the last intruction executed (to increase PC)
        this.PCJumped = false; // Reset jump flag for the last instruction
        this.interruptsEnabled = false; // Disable interrupt handling
        this.stopEnabled = false;
        this.haltEnabled = false;
        this.imeCounter = 0; // Counter to delay enabling interrupts (for EI, RETI)
        this.haltBug = false;
        this.haltBugScheduled = false;
        this.dmaCycles = 0;

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
            0x51: this.opcodeLD_D_C.bind(this),
            0x52: this.opcodeLD_D_D.bind(this),
            0x53: this.opcodeLD_D_E.bind(this),
            0x54: this.opcodeLD_D_H.bind(this),
            0x55: this.opcodeLD_D_L.bind(this),
            0x56: this.opcodeLD_D_HL.bind(this),
            0x57: this.opcodeLD_D_A.bind(this),
            0x58: this.opcodeLD_E_B.bind(this),
            0x59: this.opcodeLD_E_C.bind(this),
            0x5A: this.opcodeLD_E_D.bind(this),
            0x5B: this.opcodeLD_E_E.bind(this),
            0x5C: this.opcodeLD_E_H.bind(this),
            0x5D: this.opcodeLD_E_L.bind(this),
            0x5E: this.opcodeLD_E_HL.bind(this),
            0x5F: this.opcodeLD_E_A.bind(this),
            0x60: this.opcodeLD_H_B.bind(this),
            0x61: this.opcodeLD_H_C.bind(this),
            0x62: this.opcodeLD_H_D.bind(this),
            0x63: this.opcodeLD_H_E.bind(this),
            0x64: this.opcodeLD_H_H.bind(this),
            0x65: this.opcodeLD_H_L.bind(this),
            0x66: this.opcodeLD_H_HL.bind(this),
            0x67: this.opcodeLD_H_A.bind(this),
            0x68: this.opcodeLD_L_B.bind(this),
            0x69: this.opcodeLD_L_C.bind(this),
            0x6A: this.opcodeLD_L_D.bind(this),
            0x6B: this.opcodeLD_L_E.bind(this),
            0x6C: this.opcodeLD_L_H.bind(this),
            0x6D: this.opcodeLD_L_L.bind(this),
            0x6E: this.opcodeLD_L_HL.bind(this),
            0x6F: this.opcodeLD_L_A.bind(this),
            0x70: this.opcodeLD_HL_B.bind(this),
            0x71: this.opcodeLD_HL_C.bind(this),
            0x72: this.opcodeLD_HL_D.bind(this),
            0x73: this.opcodeLD_HL_E.bind(this),
            0x74: this.opcodeLD_HL_H.bind(this),
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
            0x82: this.opcodeADD_A_D.bind(this),
            0x83: this.opcodeADD_A_E.bind(this),
            0x84: this.opcodeADD_A_H.bind(this),
            0x85: this.opcodeADD_A_L.bind(this),
            0x86: this.opcodeADD_A_HL_mem.bind(this),
            0x87: this.opcodeADD_A_A.bind(this),
            0x88: this.opcodeADC_A_B.bind(this),
            0x89: this.opcodeADC_A_C.bind(this),
            0x8A: this.opcodeADC_A_D.bind(this),
            0x8B: this.opcodeADC_A_E.bind(this),
            0x8C: this.opcodeADC_A_H.bind(this),
            0x8D: this.opcodeADC_A_L.bind(this),
            0x8E: this.opcodeADC_A_HL_mem.bind(this),
            0x8F: this.opcodeADC_A_A.bind(this),
            0x90: this.opcodeSUB_B.bind(this),
            0x91: this.opcodeSUB_C.bind(this),
            0x92: this.opcodeSUB_D.bind(this),
            0x93: this.opcodeSUB_E.bind(this),
            0x94: this.opcodeSUB_A_H.bind(this),
            0x95: this.opcodeSUB_L.bind(this),
            0x96: this.opcodeSUB_HL_mem.bind(this),
            0x97: this.opcodeSUB_A.bind(this),
            0x98: this.opcodeSBC_A_B.bind(this),
            0x99: this.opcodeSBC_A_C.bind(this),
            0x9A: this.opcodeSBC_A_D.bind(this),
            0x9B: this.opcodeSBC_A_E.bind(this),
            0x9C: this.opcodeSBC_A_H.bind(this),
            0x9D: this.opcodeSBC_A_L.bind(this),
            0x9E: this.opcodeSBC_A_HL_mem.bind(this),
            0x9F: this.opcodeSBC_A_A.bind(this),
            0xA0: this.opcodeAND_B.bind(this),
            0xA1: this.opcodeAND_C.bind(this),
            0xA2: this.opcodeAND_D.bind(this),
            0xA3: this.opcodeAND_E.bind(this),
            0xA4: this.opcodeAND_H.bind(this),
            0xA5: this.opcodeAND_L.bind(this),
            0xA6: this.opcodeAND_HL_mem.bind(this),
            0xA7: this.opcodeAND_A.bind(this),
            0xA8: this.opcodeXOR_B.bind(this),
            0xA9: this.opcodeXOR_C.bind(this),
            0xAA: this.opcodeXOR_D.bind(this),
            0xAB: this.opcodeXOR_E.bind(this),
            0xAC: this.opcodeXOR_H.bind(this),
            0xAD: this.opcodeXOR_L.bind(this),
            0xAE: this.opcodeXOR_HL.bind(this),
            0xAF: this.opcodeXOR_A_A.bind(this),
            0xB0: this.opcodeOR_B.bind(this),
            0xB1: this.opcodeOR_C.bind(this),
            0xB2: this.opcodeOR_D.bind(this),
            0xB3: this.opcodeOR_E.bind(this),
            0xB4: this.opcodeOR_H.bind(this),
            0xB5: this.opcodeOR_L.bind(this),
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
            0xC7: this.opcodeRST_00H.bind(this),
            0xC9: this.opcodeRET.bind(this),
            0xC8: this.opcodeRET_Z.bind(this),
            0xCA: this.opcodeJP_Z_nn.bind(this),
            0xCB: this.opcodeCB.bind(this),
            0xCC: this.opcodeCALL_Z_nn.bind(this),
            0xCD: this.opcodeCALL_nn.bind(this),
            0xCE: this.opcodeADC_A_n.bind(this),
            0xCF: this.opcodeRST_08H.bind(this),
            0xD0: this.opcodeRET_NC.bind(this),
            0xD1: this.opcodePOP_DE.bind(this),
            0xD2: this.opcodeJP_NC_nn.bind(this),
            0xD3: this.opcodeILLEGAL.bind(this),
            0xD5: this.opcodePUSH_DE.bind(this),
            0xD4: this.opcodeCALL_NC_nn.bind(this),
            0xD6: this.opcodeSUB_n.bind(this),
            0xD7: this.opcodeRST_10H.bind(this),
            0xD8: this.opcodeRET_C.bind(this),
            0xD9: this.opcodeRETI.bind(this),
            0xDA: this.opcodeJP_C_nn.bind(this),
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
            0xE7: this.opcodeRST_20H.bind(this),
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
            0xF2: this.opcodeLD_A_C_mem.bind(this),
            0xF3: this.opcodeDI.bind(this),
            0xF4: this.opcodeILLEGAL.bind(this),
            0xF5: this.opcodePUSH_AF.bind(this),
            0xF6: this.opcodeOR_n.bind(this),
            0xF7: this.opcodeRST_30H.bind(this),
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

    SetGPU(gpu) {
        this.gpu = gpu;
    }

    SetAPU(apu) {
        this.apu = apu;
    }

    Reset() {
        // Initialize registers to their power-on state
        this.registers.A  = 0x01; // Accumulator
        this.registers.F  = 0xB0; // Flags
        this.registers.BC = 0x0013;
        this.registers.DE = 0x00D8;
        this.registers.HL = 0x014D;
        this.registers.SP = 0xFFFE; // Stack Pointer
        this.registers.PC = 0x0; // Program Counter
        this.registers.lastPC = 0x0;

        this.memory.fill(0);

        // Load BIOS (optional)
        // TODO
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
        this.memory[0xFF41] = 0x85; // STAT
        this.memory[0xFF42] = 0x00; // SCY
        this.memory[0xFF43] = 0x00; // SCX
        this.memory[0xFF45] = 0x00; // LYC
        this.memory[0xFF47] = 0xFC; // BGP
        this.memory[0xFF48] = 0xFF; // OBP0
        this.memory[0xFF49] = 0xFF; // OBP1
        this.memory[0xFF4A] = 0x00; // WY
        this.memory[0xFF4B] = 0x00; // WX
        this.memory[0xFFFF] = 0x00; // IE

        // --- CPU State ---
        this.interruptsEnabled = false;
        this.stopEnabled = false;
        this.haltEnabled = false;
        this.imeCounter = 0;
        this.PCJumped = false;
        this.lastInstructionSize = 0;
    }

    WriteMemory(address, value) {
        // ROM area (0x0000-0x7FFF). Writes to this area are either ignored
        // OR used for MBC bank switching
        if (address < 0x8000) {
            if (this.MBC) {
                this.MBC.HandleWrite(address, value);
            }
            return;
        }

        // External RAM (0xA000-0xBFFF)
        if (address >= 0xA000 && address < 0xC000) {
            if (this.MBC) {
                this.MBC.WriteRam(address, value);
            }
            return;
        }

        // Writing to the DIV register (0xFF04) resets its internal counter to 0 (the value written is ignored)
        if (address === 0xFF04) {
            this.timer.ResetDiv();
            this.stopEnabled = false;
            return;
        }

        // Writing to DMA register (0xFF46) triggers a DMA transfer
        if (address === 0xFF46) {
            this.DoDMATransfer(value);
            return;
        }

        // Sound registers (0xFF10 - 0xFF26) and Wave Pattern RAM (0xFF30 - 0xFF3F)
        if ((address >= 0xFF10 && address <= 0xFF26) || (address >= 0xFF30 && address <= 0xFF3F)) {
            this.apu.WriteRegister(address, value);
            // We still write to memory so other parts of the system can read it
        }

        // Trap writes to LCDC register AND delegate to GPU
        if (address === 0xFF40) {
            this.gpu.HandleLcdcWrite(value);
        }

        // Handle writes to P1 (Joypad) register (0xFF00)
        if (address === 0xFF00) {
            // Only bits 4 AND 5 (button selection) are writable by the game.
            this.memory[address] = (this.memory[address] & 0xCF) | (value & 0x30);
            return;
        }

        // memory write operation
        this.memory[address] = value;

         // Mirror Work RAM <-> Echo RAM
        if (address >= 0xC000 && address <= 0xDDFF) {
            // Write to Echo RAM
            this.memory[address + 0x2000] = value;
        }
        else if (address >= 0xE000 && address < 0xFE00) {
            // Write to Work RAM
            this.memory[address - 0x2000] = value;
        }

        // check for serial output
        if (address === 0xFF02 && value === 0x81) {
            // Print the character in 0xFF01
            const char = String.fromCharCode(this.memory[0xFF01]);
            this.serialBuffer += char;
            if (char === '\n' || char === '\r' || this.serialBuffer.endsWith("ok")) {
                console.log("SERIAL:", this.serialBuffer.trim());
                if (this.serialBuffer.trim().endsWith("Passed all tests")) {
                    this.testPassed = true;
                }
                this.serialBuffer = "";
            }

            // The transfer is instant. We need to simulate completion.
            // Clear bit 7 of SC (0xFF02) to signal transfer is complete (this stops
            // the busy-wait loop in Blargg's test ROMs.
            this.memory[0xFF02] = 0x01; // Keep internal clock, but clear busy flag.

            // Request a serial interrupt to wake the CPU if it enters STOP mode after the transfer.
            this.RequestInterrupt(this.INT.SERIAL);
        }
    }

    ReadMemory(address) {
        // ROM area read (delegated to MBC)
        if (address < 0x8000) {
            return this.MBC.ReadRom(address);
        }

        // External RAM read
        if (address >= 0xA000 && address < 0xC000) {
            return this.MBC.ReadRam(address);
        }

        // Reading from Echo RAM
        if (address >= 0xE000 && address <= 0xFDFF) {
            return this.memory[address - 0x2000];
        }

        return this.memory[address];
    }

    LoadBIOS(biosData) {
        // Copy BIOS data into memory (0x0000 - 0x00FF)
        this.memory.set(biosData, 0x0000);

        this.BIOSLoaded = true;
        console.log('BIOS loaded successfully.');
    }

    UnmapBIOS() {
        if (this.BIOSLoaded) {
            for (let i = 0; i < 0x100; i++) {
                this.memory[i] = this.memory[0x0100 + i];
            }
            this.BIOSLoaded = false;
            console.log('BIOS unmapped. Memory mapped to cartridge ROM.');
        }
    }

    LoadROM(romData) {
        console.log(`ROM size: ${romData.length} bytes (0x${romData.length.toString(16)})`);

        if (romData.length < 0x0100) {
            console.error("Invalid ROM size (too small).");
            return;
        }

        if (romData.length > 0x10000) {
            console.warn("ROM is too large for standard Game Boy memory.");
            return;
        }
        
        this.Reset();

        const mbcType = romData[0x0147];
        console.log("Cartridge ROM type: 0x" + mbcType.toString(16));

        if (mbcType >= 1 && mbcType <= 3) {
            this.MBC = new MBC1(this, romData);
        }
        else if (mbcType === 0) {
            if (romData.length > 0x8000) {
                console.warn("Large ROM_ONLY cart detected. Treating as SimpleBanker.");
                this.MBC = new MBC1(this, romData);
            }
            else {
                this.MBC = new ROM_ONLY(this, romData);
            }
        }
        else {
            // ROM_ONLY, load second 16KB bank if it exists
            // Load the first 32KB directly into memory.
            console.warn("Unsupported MBC type: 0x" + mbcType.toString(16));
            this.MBC = new ROM_ONLY(this, romData);
        }
    }

    Start() {
        if (this.BIOSLoaded) {
            this.registers.PC = 0x0000;
        }
        else {
            this.registers.PC = 0x0100;
        }
    }

    RunStep() {
        const pcBefore = this.registers.PC;
        this.registers.lastPC = pcBefore;
        
        const opcode = this.ReadMemory(pcBefore);
        const handler = this.opcodeHandlers[opcode];

        let elapsedClockTicks = 0;
        this.PCJumped = false;
        this.lastInstructionSize = 1;

        if (handler) {
            elapsedClockTicks = handler() || 4;
        }
        else {
            console.warn(`Unimplemented opcode: 0x${opcode.toString(16)}...`);
            elapsedClockTicks = 4;
        }

        // PC increment logic (including HALT bug handling)
        if (this.haltBug) {
            this.haltBug = false; // Don't increment PC
        }
        else if (!this.PCJumped && this.registers.PC === pcBefore) {
            // Only increment PC if it wasn't a jump/call/ret
            this.registers.PC += this.lastInstructionSize;
        }
        
        return elapsedClockTicks;
    }

    GetGameNameFromMemory() {
        return String.fromCharCode(...this.memory.slice(cartridgeNameAdress[0], cartridgeNameAdress[1]));
    }

    HandleInterrupts() {
        const IF = this.IF; // Interrupt Flag register
        const IE = this.IE; // Interrupt Enable register

        const fired = IF & IE & 0x1F; // Only check the 5 interrupt bits

        if (fired === 0) {
            return 0; // No pending AND enabled interrupts
        }

        // Standard interrupt sequence (5 M-cycles):
        // M1: Opcode fetch (discarded)
        // M2: Push PCh
        // M3: Push PCl
        // M4-M5: Jump to vector
        
        // An interrupt is pending. If halted, we must wake up.
        if (this.haltEnabled) {
            this.haltEnabled = false;
            // console.log("HALT exit due to pending interrupt");
        }

        // If master interrupt switch is disabled, we don't service the interrupt.
        // The CPU just wakes up from HALT mode.
        if (!this.interruptsEnabled) {
            return 0;
        }

        // Disable master interrupt flag
        this.interruptsEnabled = false;
        
        // Push current PC to stack before handling interrupt
        const returnAddr = this.registers.PC;
        this.Push((returnAddr >> 8) & 0xFF, returnAddr & 0xFF);
        
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
        }
        // Serial Interrupt (Piority 3)
        else if (fired & this.INT.SERIAL) {
            this.IF &= ~this.INT.SERIAL; // Clear Serial interrupt flag
            handlerAddr = 0x0058;
        }
        // Joypad Interrupt (Priority 4)
        else if (fired & this.INT.JOYPAD) {
            this.IF &= ~this.INT.JOYPAD; // Clear Joypad interrupt flag
            handlerAddr = 0x0060;
        }

        this.registers.PC = handlerAddr;

        // Standard interrupt sequence takes 5 M-cycles (20 T-cycles)
        return 20;
    }

    RequestInterrupt(type) {
        this.IF |= type;
        this.haltEnabled = false;
    }

    EnableInterrupts() {
        this.interruptsEnabled = true;
    }

    DisableInterrupts() {
        this.interruptsEnabled = false;
    }

    SignedValue(n) {
        // Helper function to interpret an 8-bit value as signed
        return n < 0x80 ? n : n - 0x100;
    }

    DoDMATransfer(value) {
        this.memory[0xFF46] = value;
        const sourceAddress = value << 8;
        // The transfer copies 160 bytes from source to OAM (0xFE00 - 0xFE9F)
        for (let i = 0; i < 0xA0; i++) {
            this.memory[0xFE00 + i] = this.ReadMemory(sourceAddress + i);
        }
        // The DMA transfer stalls the CPU for 160 machine cycles (640 T-cycles)
        this.dmaCycles = 640;
    }

    PrintRegisters() {
        const r = this.registers;
        const op = this.ReadMemory(r.lastPC);
        console.log(
            `step:${this.steps} ` +
            `PC:${r.PC.toString(16).padStart(4, '0')} ` +
            `Op:${op.toString(16).padStart(2, '0')} ` +
            `AF:${((r.A << 8) | r.F).toString(16).padStart(4, '0')} ` +
            `BC:${r.BC.toString(16).padStart(4, '0')} ` +
            `DE:${r.DE.toString(16).padStart(4, '0')} ` +
            `HL:${r.HL.toString(16).padStart(4, '0')} ` +
            `SP:${r.SP.toString(16).padStart(4, '0')} ` +
            `mem(65348):${this.ReadMemory(65348).toString(16).padStart(4, '0')}`
        );
    }

// #region opcode helper functions

    // Helper function to Add a value to the A register AND update flags
    Add(value) {
        const originalA = this.registers.A;
        const result = originalA + value;
        this.registers.A = result & 0xFF;

        let f = 0;

        if (this.registers.A === 0)
            f |= 0x80; // Z

        // N is 0

        if (((originalA & 0xF) + (value & 0xF)) > 0xF)
            f |= 0x20; // H

        if (result > 0xFF)
            f |= 0x10; // C

        this.registers.F = f;
    }

    // Helper function for 16-bit additions (ADD HL, rr)
    Add16(value) {
        const originalHL = this.registers.HL;
        const result = originalHL + value;

        let f = this.registers.F & 0x80; // Preserve Z flag, then modify N, H, AND C

        // H is set if carry from bit 11
        if ((originalHL & 0x0FFF) + (value & 0x0FFF) > 0x0FFF)
            f |= 0x20; // Set H

        // C is set if carry from bit 15
        if (result > 0xFFFF)
            f |= 0x10; // Set C

        this.registers.F = f;
        this.registers.HL = result & 0xFFFF;
    }

    // Helper function to Add with carry a value to the A register AND update flags
    Adc(value) {
        const originalA = this.registers.A;
        const carry = (this.registers.F & 0x10) ? 1 : 0;
        const result = originalA + value + carry;
        this.registers.A = result & 0xFF;

        let f = 0;

        if (this.registers.A === 0)
            f |= 0x80; // Z

        // N is 0

        if (((originalA & 0xF) + (value & 0xF) + carry) > 0xF)
            f |= 0x20; // H

        if (result > 0xFF)
            f |= 0x10; // C

        this.registers.F = f;
    }

    // Helper function to subtract a value from the A register AND update flags
    Sub(value) {
        const originalA = this.registers.A;
        const result = originalA - value;
        this.registers.A = result & 0xFF;

        let f = 0x40; // N is 1
        if (this.registers.A === 0)
            f |= 0x80; // Z
        if ((originalA & 0x0F) < (value & 0x0F))
            f |= 0x20; // H
        if (originalA < value)
            f |= 0x10; // C

        this.registers.F = f;
    }

    // Helper function to subtract with carry a value from the A register AND update flags
    Sbc(value) {
        const originalA = this.registers.A;
        const carry = (this.registers.F & 0x10) ? 1 : 0;
        const result = originalA - value - carry;
        this.registers.A = result & 0xFF;

        let f = 0x40; // N is 1
        if (this.registers.A === 0)
            f |= 0x80; // Z
        if ((originalA & 0x0F) < ((value & 0x0F) + carry))
            f |= 0x20; // H
        if (originalA < (value + carry))
            f |= 0x10; // C

        this.registers.F = f;
    }

    // Helper function to AND a value with the A register AND update flags
    AND(value) {
        this.registers.A &= value;

        let f = 0x20; // Start with H flag set, N AND C cleared

        if (this.registers.A === 0)
            f |= 0x80; // Set Z flag if result is zero

        this.registers.F = f;
    }

    // Helper function to OR a value with the A register AND update flags
    OR(value) {
        this.registers.A |= value;
        this.registers.F = (this.registers.A === 0 ? 0x80 : 0); // Z 0 0 0
    }

    // Helper function to XOR a value with the A register AND update flags
    XOR(value) {
        this.registers.A ^= value;
        this.registers.F = (this.registers.A === 0 ? 0x80 : 0); // Z 0 0 0
    }

    // Helper function to compare a value with the A register AND update flags
    CP(value) {
        const originalA = this.registers.A;
        const result = originalA - value;
        
        let f = 0x40; // N is 1
        if ((result & 0xFF) === 0)
            f |= 0x80; // Z
        if ((originalA & 0x0F) < (value & 0x0F))
            f |= 0x20; // H
        if (originalA < value)
            f |= 0x10; // C

        this.registers.F = f;
    }

    // Helper for PUSH opcodes
    Push(highByte, lowByte) {
        this.registers.SP--;
        this.WriteMemory(this.registers.SP, highByte);
        this.registers.SP--;
        this.WriteMemory(this.registers.SP, lowByte);
    }

    // Helper for POP opcodes
    Pop() {
        const lowByte = this.memory[this.registers.SP];
        this.registers.SP++; // Increment SP to point to the high byte
        const highByte = this.memory[this.registers.SP];
        this.registers.SP++; // Increment SP again
        return (highByte << 8) | lowByte;
    }

    // Helper to get register value based on 3-bit opcode
    CbGetReg(code) {
        switch (code) {
            case 0: return this.registers.B;
            case 1: return this.registers.C;
            case 2: return this.registers.D;
            case 3: return this.registers.E;
            case 4: return this.registers.H;
            case 5: return this.registers.L;
            case 6: return this.ReadMemory(this.registers.HL); // (HL)
            case 7: return this.registers.A;
        }
    }

    // Helper to set register value based on 3-bit opcode
    CbSetReg(code, value) {
        switch (code) {
            case 0: this.registers.B = value; break;
            case 1: this.registers.C = value; break;
            case 2: this.registers.D = value; break;
            case 3: this.registers.E = value; break;
            case 4: this.registers.H = value; break;
            case 5: this.registers.L = value; break;
            case 6: this.WriteMemory(this.registers.HL, value); break; // (HL)
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
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_BC_nn() { // 0x01: LD BC, nn - Load 16-bit immediate value into BC register pair
        this.registers.C = this.ReadMemory(this.registers.PC + 1);
        this.registers.B = this.ReadMemory(this.registers.PC + 2);
        this.lastInstructionSize = 3;
        return 12;
    }

    opcodeLD_BC_A() { // 0x02: LD (BC), A - Store A into memory address BC
        const bc = (this.registers.B << 8) | this.registers.C;
        this.WriteMemory(bc, this.registers.A);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_BC() { // 0x03: INC BC - Increment BC register pair
        this.registers.BC++;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_B() { // 0x04: INC B
        const originalValue = this.registers.B;
        this.registers.B = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.B === 0)
            f |= 0x80; // Z

        // N is 0

        if ((originalValue & 0xF) === 0xF)
            f |= 0x20; // H

        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_B() { // 0x05: DEC B
        const originalB = this.registers.B;
        this.registers.B = (this.registers.B - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1

        if (this.registers.B === 0)
            f |= 0x80; // Z

        if ((originalB & 0xF) === 0x0)
            f |= 0x20; // H (borrow from bit 4)

        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_n() { // 0x06: LD B, n
        // Load immediate value into B
        this.registers.B = this.ReadMemory(this.registers.PC + 1);
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRLCA() { // 0x07: RLCA
        // Rotate A left. Bit 7 goes to Carry AND to bit 0.
        const msb = (this.registers.A >> 7) & 1; // Most significant bit
        this.registers.A = ((this.registers.A << 1) | msb) & 0xFF;

        // Update flags: Z, N, H are cleared. C is set from old bit 7.
        this.registers.F = 0;
        if (msb)
            this.registers.F |= 0x10; // Set Carry flag
        
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_nn_SP() { // 0x08: { // LD (nn), SP
        // Fetch the 16-bit address from the next two bytes in memory (little-endian)
        const lowByte = this.ReadMemory(this.registers.PC + 1);
        const highByte = this.ReadMemory(this.registers.PC + 2);
        const address = (highByte << 8) | lowByte;
    
        // Store the lower AND upper bytes of SP into memory at the specified address
        this.WriteMemory(address, this.registers.SP & 0xFF);            // Low byte of SP
        this.WriteMemory(address + 1, (this.registers.SP >> 8) & 0xFF); // High byte of SP
        this.lastInstructionSize = 3;
        return 20;
    }

    opcodeADD_HL_BC() { // 0x09: ADD HL, BC
        // Adds the 16-bit value of BC to HL.
        this.Add16(this.registers.BC);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeDEC_BC() { // 0x0B: DEC BC
        // Decrement BC register pair. No flags affected.
        this.registers.BC--;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_A_BC() { // 0x0A: LD A, (BC)
        // Load the byte from the memory address specified by BC into A.
        this.registers.A = this.ReadMemory(this.registers.BC);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_C() { // 0x0C: INC C
        const originalValue = this.registers.C;
        this.registers.C = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.C === 0)
            f |= 0x80; // Z

        // N is 0

        if ((originalValue & 0xF) === 0xF)
            f |= 0x20; // H

        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_C() { // 0x0D: DEC C
        const originalC = this.registers.C;
        this.registers.C = (this.registers.C - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1

        if (this.registers.C === 0)
            f |= 0x80; // Z

        if ((originalC & 0xF) === 0x0)
            f |= 0x20; // H (borrow from bit 4)

        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_n() { // 0x0E: LD C, n
        this.registers.C = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate value
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRRCA() { // 0x0F: RRCA
        // Performs a rotate right operation on the A register.
        // The least significant bit (LSB) of A is rotated into the carry flag (C),
        // AND also becomes the most significant bit (MSB) of A.
        const lsb = this.registers.A & 0x01; // Extract the least significant bit
        this.registers.A = (this.registers.A >> 1) | (lsb << 7); // Rotate right, MSB becomes LSB

        // Update flags
        this.registers.F = 0; // Clear all flags
        if (lsb)
            this.registers.F |= 0x10; // Set carry flag if LSB was 1
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_DE_A() { // 0x12: LD (DE), A
        // Store A into memory address DE.
        this.WriteMemory(this.registers.DE, this.registers.A);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_D() { // 0x14: INC D
        const originalValue = this.registers.D;
        this.registers.D = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.D === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_D() { // 0x15: DEC D
        const originalD = this.registers.D;
        this.registers.D = (originalD - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (this.registers.D === 0) f |= 0x80; // Z
        if ((originalD & 0xF) === 0x0) f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;
        
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_n() { // 0x16: LD D, n
        // Loads an immediate 8-bit value into register D.
        this.registers.D = this.ReadMemory(this.registers.PC + 1);
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeADD_HL_DE() { // 0x19: ADD HL, DE
        // Adds the 16-bit value of DE to HL.
        this.Add16(this.registers.DE);
        this.lastInstructionSize = 1;
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
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_DE() { // 0x1B: DEC DE
        // Decrement DE register pair. No flags affected.
        this.registers.DE--;
        this.lastInstructionSize = 1;
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
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeINC_E() { // 0x1C: INC E
        const originalValue = this.registers.E;
        this.registers.E = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.E === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_n() { // 0x1E: LD E, n
        // Load immediate 8-bit value into E.
        this.registers.E = this.ReadMemory(this.registers.PC + 1);
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeLD_DE_nn() { // 0x11: LD DE, nn
        // Load 16-bit immediate value into DE.
        const lowByte = this.ReadMemory(this.registers.PC + 1);
        const highByte = this.ReadMemory(this.registers.PC + 2);
        this.registers.DE = (highByte << 8) | lowByte;
        this.lastInstructionSize = 3;
        return 12;
    }

    opcodeDEC_E() { // 0x1D: DEC E
        const originalE = this.registers.E;
        this.registers.E = (originalE - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (this.registers.E === 0)
            f |= 0x80; // Z
        if ((originalE & 0xF) === 0x0)
            f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSTOP() { // 0x10: STOP - Halt the CPU
        // console.log("STOP instruction executed");
        const pendingInterrupts = (this.IF & this.IE & 0x1F) !== 0;

        if (!this.interruptsEnabled && pendingInterrupts) {
            // STOP bug (same as HALT bug). The CPU does not stop, AND the instruction
            // after STOP is executed without PC being incremented, causing it to run twice.
            this.haltBugScheduled = true;
        }
        else {
            // this.stopEnabled = true;
            // this.justEnteredStop = true;
        }

        this.timer.ResetDiv();
        this.lastInstructionSize = 2; // STOP is a 2-byte instruction (0x10 0x00)
        return 4;
    }

    opcodeJR_n() { // 0x18: JR n
        // Unconditional relative jump by n.
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the signed offset n
        this.registers.PC += this.SignedValue(n) + 2; // Jump by the offset
        this.PCJumped = true;
        this.lastInstructionSize = 2;
        return 12;
    }

    opcodeINC_DE() { // 0x13: INC DE
        // Increment the value of DE by 1
        this.registers.DE++;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_A_DE() { // 0x1A: LD A, (DE)
        // Load the value at the memory address pointed by DE register into A.
        const address = this.registers.DE;
        this.registers.A = this.ReadMemory(address);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeDEC_HL() { // 0x2B: DEC HL
        // Decrement HL register pair. No flags affected.
        this.registers.HL--;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeJR_NZ_n() { // 0x20: JR NZ, n
        // Jump to the address PC + n if the Zero flag is not set.
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the signed offset n
        this.lastInstructionSize = 2;
        if ((this.registers.F & 0x80) === 0) { // Check if Z flag is not set
            this.registers.PC += this.SignedValue(n) + 2; // Jump by the offset AND advance PC
            this.PCJumped = true;
            return 12;
        }
        return 8;
    }

    opcodeLD_HL_nn() { // 0x21: LD HL, nn
        // Load the immediate 16-bit value nn into the HL register pair.
        const lowByte = this.ReadMemory(this.registers.PC + 1); // Fetch lower byte
        const highByte = this.ReadMemory(this.registers.PC + 2); // Fetch higher byte
        this.registers.HL = (highByte << 8) | lowByte;
        this.lastInstructionSize = 3;
        return 12;
    }

    opcodeLD_HLplus_A() { // 0x22: LD (HL+), A
        // Stores the value of A into the memory address pointed to by HL,
        // then increment the value of HL
        this.WriteMemory(this.registers.HL, this.registers.A);
        this.registers.HL++;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_HL() { // 0x23: INC HL 
        // Increment the HL register pair by 1
        this.registers.HL++;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_H() { // 0x24: INC H
        const originalValue = this.registers.H;
        this.registers.H = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.H === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_H() { // 0x25: DEC H
        const originalH = this.registers.H;
        this.registers.H = (originalH - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (this.registers.H === 0) f |= 0x80; // Z
        if ((originalH & 0xF) === 0x0) f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_n() { // 0x26: LD H, n
        // Load the immediate 8-bit value n into register H.
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate value
        this.registers.H = n;
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeINC_L() { // 0x2C: INC L
        const originalValue = this.registers.L;
        this.registers.L = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.L === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_L() { // 0x2D: DEC L
        const originalL = this.registers.L;
        this.registers.L = (originalL - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (this.registers.L === 0) f |= 0x80; // Z
        if ((originalL & 0xF) === 0x0) f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_n() { // 0x2E: LD L, n
        // Load immediate 8-bit value into L.
        this.registers.L = this.ReadMemory(this.registers.PC + 1);
        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeCPL() { // 0x2F: CPL
        // Complement A (bitwise NOT).
        this.registers.A = ~this.registers.A;
        // Set N AND H flags.
        this.registers.F |= 0x60; // Set N AND H flags
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_HL_HL() { // 0x29: ADD HL, HL
        this.Add16(this.registers.HL);
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeDAA() { // 0x27: DAA (Decimal Adjust Accumulator)
        let a = this.registers.A;
        const nFlag = (this.registers.F & 0x40) !== 0;
        const hFlag = (this.registers.F & 0x20) !== 0;
        let cFlag = (this.registers.F & 0x10) !== 0;

        if (!nFlag) { // After an addition
            if (cFlag || a > 0x99) {
                a += 0x60;
                cFlag = true;
            }
            if (hFlag || (a & 0x0F) > 0x09) {
                a += 0x06;
            }
        }
        else { // After a subtraction
            if (cFlag) {
                a -= 0x60;
            }
            if (hFlag) {
                a -= 0x06;
            }
        }

        this.registers.A = a & 0xFF;

        // Flags: Z is set if A is 0. N is preserved. H is cleared. C is set OR preserved.
        let f = nFlag ? 0x40 : 0; // Preserve N flag, clear Z, H
        if (this.registers.A === 0) f |= 0x80; // Set Z
        if (cFlag) f |= 0x10; // Set C
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeJR_Z_n() { // 0x28: JR Z, n
        // Jump to the address PC + n if the Zero flag is set.
        // console.log(`JR Z, n at PC=0x${this.registers.PC.toString(16)}, Z=${(this.registers.F & 0x80) !== 0}, branching=${(this.registers.F & 0x80) !== 0}`);
        this.lastInstructionSize = 2;
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the signed offset n
        if ((this.registers.F & 0x80) !== 0) { // Check if Z flag is set
            this.registers.PC += this.SignedValue(n) + 2; // Jump by the offset AND advance PC
            this.PCJumped = true;
            return 12;
        }
        return 8;
    }

    opcodeLD_A_HLplus() { // 0x2A: LD A, (HL+)
        // Load value from address HL into A, then increment HL.
        this.registers.A = this.ReadMemory(this.registers.HL);
        this.registers.HL++;
        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeJR_NC_n() { // 0x30: JR NC, n
        // Jump relative by n if Carry flag is not set.
        // console.log(`JR NC, c at PC=0x${this.registers.PC.toString(16)}, Z=${(this.registers.F & 0x80) !== 0}, branching=${(this.registers.F & 0x10) === 0}`);
        this.lastInstructionSize = 2;
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the signed offset n
        if ((this.registers.F & 0x10) === 0) { // Check if Carry flag is NOT set
            this.registers.PC += this.SignedValue(n) + 2; // Jump by the offset
            this.PCJumped = true;
            return 12;
        }
        return 8;
    }

    opcodeJR_C_n() { // 0x38: JR C, n
        // Jump relative by n if Carry flag is set.
        // console.log(`JR C, n at PC=0x${this.registers.PC.toString(16)}, Z=${(this.registers.F & 0x80) !== 0}, branching=${(this.registers.F & 0x10) !== 0}`);
        this.lastInstructionSize = 2;
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the signed offset n
        if ((this.registers.F & 0x10) !== 0) { // Check if Carry flag is set
            this.registers.PC += this.SignedValue(n) + 2; // Jump by the offset
            this.PCJumped = true;
            return 12;
        }
        return 8;
    }

    opcodeLD_SP_nn() { // 0x31: LD SP, nn
        // Load 16-bit immediate value into SP
        const lowByte = this.ReadMemory(this.registers.PC + 1); // Fetch low byte
        const highByte = this.ReadMemory(this.registers.PC + 2); // Fetch high byte
        
        // Combine the low AND high bytes into a 16-bit value (nn)
        this.registers.SP = (highByte << 8) | lowByte;
        
        // Increment the program counter to point to the next instruction
        this.lastInstructionSize = 3;
        return 12;
    }

    opcodeLD_HLm_A() { // 0x32: LD (HL-), A
        // stores the contents of register A into the memory location pointed to by the HL register pair,
        // then decrements the value of HL
        this.WriteMemory(this.registers.HL, this.registers.A);
        this.registers.HL--;

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_SP() { // 0x33: INC SP
        // Increment Stack Pointer. No flags affected.
        this.registers.SP = (this.registers.SP + 1) & 0xFFFF;

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_n() { // 0x36: LD (HL), n
        // Load immediate 8-bit value n into memory at address HL.
        const n = this.ReadMemory(this.registers.PC + 1);
        this.WriteMemory(this.registers.HL, n);

        this.lastInstructionSize = 2;
        return 12;
    }

    opcodeSCF() { // 0x37: SCF (Set Carry Flag)
        // Set Carry flag. Clear N AND H flags.
        this.registers.F |= 0x10;  // Set C
        this.registers.F &= ~0x60; // Clear N AND H

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_HL_SP() { // 0x39: ADD HL, SP
        // Adds the 16-bit value of SP to HL.
        this.Add16(this.registers.SP);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_A_HLminus() { // 0x3A: LD A, (HL-)
        // Load value from address HL into A, then decrement HL.
        this.registers.A = this.ReadMemory(this.registers.HL);
        this.registers.HL--;

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeDEC_SP() { // 0x3B: DEC SP
        // Decrement Stack Pointer. No flags affected.
        this.registers.SP = (this.registers.SP - 1) & 0xFFFF;

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeINC_HL_mem() { // 0x34: INC (HL)
        // Increment the byte at the memory address in HL.
        const address = this.registers.HL;
        const originalValue = this.ReadMemory(address);
        const result = (originalValue + 1) & 0xFF;
        this.WriteMemory(address, result);

        let f = this.registers.F & 0x10; // Preserve C flag
        if (result === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeDEC_HL_mem() { // 0x35: DEC (HL)
        const address = this.registers.HL;
        const originalValue = this.ReadMemory(address);
        const result = (originalValue - 1) & 0xFF;
        this.WriteMemory(address, result);

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (result === 0) f |= 0x80; // Z
        if ((originalValue & 0xF) === 0x0) f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeINC_A() { // 0x3C: INC A
        const originalValue = this.registers.A;
        this.registers.A = (originalValue + 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        if (this.registers.A === 0) f |= 0x80; // Z
        // N is 0
        if ((originalValue & 0xF) === 0xF) f |= 0x20; // H
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeDEC_A() { // 0x3D: DEC A
        const originalA = this.registers.A;
        this.registers.A = (originalA - 1) & 0xFF;

        let f = this.registers.F & 0x10; // Preserve C flag
        f |= 0x40; // N is 1
        if (this.registers.A === 0) f |= 0x80; // Z
        if ((originalA & 0xF) === 0x0) f |= 0x20; // H (borrow from bit 4)
        this.registers.F = f;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_A_n() { // 0x3E: LD A, n
        // Fetch the immediate value AND load it into register A
        const value = this.ReadMemory(this.registers.PC + 1); 
        this.registers.A = value;

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeCCF() { // 0x3F: CCF (Complement Carry Flag)
        // Invert the Carry flag. Clear N AND H flags.
        this.registers.F ^= 0x10;  // Toggle C
        this.registers.F &= ~0x60; // Clear N AND H

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_B() { // 0x40: LD B, B
        // No operation.
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_C() { // 0x41: LD B, C
        this.registers.B = this.registers.C;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_D() { // 0x42: LD B, D
        // Load the value of register D into register B.
        this.registers.B = this.registers.D;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_E() { // 0x43: LD B, E
        this.registers.B = this.registers.E;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_H() { // 0x44: LD B, H
        // Load the value of register H into register B.
        this.registers.B = this.registers.H;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_L() { // 0x45: LD B, L
        this.registers.B = this.registers.L;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_B_HL() { // 0x46: LD B, (HL)
        // Loads a byte from the memory address in HL into register B.
        this.registers.B = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_B_A() { // 0x47: LD B, A
        // Load the value of register A into register B.
        this.registers.B = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_B() { // 0x48: LD C, B
        this.registers.C = this.registers.B;
        
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_C() { // 0x49: LD C, C
        // No operation.
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_D() { // 0x4A: LD C, D
        this.registers.C = this.registers.D;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_E() { // 0x4B: LD C, E
        this.registers.C = this.registers.E;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_H() { // 0x4C: LD C, H
        this.registers.C = this.registers.H;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_L() { // 0x4D: LD C, L
        this.registers.C = this.registers.L;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_C_HL() { // 0x4E: LD C, (HL)
        // Loads a byte from the memory address in HL into register C.
        this.registers.C = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_C_A() { // 0x4F: LD C, A
        // Load the value of register A into register C.
        this.registers.C = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_B() { // 0x50: LD D, B
        this.registers.D = this.registers.B;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_C() { // 0x51: LD D, C
        this.registers.D = this.registers.C;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_D() { // 0x52: LD D, D
        // No-op
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_E() { // 0x53: LD D, E
        this.registers.D = this.registers.E;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_H() { // 0x54: LD D, H
        // Load the value of register H into register D.
        this.registers.D = this.registers.H;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_L() { // 0x55: LD D, L
        this.registers.D = this.registers.L;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_D_HL() { // 0x56: LD D, (HL)
        // Loads a byte from the memory address in HL into register D.
        this.registers.D = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_D_A() { // 0x57: LD D, A
        // Load the value of register A into register D.
        this.registers.D = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_B() { // 0x58: LD E, B
        this.registers.E = this.registers.B;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_C() { // 0x59: LD E, C
        this.registers.E = this.registers.C;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_D() { // 0x5A: LD E, D
        this.registers.E = this.registers.D;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_E() { // 0x5B: LD E, E
        // No-op
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_H() { // 0x5C: LD E, H
        // Loads the value from register H into E.
        this.registers.E = this.registers.H;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_L() { // 0x5D: LD E, L
        // Load L into E.
        this.registers.E = this.registers.L;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_E_HL() { // 0x5E: LD E, (HL)
        // Load value from memory at (HL) into E.
        this.registers.E = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_E_A() { // 0x5F: LD E, A
        // Load the value of register A into register E.
        this.registers.E = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_B() { // 0x60: LD H, B
        // Load the value of register B into register H.
        this.registers.H = this.registers.B;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_C() { // 0x61: LD H, C
        // Load the value of register C into register H.
        this.registers.H = this.registers.C;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_D() { // 0x62: LD H, D
        this.registers.H = this.registers.D;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_E() { // 0x63: LD H, E
        this.registers.H = this.registers.E;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_H() { // 0x64: LD H, H
        // No-op
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_L() { // 0x65: LD H, L
        this.registers.H = this.registers.L;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_H_HL() { // 0x66: LD H, (HL)
        // Load value from memory at (HL) into H.
        this.registers.H = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_H_A() { // 0x67: LD H, A
        // Loads the value from register A into H.
        this.registers.H = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_B() { // 0x68: LD L, B
        this.registers.L = this.registers.B;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_C() { // 0x69: LD L, C
        // Load the value of register C into register L.
        this.registers.L = this.registers.C;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_D() { // 0x6A: LD L, D
        this.registers.L = this.registers.D;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_E() { // 0x6B: LD L, E
        this.registers.L = this.registers.E;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_H() { // 0x6C: LD L, H
        this.registers.L = this.registers.H;
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_L() { // 0x6D: LD L, L
        // No-op
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_L_HL() { // 0x6E: LD L, (HL)
        // // Load the value from memory at address HL into register L
        this.registers.L = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_L_A() { // 0x6F: LD L, A
        // Load the value of register A into register L.
        this.registers.L = this.registers.A;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_HL_B() { // 0x70: LD (HL), B
        this.WriteMemory(this.registers.HL, this.registers.B);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_C() { // 0x71: LD (HL), C
        this.WriteMemory(this.registers.HL, this.registers.C);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_D() { // 0x72: LD (HL), D
        this.WriteMemory(this.registers.HL, this.registers.D);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_L() { // 0x75: LD (HL), L
        // Store L into memory at address HL.
        this.WriteMemory(this.registers.HL, this.registers.L);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_E() { // 0x73: LD (HL), E
        // Store the value of register E into memory at HL
        this.WriteMemory(this.registers.HL, this.registers.E);

        this.lastInstructionSize = 1;
        return 8;
    }
            
    opcodeLD_HL_H() { // 0x74: LD (HL), H
        // Store H into memory at address HL.
        this.WriteMemory(this.registers.HL, this.registers.H);
        this.lastInstructionSize = 1;
        return 8;
    }
            
    opcodeHALT() { // 0x76: HALT - Freeze the CPU until reset
        // console.log("HALT instruction executed");

        const pendingInterrupts = (this.IF & this.IE & 0x1F) !== 0;

        if (!this.interruptsEnabled && pendingInterrupts) {
            // HALT bug occurs when interrupts are disabled but there's a pending interrupt
            this.haltBugScheduled = true;
        }
        else {
            this.haltEnabled = true;
        }

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_HL_A() { // 0x77: LD (HL), A
        // Store the value of register A into the memory address pointed to by HL.
        this.WriteMemory(this.registers.HL, this.registers.A);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_A_D() { // 0x7A: LD A, D
        // Load the value of register D into register A.
        this.registers.A = this.registers.D;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_A_E() { // 0x7B: LD A, E
        // Load the value of register E into register A.
        this.registers.A = this.registers.E;

        this.lastInstructionSize = 1;
        return 4;
    }
            
    opcodeLD_A_C() { // 0x79: LD A, C
        // Load the value of register C into register A.
        this.registers.A = this.registers.C;

        this.lastInstructionSize = 1;
        return 4;
    }
            
    opcodeLD_A_B() { // 0x78: LD A, B
        // Load the value of register B into register A.
        this.registers.A = this.registers.B;

        this.lastInstructionSize = 1;
        return 4;
    }
            
    opcodeLD_A_H() { // 0x7C: LD A, H
        // Load the value of register H into register A.
        this.registers.A = this.registers.H;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_A_HL() { // 0x7E: LD A, (HL)
        // Loads a byte from the memory address in HL into A.
        this.registers.A = this.ReadMemory(this.registers.HL);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_A_A() { // 0x7F: LD A, A
        // No operation, just move to the next instruction
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeLD_A_L() { // 0x7D: LD A, L
        // Load the value of register L into register A.
        this.registers.A = this.registers.L;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_B() { // 0x80: ADD A, B - Add B to A
        this.Add(this.registers.B);
        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_C() { // 0x81: ADD A, C - Add C to A
        this.Add(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_D() { // 0x82: ADD A, D
        // Add D to A.
        this.Add(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_E() { // 0x83: ADD A, E
        this.Add(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_H() { // 0x84: ADD A, H
        this.Add(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_L() { // 0x85: ADD A, L
        this.Add(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADD_A_HL_mem() { // 0x86: ADD A, (HL)
        // Adds the byte from the memory address in HL to A.
        const value = this.ReadMemory(this.registers.HL);
        this.Add(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeADD_A_A() { // 0x87: ADD A, A
        // Adds A to itself.
        this.Add(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_B() { // 0x88: ADC A, B
        this.Adc(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_C() { // 0x89: ADC A, C
        this.Adc(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_D() { // 0x8A: ADC A, D
        // Add D AND the Carry flag to A.
        this.Adc(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_E() { // 0x8B: ADC A, E
        // Add E AND the Carry flag to A.
        this.Adc(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_H() { // 0x8C: ADC A, H
        // Adds H AND the Carry flag to A.
        this.Adc(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_L() { // 0x8D: ADC A, L
        // Add L AND the Carry flag to A.
        this.Adc(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeADC_A_HL_mem() { // 0x8E: ADC A, (HL)
        // Add with carry the value at memory address HL to A.
        const value = this.ReadMemory(this.registers.HL);
        this.Adc(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeADC_A_A() { // 0x8F: ADC A, A
        // Add A AND the Carry flag to A.
        this.Adc(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_B() { // 0x90: SUB B
        // Subtract the value of register B from A.
        this.Sub(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_C() { // 0x91: SUB C
        this.Sub(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_D() { // 0x92: SUB D
        this.Sub(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_E() { // 0x93: SUB E
        this.Sub(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_A_H() { // 0x94: SUB A, H
        // Subtract the value in H from A.
        this.Sub(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_L() { // 0x95: SUB L
        this.Sub(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSUB_HL_mem() { // 0x96: SUB (HL)
        // Subtract the value at memory address HL from A.
        const value = this.ReadMemory(this.registers.HL);
        this.Sub(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeSUB_A() { // 0x97: SUB A
        // Subtract A from A. Result is always 0.
        this.Sub(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_B() { // 0x98: SBC A, B
        // Subtract B AND the Carry flag from A.
        this.Sbc(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_C() { // 0x99: SBC A, C
        // Subtract C AND the Carry flag from A.
        this.Sbc(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_D() { // 0x9A: SBC A, D
        // Subtract D AND the Carry flag from A.
        this.Sbc(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_E() { // 0x9B: SBC A, E
        // Subtract E AND the Carry flag from A.
        this.Sbc(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_H() { // 0x9C: SBC A, H
        // Subtract H AND the Carry flag from A.
        this.Sbc(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_L() { // 0x9D: SBC A, L
        // Subtract L AND the Carry flag from A.
        this.Sbc(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeSBC_A_HL_mem() { // 0x9E: SBC A, (HL)
        // Subtract the value at memory address HL AND the Carry flag from A.
        const value = this.ReadMemory(this.registers.HL);
        this.Sbc(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeSBC_A_A() { // 0x9F: SBC A, A
        // Subtract A AND the Carry flag from A.
        this.Sbc(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_B() { // 0xA0: AND B
        // Bitwise AND A with B.
        this.AND(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_C() { // 0xA1: AND C
        this.AND(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_D() { // 0xA2: AND D
        this.AND(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_E() { // 0xA3: AND E
        this.AND(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_H() { // 0xA4: AND H
        this.AND(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_L() { // 0xA5: AND L
        this.AND(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeAND_HL_mem() { // 0xA6: AND (HL)
        // Bitwise AND A with the value at memory address HL.
        const value = this.ReadMemory(this.registers.HL);
        this.AND(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeAND_A() { // 0xA7: AND A
        this.AND(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_B() { // 0xA8: XOR B
        // Bitwise XOR A with B.
        this.XOR(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_C() { // 0xA9: XOR C
        this.XOR(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_D() { // 0xAA: XOR D
        this.XOR(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_E() { // 0xAB: XOR E
        this.XOR(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_H() { // 0xAC: XOR H
        this.XOR(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_L() { // 0xAD: XOR L
        this.XOR(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_HL() { // 0xAE: XOR (HL)
        // Performs a bitwise XOR between A AND the byte at the memory address in HL.
        const value = this.ReadMemory(this.registers.HL);
        this.XOR(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeXOR_A_A() { // 0xAF: XOR A, A
        // Exclusive OR the A register with itself.
        this.XOR(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_B() { // 0xB0: OR B
        // Performs a bitwise OR between register A AND register B.
        this.OR(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_C() { // 0xB1: OR C
        this.OR(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_D() { // 0xB2: OR D
        // Performs a bitwise OR between register A AND register D.
        this.OR(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_E() { // 0xB3: OR E
        // Performs a bitwise OR between register A AND register E.
        this.OR(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_H() { // 0xB4: OR H
        // Bitwise OR A with H.
        this.OR(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_L() { // 0xB5: OR L
        // Performs a bitwise OR between register A AND register L.
        this.OR(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_HL_mem() { // 0xB6: OR (HL)
        // Performs a bitwise OR between A AND the byte at the memory address in HL.
        const value = this.ReadMemory(this.registers.HL);
        this.OR(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeOR_A() { // 0xB7: OR A
        // Bitwise OR A with itself.
        this.OR(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_B() { // 0xB8: CP B
        // Compare A with B.
        this.CP(this.registers.B);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_C() { // 0xB9: CP C
        // Compare A with C.
        this.CP(this.registers.C);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_D() { // 0xBA: CP D
        // Compare A with D.
        this.CP(this.registers.D);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_E() { // 0xBB: CP E
        // Compare A with E.
        this.CP(this.registers.E);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_H() { // 0xBC: CP H
        // Compare A with H.
        this.CP(this.registers.H);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_L() { // 0xBD: CP L
        this.CP(this.registers.L);

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeCP_HL() { // 0xBE: CP (HL)
        // Compare A with the byte at the memory address in HL.
        const value = this.ReadMemory(this.registers.HL);
        this.CP(value);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeCP_A() { // 0xBF: CP A
        // Compare A with itself.
        this.CP(this.registers.A);

        this.lastInstructionSize = 1;
        return 4;
    }
            
    opcodeRET_NZ() { // 0xC0: RET NZ
        // Return if Zero flag is not set.
        this.lastInstructionSize = 1;
        if ((this.registers.F & 0x80) === 0) {
            this.registers.PC = this.Pop();
            this.PCJumped = true;
            return 20; // Cycles for return taken
        }
        return 8; // Cycles for return not taken
    }

    opcodeJP_nn() { // 0xC3: JP nn - Jump to address nn (16-bit immediate)
        const lowByte = this.ReadMemory(this.registers.PC + 1);  // Fetch lower byte (byte at PC+1)
        const highByte = this.ReadMemory(this.registers.PC + 2); // Fetch higher byte (byte at PC+2)
        
        // Combine the two bytes into a 16-bit address (little-endian format)
        const address = (highByte << 8) | lowByte;
        
        this.registers.PC = address; // Set PC to the new address
        this.PCJumped = true;
        this.lastInstructionSize = 3;
        return 16;
    }

    opcodeJP_NZ_nn() { // 0xC2: JP NZ, nn
        // console.log(`JP NZ, nn at PC=0x${this.registers.PC.toString(16)}, Z=${(this.registers.F & 0x80) !== 0}, branching=${(this.registers.F & 0x80) === 0}`);
        // Jump to address nn if Zero flag is not set.
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x80) === 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            this.registers.PC = (highByte << 8) | lowByte;
            this.PCJumped = true;
            return 16;
        }
        return 12;
    }

    opcodeADD_A_n() { // 0xC6: ADD A, n
        const n = this.ReadMemory(this.registers.PC + 1);
        this.Add(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST_00H() { // 0xC7: RST 00H
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        this.registers.PC = 0x0000;
        
        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeRET_Z() { // 0xC8: RET Z
        // Returns from a subroutine if the Zero flag is set.
        this.lastInstructionSize = 1;
        if ((this.registers.F & 0x80) !== 0) {
            this.registers.PC = this.Pop();
            return 20; // Cycles for return taken
        }
        return 8; // Cycles for return not taken
    }

    opcodeJP_Z_nn() { // 0xCA: JP Z, nn
        // console.log(`JP Z, nn at PC=0x${this.registers.PC.toString(16)}, Z=${(this.registers.F & 0x80) !== 0}, branching=${(this.registers.F & 0x80) !== 0}`);
        // Jumps to a 16-bit address if the Zero flag is set.
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x80) !== 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            this.registers.PC = (highByte << 8) | lowByte;
            this.PCJumped = true;
            return 16;
        }
        return 12;
    }

    opcodePOP_BC() { // 0xC1: POP BC
        // Pop 16-bit value from stack into BC.
        this.registers.BC = this.Pop();

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeADC_A_n() { // 0xCE: ADC A, n
        // Adds an immediate 8-bit value AND the Carry flag to register A.
        const n = this.ReadMemory(this.registers.PC + 1);
        this.Adc(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeCB() { // 0xCB: Prefix for bit manipulation instructions
        const cbOpcode = this.ReadMemory(this.registers.PC + 1);

        const opType = cbOpcode >> 6;    // 00: rotate, 01: BIT, 10: RES, 11: SET
        const bit = (cbOpcode >> 3) & 7; // Bit number (0-7)
        const regCode = cbOpcode & 7;    // Register code (0-7)

        let cycles = 8;
        if (regCode === 6) { // Operations on (HL) take more cycles
            cycles = (opType === 1) ? 12 : 16; // BIT is 12, RES/SET are 16
        }

        const value = this.CbGetReg(regCode);
        let result;

        switch (opType) {
            case 0: // Rotates AND Shifts
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
                    this.CbSetReg(regCode, result);
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
                this.CbSetReg(regCode, result);
                break;

            case 3: // SET b, r
                result = value | (1 << bit);
                this.CbSetReg(regCode, result);
                break;
        }
        this.lastInstructionSize = 2;
        return cycles;
    }

    opcodePUSH_BC() { // 0xC5: PUSH BC
        // Push register pair BC onto the stack.
        this.Push(this.registers.B, this.registers.C);

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodePUSH_DE() { // 0xD5: PUSH DE
        // Push register pair DE onto the stack.
        this.Push(this.registers.D, this.registers.E);

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodePUSH_HL() { // 0xE5: PUSH HL
        // Push register pair HL onto the stack.
        this.Push(this.registers.H, this.registers.L);

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodePUSH_AF() { // 0xF5: PUSH AF
        // Push register pair AF onto the stack.
        //The lower 4 bits of F are always 0, the F register setter handles this.
        this.Push(this.registers.A, this.registers.F);

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeCALL_NZ_nn() { // 0xC4: CALL NZ, nn
        // If Z flag is not set, call address nn
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x80) === 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            const address = (highByte << 8) | lowByte;

            // Push the current PC + 3 (next instruction) onto the stack
            const returnAddress = this.registers.PC + 3;

            this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

            this.registers.PC = address; // Jump to the subroutine
            this.PCJumped = true;
            return 24;
        }
        return 12;
    }

    opcodeRET() { // 0xC9: RET - Return from subroutine
        // Pop the 16-bit return address from the stack AND jump to it.
        this.registers.PC = this.Pop();
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeCALL_Z_nn() { // 0xCC: CALL Z, nn
        // If Z flag is set, call address nn
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x80) !== 0) { // prettier-ignore
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            const address = (highByte << 8) | lowByte; // Combine bytes to form 16-bit address
            
            // Push the current PC + 3 (next instruction) onto the stack
            const returnAddress = this.registers.PC + 3;
            
            this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

            this.registers.PC = address; // Jump to the subroutine
            this.PCJumped = true;
            return 24;
        }
        return 12;
    }

    opcodeCALL_nn() { // 0xCD: CALL nn
        // Unconditionally call address nn
        const lowByte = this.ReadMemory(this.registers.PC + 1);
        const highByte = this.ReadMemory(this.registers.PC + 2);
        const address = (highByte << 8) | lowByte;

        // Push the address of the next instruction (PC + 3) onto the stack
        const returnAddress = this.registers.PC + 3;

        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        
        this.registers.PC = address;
        this.PCJumped = true;

        this.lastInstructionSize = 3;
        return 24;
    }

    opcodeRET_NC() { // 0xD0: RET NC
        // Return if Carry flag is not set.
        this.lastInstructionSize = 1;
        if ((this.registers.F & 0x10) === 0) {
            this.registers.PC = this.Pop();
            this.PCJumped = true;
            return 20; // Cycles for return taken
        }
        return 8; // Cycles for return not taken
    }

    opcodePOP_DE() { // 0xD1: POP DE
        // Pop 16-bit value from stack into DE.
        this.registers.DE = this.Pop();

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeJP_NC_nn() { // 0xD2: JP NC, nn
        // Jump to address nn if Carry flag is not set.
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x10) === 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            this.registers.PC = (highByte << 8) | lowByte;
            this.PCJumped = true;
            return 16;
        }
        return 12;
    }

    opcodeSUB_n() { // 0xD6: SUB n - Subtract immediate value n from A
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate value n (byte at PC + 1)
        this.Sub(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST_10H() { // 0xD7: RST 10H
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        this.registers.PC = 0x0010;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeRET_C() { // 0xD8: RET C
        // Return if Carry flag is set.
        this.lastInstructionSize = 1;
        if ((this.registers.F & 0x10) !== 0) {
            this.registers.PC = this.Pop();
            this.PCJumped = true;
            return 20; // Cycles for return taken
        }
        return 8; // Cycles for return not taken
    }

    opcodeRETI() { // 0xD9: RETI - Return AND enable interrupts
        // Pop the 16-bit return address from the stack
        const returnAddress = this.Pop();
    
        // Update the program counter
        this.registers.PC = returnAddress;
        this.PCJumped = true;

        // Enable interrupts (like EI, this is delayed by one instruction)
        this.imeCounter = 2;
    
        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeJP_C_nn() { // 0xDA: JP C, nn
        // Jump to address nn if Carry flag is set.
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x10) !== 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            this.registers.PC = (highByte << 8) | lowByte;
            this.PCJumped = true;
            return 16;
        }
        return 12;
    }

    opcodeSBC_A_n() { // 0xDE: SBC A, n
        // Subtract immediate 8-bit value n AND Carry from A.
        const n = this.ReadMemory(this.registers.PC + 1);
        this.Sbc(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST_08H() { // 0xCF: RST 08H
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        this.registers.PC = 0x0008;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeCALL_NC_nn() { // 0xD4: CALL NC, nn
        // If C flag is not set, call address nn
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x10) === 0) {
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            const address = (highByte << 8) | lowByte;
            
            const returnAddress = this.registers.PC + 3;
            this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

            this.registers.PC = address;
            this.PCJumped = true;

            return 24;
        }
        return 12;
    }

    opcodeCALL_C_nn() { // 0xDC: CALL C, nn
        // If C flag is set, call address nn
        this.lastInstructionSize = 3;
        if ((this.registers.F & 0x10) !== 0) { // prettier-ignore
            const lowByte = this.ReadMemory(this.registers.PC + 1);
            const highByte = this.ReadMemory(this.registers.PC + 2);
            const address = (highByte << 8) | lowByte;           // Combine bytes to form 16-bit address
    
            // Push the current PC + 3 (next instruction) onto the stack
            const returnAddress = this.registers.PC + 3;
            this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);

            this.registers.PC = address; // Jump to the subroutine
            this.PCJumped = true;

            return 24;
        }
        return 12;
    }

    opcodeRST_18H() { // 0xDF: RST 18H
        // restart instruction
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        
        // Set the PC to 0x0018
        this.registers.PC = 0x0018;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeLDH_n_A() { // 0xE0: LDH (n), A
        // Loads the value in the A register into memory at the address 0xFF00 + n, where n is an 8-bit immediate value
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate value
        const address = 0xFF00 + n;                   // Calculate the target address
        this.WriteMemory(address, this.registers.A);  // Store the value in A at the address
        
        this.lastInstructionSize = 2;
        return 12;
    }

    opcodeLD_C_mem_A() { // 0xE2: LD (C), A
        // Store A into memory at address 0xFF00 + C.
        this.WriteMemory(0xFF00 + this.registers.C, this.registers.A);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodePOP_HL() { // 0xE1: POP HL
        // Pop 16-bit value from stack into HL.
        this.registers.HL = this.Pop();

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeADD_SP_n() { // 0xE8: ADD SP, n
        // Add signed immediate 8-bit value n to SP.
        const n_unsigned = this.ReadMemory(this.registers.PC + 1);
        const n_signed = this.SignedValue(n_unsigned);
        const sp = this.registers.SP;

        const result = sp + n_signed;

        let f = 0; // Flags Z AND N are always cleared (0)

        // Check for Half Carry from bit 3 (based on low byte of SP)
        if (((sp & 0x0F) + (n_unsigned & 0x0F)) > 0x0F) {
            f |= 0x20; // Set H flag
        }

        // Check for Carry from bit 7 (based on low byte of SP)
        if (((sp & 0xFF) + n_unsigned) > 0xFF) {
            f |= 0x10; // Set C flag
        }
        
        this.registers.F = f;
        this.registers.SP = result & 0xFFFF;

        this.lastInstructionSize = 2;
        return 16;
    }

    opcodeJP_HL() { // 0xE9: JP (HL)
        // Jump to the address contained in HL.
        this.registers.PC = this.registers.HL;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeXOR_n() { // 0xEE: XOR n
        const n = this.ReadMemory(this.registers.PC + 1);
        this.XOR(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeAND_n() { // 0xE6: AND n
        const immediateValue = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate 8-bit value
        this.AND(immediateValue);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST_20H() { // 0xE7: RST 20H
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        this.registers.PC = 0x0020;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeLD_nn_A() { // 0xEA: LD (nn), A
        // Store the value of register A into the memory address specified by nn.
        const lowByte = this.ReadMemory(this.registers.PC + 1);
        const highByte = this.ReadMemory(this.registers.PC + 2);
        const address = (highByte << 8) | lowByte;

        this.WriteMemory(address, this.registers.A);

        this.lastInstructionSize = 3;
        return 16;
    }

    opcodeLDAFromImmediateIO() { // 0xF0: LD A, (n)
        // Load the value from memory at address 0xFF00 + n into register A.
        const n = this.ReadMemory(this.registers.PC + 1); // Fetch the immediate value n
        this.registers.A = this.ReadMemory(0xFF00 + n);  // Load from memory address (0xFF00 + n)

        this.lastInstructionSize = 2;
        return 12;
    }

    opcodePOP_AF() { // 0xF1: POP AF
        // Pop 16-bit value from stack into AF.
        const poppedValue = this.Pop();
        this.registers.A = (poppedValue >> 8) & 0xFF;
        this.registers.F = poppedValue & 0xF0;

        this.lastInstructionSize = 1;
        return 12;
    }

    opcodeLD_A_C_mem() { // 0xF2: LD A, (C)
        // Load A from memory at address 0xFF00 + C.
        this.registers.A = this.ReadMemory(0xFF00 + this.registers.C);

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeDI() { // 0xF3: DI - Disable interrupts
        this.DisableInterrupts();
        this.imeCounter = 0; // DI also cancels a pending EI/RETI

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeEI() { // 0xFB: EI
        // Schedule IME to be enabled just before the next instruction.
        this.imeCounter = 2; // Interrupts are enabled AFTER the instruction following EI.

        this.lastInstructionSize = 1;
        return 4;
    }

    opcodeOR_n() { // 0xF6: OR n
        const n = this.ReadMemory(this.registers.PC + 1);
        this.OR(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST_30H() { // 0xF7: RST 30H
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        this.registers.PC = 0x0030;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeLD_SP_HL() { // 0xF9: LD SP, HL
        // Load the value of HL into SP.
        this.registers.SP = this.registers.HL;

        this.lastInstructionSize = 1;
        return 8;
    }

    opcodeLD_HL_SP_plus_n() { // 0xF8: LD HL, SP+n
        // Adds a signed immediate 8-bit value n to SP AND stores the result in HL.
        const n_unsigned = this.ReadMemory(this.registers.PC + 1);
        const n_signed = this.SignedValue(n_unsigned);
        const sp = this.registers.SP;

        const result = sp + n_signed;

        let f = 0; // Flags Z AND N are always cleared (0)

        // Check for Half Carry from bit 3 (based on low byte of SP)
        if (((sp & 0x0F) + (n_unsigned & 0x0F)) > 0x0F) {
            f |= 0x20; // Set H flag
        }

        // Check for Carry from bit 7 (based on low byte of SP)
        if (((sp & 0xFF) + n_unsigned) > 0xFF) {
            f |= 0x10; // Set C flag
        }

        this.registers.F = f;
        this.registers.HL = result & 0xFFFF;

        this.lastInstructionSize = 2;
        return 12;
    }

    opcodeLD_A_nn() { // 0xFA: LD A, (nn)
        // Load the value from memory at address nn into A.
        const lowByte = this.ReadMemory(this.registers.PC + 1); // Fetch lower byte
        const highByte = this.ReadMemory(this.registers.PC + 2); // Fetch higher byte
        const address = (highByte << 8) | lowByte; // Combine into 16-bit address

        this.registers.A = this.ReadMemory(address); // Load value into A

        this.lastInstructionSize = 3;
        return 16;
    }

    opcodeRST_28H() { // 0xEF: RST 28H
        // Restart instruction, call to 0x0028.
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        
        // Jump to address 0x0028
        this.registers.PC = 0x0028;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeCPAImmediate() { // 0xFE: CP A, n
        // Compare the value in A with the immediate value n.
        // This is a subtraction (A - n) without storing the result.
        const n = this.ReadMemory(this.registers.PC + 1);
        this.CP(n);

        this.lastInstructionSize = 2;
        return 8;
    }

    opcodeRST38() { // 0xFF: RST 38H
        // Restart instruction, essentially a call to a fixed address (0x0038).
        // It pushes the PC+1 onto the stack AND then jumps to the specified address.
        const returnAddress = this.registers.PC + 1;
        this.Push((returnAddress >> 8) & 0xFF, returnAddress & 0xFF);
        
        // Jump to address 0x0038
        this.registers.PC = 0x0038;
        this.PCJumped = true;

        this.lastInstructionSize = 1;
        return 16;
    }

    opcodeILLEGAL() { // Handler for illegal opcodes
        const opcode = this.memory[this.registers.PC];
        console.warn(`Executed illegal opcode: 0x${opcode.toString(16)} at 0x${(this.registers.PC).toString(16)}`);
        
        this.lastInstructionSize = 1;
        return 4; // Return default cycles
    }

// #endregion (opcode functions)
}