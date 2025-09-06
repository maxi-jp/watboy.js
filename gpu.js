const GPU_MODES = {
    HBLANK: 0,
    VBLANK: 1,
    OAM_SEARCH: 2,
    DRAWING: 3
}

class GameBoyGPU {
    constructor(canvas, ctx, screenWidth, screenHeight) {
        this.canvas = canvas;
        this.ctx = ctx ? ctx : canvas.getContext('2d');
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;

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
        for (let x = 0; x < this.screenWidth; x++) {
            const colorIndex = Math.floor((x / this.screenWidth) * 4); // 0 to 3
            const pixelIndex = this.line * this.screenWidth + x;
            this.frameBuffer[pixelIndex] = this.getColorFromIndex[colorIndex];
        }
    }

    drawFrame() {
        this.renderAsRects();
        //this.renderAsImageData();
    }

    renderAsImageData() {
        for (let i = 0; i < this.frameBuffer.length; i++) {
            const colorIndex = this.frameBuffer[i];
            const intensity = this.getColorFromIndex(colorIndex);
    
            // Convert intensity to a grayscale value (0-255)
            const color = intensity * 85; // 0 => 0, 1 => 85, 2 => 170, 3 => 255
    
            // Calculate the pixel index in ImageData
            const pixelIndex = i * 4;
    
            this.imageData.data[pixelIndex] = color;     // Red
            this.imageData.data[pixelIndex + 1] = color; // Green
            this.imageData.data[pixelIndex + 2] = color; // Blue
            this.imageData.data[pixelIndex + 3] = 255;   // Alpha (fully opaque)
        }
    
        // Draw the ImageData to the canvas
        ctx.putImageData(this.imageData, 0, 0);
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