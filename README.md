# watboy.js
A work-in-progress Game Boy (DMG-01) emulator written in vanilla JavaScript.

Test it on https://maxi-jp.github.io/watboy.js/

## Features

*   **CPU:** Fairly accurate Sharp LR35902 (DMG-CPU) core.
    *   Passes many of Blargg's CPU instruction test ROMs.
    *   Handles Timer and V-Blank interrupts.
*   **PPU (GPU):** Emulates the Picture Processing Unit.
    *   Renders background, window, and sprites.
    *   Correctly follows PPU mode timings (H-Blank, V-Blank, OAM-Scan, Drawing).
    *   Switchable color palettes.
*   **Audio Processing Unit (APU) support:** experimental audio playback.
*   **Cartridge Support:**
    *   ROM-only cartridges.
    *   MBC1 (Memory Bank Controller 1) cartridges.
*   **Debugging:**
    *   Live register and memory value display.
    *   Serial port output for test ROMs.

## How to Use

1.  Open `index.html` in a modern web browser.
2.  Use the "Choose File" button to select a Game Boy ROM file (`.gb`).
3.  The game should start automatically.

## TODO

-   [ ] Better audio suppor.
-   [ ] Gamepad input mapping.
-   [ ] Support for more advanced Memory Bank Controllers (MBC3, MBC5).
-   [ ] Save data (SRAM) persistence.
-   [ ] Save states (snapshots) and rewind functionality.