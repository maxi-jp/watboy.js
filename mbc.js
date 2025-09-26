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
            // Combine with upper bits if in ROM mode
            const upperBits = this.romBank & 0x60; // Always preserve upper bits
            this.romBank = upperBits | (bank === 0 ? 1 : bank);
        }
        else if (address < 0x6000) { // RAM Bank or ROM Bank upper bits
            if (this.mode === 0) { // ROM mode
                this.romBank = (this.romBank & 0x1F) | ((value & 0x03) << 5);
            }
            else { // RAM mode
                this.ramBank = value & 3;
            }
        }
        else if (address < 0x8000) { // Banking Mode Select
            this.mode = value & 1;
        }
    }

    readRom(address) {
        let bank = 0;

        if (address < 0x4000) {
            // Fixed Bank Area (0x0000-0x3FFF)
            if (this.mode === 1) {
                // In RAM banking mode, the upper bits of romBank select the bank for this area.
                bank = (this.romBank & 0x60);
            }
        } 
        else {
            // Switchable Bank Area (0x4000-0x7FFF)
            if (this.mode === 1) {
                // In RAM banking mode, the upper bits are ignored for this area.
                bank = (this.romBank & 0x1F);
            }
            else {
                bank = this.romBank;
            }
        }

        const maxBanks = this.rom.length / 0x4000;
        const effectiveBank = bank % maxBanks;
        const bankOffset = effectiveBank * 0x4000;
        const romAddress = bankOffset + (address & 0x3FFF); // Get offset within the 16KB bank

        return this.rom[romAddress];
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