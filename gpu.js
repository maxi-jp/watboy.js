const GPU_MODES = {
    HBLANK: 0,
    VBLANK: 1,
    OAM_SEARCH: 2,
    DRAWING: 3
}

class GameBoyGPU {
    constructor(canvas, ctx, screenWidth, screenHeight, cpu) {
        this.canvas = canvas;
        this.ctx = ctx ? ctx : canvas.getContext('2d');
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;
        this.cpu = cpu;
        this.memory = cpu.memory;

        this.frameBuffer = new Uint8Array(this.screenWidth * this.screenHeight).fill(0);
        this.bgPriorityBuffer = new Uint8Array(this.screenWidth * this.screenHeight).fill(0);

        this.imageData = ctx.createImageData(this.screenWidth, this.screenHeight);

        // HBlank | VBlank | OAM search | Drawing pixels
        this.mode = GPU_MODES.OAM_SEARCH; // Initial mode: OAM search
        this.modeClock = 0;
        this.line = 0;
        this.windowLineCounter = 0;
        this.lcdDisabledDuringVBlank = false; // Flag to track LCD disable during VBLANK
        
        // Initialize LY register
        this.memory[0xFF44] = this.line;

        this.colorPalets = [
            [[255, 255, 255], [192, 192, 192], [ 96,  96,  96], [  0,  0,  0]], // Classic Game Boy shades: White, Light Gray, Dark Gray, Black
            [[127, 134,  15], [ 87, 124,  68], [ 54,  93,  72], [ 42, 69, 59]], // DMG-01
            [[250, 251, 246], [198, 183, 190], [ 86,  90, 117], [ 15, 15, 27]], // https://lospec.com/palette-list/hollow
            [[230, 214, 156], [180, 165, 106], [123, 113,  98], [ 57, 56, 41]], // https://lospec.com/palette-list/muddysand
            [[139, 229, 255], [ 96, 143, 207], [117,  80, 232], [ 98, 46, 76]], // https://lospec.com/palette-list/muddysand
        ];
        this.currentPalet = this.colorPalets[0];
    }

    Update(cycles) {
        // if (this.cpu.steps < 10000) { // Only for first 10k steps
        //     this.print(cycles);
        // }
        
        const lcdc = this.memory[0xFF40];

        this.modeClock += cycles;

        switch (this.mode) {
            case GPU_MODES.HBLANK: // HBlank
                if (this.modeClock >= 204) {
                    this.modeClock -= 204;
                    this.line++; // Increment to the next line
                    this.UpdateLY(); // Update LY register and check LYC

                    if (this.line === 144) {
                        this.SetMode(GPU_MODES.VBLANK);
                        this.cpu.RequestInterrupt(this.cpu.INT.VBLANK);
                        this.DrawFrame(); // Render the completed frame
                    }
                    else {
                        this.SetMode(GPU_MODES.OAM_SEARCH);
                    }
                }
                break;

            case GPU_MODES.VBLANK: // VBlank
                if (this.modeClock >= 456) {
                    this.modeClock -= 456;
                    this.line++;

                    if (this.line > 153) { // End of V-Blank
                        this.line = 0;
                        this.windowLineCounter = 0; // Reset for new frame
                        this.SetMode(GPU_MODES.OAM_SEARCH);
                    }
                    
                    this.UpdateLY(); // Update LY register and check LYC
                }
                break;

            case GPU_MODES.OAM_SEARCH: // OAM search
                if (this.modeClock >= 80) {
                    this.modeClock -= 80;
                    this.SetMode(GPU_MODES.DRAWING);
                }
                break;

            case GPU_MODES.DRAWING: // Drawing pixels
                if (this.modeClock >= 172) {
                    this.modeClock -= 172;
                    this.DrawScanline();
                    this.SetMode(GPU_MODES.HBLANK);
                }
                break;
        }
    }

    SetMode(newMode) {
        this.mode = newMode;

        let stat = this.memory[0xFF41];
        // Update mode bits in STAT register
        stat = (stat & 0xFC) | this.mode;
        this.memory[0xFF41] = stat;

        // Don't request interrupt if LCD is off
        const lcdc = this.memory[0xFF40];
        if ((lcdc & 0x80) === 0) {
            return;
        }

        // Check for mode-based STAT interrupts (triggered on entering a mode)
        const hblankInt = (this.mode === GPU_MODES.HBLANK) && (stat & 0x08);
        const vblankInt = (this.mode === GPU_MODES.VBLANK) && (stat & 0x10);
        const oamInt = (this.mode === GPU_MODES.OAM_SEARCH) && (stat & 0x20);

        if (hblankInt || vblankInt || oamInt) {
            this.cpu.RequestInterrupt(this.cpu.INT.LCD);
        }
    }

    UpdateLY() {
        // const oldLY = this.memory[0xFF44];
        // if (this.cpu.steps >= 8180 && this.cpu.steps <= 8185) {
        //     console.log(`Step ${this.cpu.steps}: UpdateLY() called, setting LY from ${oldLY} to ${this.line}`);
        // }
        this.memory[0xFF44] = this.line;
        // if (this.cpu.steps >= 8180 && this.cpu.steps <= 8185 && oldLY !== this.line) {
        //     console.log(`Step ${this.cpu.steps}: LY changed from ${oldLY} to ${this.line}`);
        // }
        this.CheckLYC();
    }

    CheckLYC() {
        const ly = this.memory[0xFF44];
        const lyc = this.memory[0xFF45];
        let stat = this.memory[0xFF41];

        if (ly === lyc) {
            stat |= 0x04; // Set coincidence flag
            // Don't request interrupt if LCD is off
            const lcdc = this.memory[0xFF40];
            if ((lcdc & 0x80) !== 0 && (stat & 0x40)) { // If LYC=LY interrupt is enabled
                this.cpu.RequestInterrupt(this.cpu.INT.LCD);
            }
        }
        else {
            stat &= ~0x04; // Clear coincidence flag
        }
        this.memory[0xFF41] = stat;
    }

    DrawScanline() {
        const lcdc = this.memory[0xFF40];

        // Is background display enabled? (LCDC Bit 0)
        if ((lcdc & 0x01) !== 0) {
            this.DrawBackground();
        }
        else {
            // If not, the scanline is blank (white).
            for (let x = 0; x < this.screenWidth; x++) {
                const pixelIndex = this.line * this.screenWidth + x;
                this.frameBuffer[pixelIndex] = 0; // White
                this.bgPriorityBuffer[pixelIndex] = 0; // No BG priority
            }
        }

        // Are sprites enabled? (LCDC Bit 1)
        if ((lcdc & 0x02) !== 0) {
            this.DrawSprites();
        }
    }

    DrawBackground() {
        const lcdc = this.memory[0xFF40];
        const scy = this.memory[0xFF42];
        const scx = this.memory[0xFF43];
        const bgp = this.memory[0xFF47];

        // Which tile map to use? (LCDC Bit 3)
        const tileMapBase = (lcdc & 0x08) ? 0x9C00 : 0x9800;

        // Which tile data to use? (LCDC Bit 4)
        const tileDataBase = (lcdc & 0x10) ? 0x8000 : 0x8800;
        const signedTileIndices = (tileDataBase === 0x8800);

        // The Y coordinate in the 256x256 background map we're currently drawing.
        const yOnMap = (this.line + scy) & 0xFF;

        // Which row of pixels in a tile are we? (0-7)
        const tileRow = yOnMap % 8;

        for (let x = 0; x < this.screenWidth; x++) {
            // The X coordinate in the 256x256 background map.
            const xOnMap = (x + scx) & 0xFF;

            // Get the address of the tile ID in the tile map.
            const tileIdAddress = tileMapBase + (Math.floor(yOnMap / 8) * 32) + Math.floor(xOnMap / 8);

            // Get the tile ID from that address.
            let tileId = this.memory[tileIdAddress];

            // Calculate the address of the tile's data in VRAM.
            let tileDataAddress;
            if (signedTileIndices) {
                tileDataAddress = 0x9000 + (this.cpu.SignedValue(tileId) * 16);
            }
            else {
                tileDataAddress = tileDataBase + (tileId * 16);
            }

            const tileRowAddress = tileDataAddress + (tileRow * 2);
            const byte1 = this.memory[tileRowAddress];
            const byte2 = this.memory[tileRowAddress + 1];

            const bitPosition = 7 - (xOnMap % 8);
            const colorNumber = (((byte2 >> bitPosition) & 1) << 1) | ((byte1 >> bitPosition) & 1);
            const shade = (bgp >> (colorNumber * 2)) & 0x03;

            const pixelIndex = this.line * this.screenWidth + x;
            this.frameBuffer[pixelIndex] = shade;
            this.bgPriorityBuffer[pixelIndex] = (colorNumber !== 0);
        }
    }

    DrawSprites() {
        const lcdc = this.memory[0xFF40];
        const spriteHeight = (lcdc & 0x04) ? 16 : 8;
        const obp0 = this.memory[0xFF48];
        const obp1 = this.memory[0xFF49];

        let spritesOnLine = [];
        // Find up to 10 sprites on the current scanline
        for (let i = 0; i < 40; i++) {
            const oamAddr = 0xFE00 + (i * 4);
            const yPos = this.memory[oamAddr] - 16;

            // Is sprite on the current line?
            if (this.line >= yPos && this.line < (yPos + spriteHeight)) {
                spritesOnLine.push({
                    y: yPos,
                    x: this.memory[oamAddr + 1] - 8,
                    tileIndex: this.memory[oamAddr + 2],
                    attributes: this.memory[oamAddr + 3],
                    oamAddress: oamAddr
                });
            }

            if (spritesOnLine.length >= 10) {
                break; // Max 10 sprites per line
            }
        }

        // Sort sprites by priority. Lower X-coordinate has higher priority.
        // If X is equal, lower OAM address has higher priority.
        // We draw lower-priority sprites first so they are overwritten by higher-priority ones.
        spritesOnLine.sort((a, b) => {
            if (a.x !== b.x) {
                return b.x - a.x; // Higher X (lower priority) comes first
            }
            return b.oamAddress - a.oamAddress; // Higher OAM address (lower priority) comes first
        });

        for (const sprite of spritesOnLine) {
            const yFlip = (sprite.attributes & 0x40) !== 0;
            const xFlip = (sprite.attributes & 0x20) !== 0;
            const bgOverObj = (sprite.attributes & 0x80) !== 0;
            const palette = (sprite.attributes & 0x10) ? obp1 : obp0;

            let tileRow = this.line - sprite.y;
            if (yFlip) {
                tileRow = (spriteHeight - 1) - tileRow;
            }

            let tileIndex = sprite.tileIndex;
            if (spriteHeight === 16) {
                tileIndex &= 0xFE; // For 8x16 sprites, the LSB of the tile index is ignored.
                if (tileRow >= 8) {
                    tileIndex++; // Use the bottom tile
                    tileRow -= 8;
                }
            }

            const tileDataAddress = 0x8000 + (tileIndex * 16) + (tileRow * 2);
            const byte1 = this.memory[tileDataAddress];
            const byte2 = this.memory[tileDataAddress + 1];

            for (let x = 0; x < 8; x++) {
                const pixelX = sprite.x + x;
                if (pixelX < 0 || pixelX >= this.screenWidth) continue;

                const bitPosition = xFlip ? x : 7 - x;
                const colorNumber = (((byte2 >> bitPosition) & 1) << 1) | ((byte1 >> bitPosition) & 1);

                if (colorNumber === 0) continue; // Color 0 is transparent for sprites

                const pixelIndex = this.line * this.screenWidth + pixelX;

                // BG over OBJ priority check
                if (bgOverObj && this.bgPriorityBuffer[pixelIndex]) {
                    continue; // Background pixel has priority (its color number was not 0)
                }

                const shade = (palette >> (colorNumber * 2)) & 0x03;
                this.frameBuffer[pixelIndex] = shade;
            }
        }
    }

    DrawFrame() {
        // this.RenderAsRects();
        this.RenderAsImageData();
    }

    RenderAsImageData() {
        for (let i = 0; i < this.frameBuffer.length; i++) {
            const shadeIndex = this.frameBuffer[i]; // This is 0, 1, 2, or 3
            const color = this.currentPalet[shadeIndex];

            const pixelIndex = i * 4;
    
            this.imageData.data[pixelIndex] = color[0];     // Red
            this.imageData.data[pixelIndex + 1] = color[1]; // Green
            this.imageData.data[pixelIndex + 2] = color[2]; // Blue
            this.imageData.data[pixelIndex + 3] = 255;   // Alpha (fully opaque)
        }
    
        // Draw the ImageData to the canvas
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    RenderAsRects() {
        for (let i = 0; i < this.screenWidth * this.screenHeight; i++) {
            const colorIndex = this.frameBuffer[i];
            const color = this.currentPalet[colorIndex];
            const x = i % this.screenWidth;
            const y = Math.floor(i / this.screenWidth);
            this.ctx.fillStyle = color;
            this.ctx.fillRect(x, y, 1, 1);
        }
    }

    SetColorPallete(id) {
        this.currentPalet = this.colorPalets[id];
    }

    HandleLcdcWrite(value) {
        if (this.cpu.steps < 10000) {
            const lcdWasOn = (this.memory[0xFF40] & 0x80) !== 0;
            const lcdIsOn = (value & 0x80) !== 0;
            console.log(`LCDC Write: step=${this.cpu.steps}, value=0x${value.toString(16)}, LCD was ${lcdWasOn ? 'ON' : 'OFF'}, now ${lcdIsOn ? 'ON' : 'OFF'}`);
        }
    }

    Print(cycles) {
        console.log(`GPU Update: step=${this.cpu.steps}, cycles=${cycles}, modeClock=${this.modeClock}, mode=${this.mode}, line=${this.line}`);
    }
}