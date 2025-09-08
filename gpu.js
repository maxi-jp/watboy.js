const GPU_MODES = {
    HBLANK: 0,
    VBLANK: 1,
    OAM_SEARCH: 2,
    DRAWING: 3
}

class GameBoyGPU {
    constructor(canvas, ctx, screenWidth, screenHeight, memory) {
        this.canvas = canvas;
        this.ctx = ctx ? ctx : canvas.getContext('2d');
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;
        this.memory = memory;

        this.frameBuffer = new Uint8Array(this.screenWidth * this.screenHeight).fill(0);

        this.imageData = ctx.createImageData(this.screenWidth, this.screenHeight);

        // HBlank | VBlank | OAM search | Drawing pixels
        this.mode = GPU_MODES.OAM_SEARCH; // Initial mode: OAM search
        this.modeClock = 0;
        this.line = 0;
    }

    update(cycles) {
        this.modeClock += cycles;
        
        let vblank = false;

        switch (this.mode) {
            case GPU_MODES.HBLANK: // HBlank
                if (this.modeClock >= 204) {
                    this.modeClock = 0;
                    this.line++;
                    if (this.line == 143) {
                        this.mode = 1; // Enter VBlank
                        vblank = true;
                        this.drawFrame();
                    } else {
                        this.mode = 2; // Enter OAM search
                    }
                }
                break;
            case GPU_MODES.VBLANK: // VBlank
                if (this.modeClock >= 456) {
                    this.modeClock = 0;
                    this.line++;
                    if (this.line > 153) {
                        this.mode = 2; // Enter OAM search
                        this.line = 0;
                    }
                }
                break;
            case GPU_MODES.OAM_SEARCH: // OAM search
                if (this.modeClock >= 80) {
                    this.modeClock = 0;
                    this.mode = 3; // Enter drawing pixels
                }
                break;
            case GPU_MODES.DRAWING: // Drawing pixels
                if (this.modeClock >= 172) {
                    this.modeClock = 0;
                    this.mode = 0; // Enter HBlank
                    this.drawScanline();
                }
                break;
        }

        return vblank;
    }

    drawScanline() {
        // Example: Fill the current scanline with a gradient
        // for (let x = 0; x < this.screenWidth; x++) {
        //     const colorIndex = Math.floor((x / this.screenWidth) * 4); // 0 to 3
        //     const pixelIndex = this.line * this.screenWidth + x;
        //     this.frameBuffer[pixelIndex] = this.getColorFromIndex[colorIndex];
        // }

        const lcdc = this.memory[0xFF40];

        // Is background display enabled? (LCDC Bit 0)
        if ((lcdc & 0x01) === 0) {
            // If not, the scanline is blank (white).
            for (let x = 0; x < this.screenWidth; x++) {
                const pixelIndex = this.line * this.screenWidth + x;
                this.frameBuffer[pixelIndex] = 0; // White
            }
            return;
        }

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
                // Signed addressing: 0x9000 is the base.
                if (tileId > 127) tileId -= 256;
                tileDataAddress = 0x9000 + (tileId * 16);
            } else {
                // Unsigned addressing from 0x8000.
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
        }
    }

    drawFrame() {
        //this.renderAsRects();
        this.renderAsImageData();
    }

    renderAsImageData() {
        // Classic Game Boy shades: White, Light Gray, Dark Gray, Black
        const shades = [255, 192, 96, 0];

        for (let i = 0; i < this.frameBuffer.length; i++) {
            const shadeIndex = this.frameBuffer[i]; // This is 0, 1, 2, or 3
            const color = shades[shadeIndex];

            const pixelIndex = i * 4;
    
            this.imageData.data[pixelIndex] = color;     // Red
            this.imageData.data[pixelIndex + 1] = color; // Green
            this.imageData.data[pixelIndex + 2] = color; // Blue
            this.imageData.data[pixelIndex + 3] = 255;   // Alpha (fully opaque)
        }
    
        // Draw the ImageData to the canvas
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    renderAsRects() {
        for (let i = 0; i < this.screenWidth * this.screenHeight; i++) {
            const colorIndex = this.frameBuffer[i];
            const color = this.getColorFromIndex(colorIndex);
            const x = i % this.screenWidth;
            const y = Math.floor(i / this.screenWidth);
            this.ctx.fillStyle = color;
            this.ctx.fillRect(x, y, 1, 1);
        }
    }

    getColorFromIndex(index) {
        const colors = [
            "#FFFFFF", "#C0C0C0", "#808080", "#000000"
        ];
        return colors[index];
    }
}