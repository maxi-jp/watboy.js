class MBC {
    constructor(cpu) {
        this.cpu = cpu;
    }

    handleWrite(address, value) { }
}

class MBC1 extends MBC {
    constructor(cpu, romData) {
        super(cpu);

        this.rom = romData;
        this.ram = new Uint8Array(32 * 1024); // 32KB RAM
        this.romBank = 1;
        this.ramBank = 0;
        this.ramEnabled = false;
        this.mode = 0; // 0 = ROM banking, 1 = RAM banking
    }

    handleWrite(address, value) {
        if (address < 0x2000) { // RAM Enable
            this.ramEnabled = (value & 0x0A) === 0x0A;
        }
        else if (address < 0x4000) { // ROM Bank Number (lower 5 bits)
            const bank = value & 0x1F;
            this.romBank = (this.romBank & 0xE0) | (bank === 0 ? 1 : bank);
            this.switchRomBank();
        }
        else if (address < 0x6000) { // RAM Bank or ROM Bank upper bits
            if (this.mode === 0) { // ROM mode
                this.romBank = (this.romBank & 0x1F) | ((value & 3) << 5);
                this.switchRomBank();
            }
            else { // RAM mode
                this.ramBank = value & 3;
            }
        }
        else if (address < 0x8000) { // Banking Mode Select
            this.mode = value & 1;
        }
    }

    switchRomBank() {
        const maxBanks = this.rom.length / 0x4000;
        const effectiveBank = this.romBank % maxBanks;
        const bankOffset = effectiveBank * 0x4000;

        // Load the new bank into the 0x4000-0x7FFF memory region
        for (let i = 0; i < 0x4000; i++) {
            this.cpu.memory[0x4000 + i] = this.rom[bankOffset + i];
        }
    }

    readRam(address) {
        if (!this.ramEnabled)
            return 0xFF;

        const ramAddress = (this.mode === 1 ? this.ramBank * 0x2000 : 0) + (address - 0xA000);
        return this.ram[ramAddress];
    }

    writeRam(address, value) {
        if (!this.ramEnabled)
            return;
        
        const ramAddress = (this.mode === 1 ? this.ramBank * 0x2000 : 0) + (address - 0xA000);
        this.ram[ramAddress] = value;
    }
}