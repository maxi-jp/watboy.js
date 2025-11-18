class APU {
    constructor(cpu) {
        this.cpu = cpu;
        this.audioContext = null;
        this.scriptNode = null;
        this.enabled = true; // Audio enabled by default

        this.frameSequencerClock = 0;
        this.frameSequencerStep = 0;

        // Master volume and panning
        this.leftVolume = 7;
        this.rightVolume = 7;
        this.vinLeft = false;
        this.vinRight = false;
        this.soundPanning = 0xFF;

        // Sample buffering for proper timing
        this.sampleBuffer = [];
        this.sampleClock = 0;
        this.samplesPerCycle = 0; // Will be calculated based on sample rate

        // Add a check to resume audio context on user interaction
        document.addEventListener('click', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }, { once: true });
    }

    Initialize() {
        if (this.audioContext || !this.enabled)
            return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        
        // Calculate how many samples we need per CPU cycle
        // Game Boy CPU runs at 4.194304 MHz
        this.samplesPerCycle = this.sampleRate / 4194304;
        
        // Buffer size of 4096 is a good balance between latency and performance
        this.scriptNode = this.audioContext.createScriptProcessor(4096, 0, 1);
        this.scriptNode.onaudioprocess = this.ProcessAudio.bind(this);

        // Channels 1 & 2: Use an OscillatorNode with type 'square' to generate the sound.
        // Use a GainNode to control the volume. The volume envelope is implemented by
        // changing gainNode.gain.value over time. The frequency sweep is implemented by
        // changing oscillatorNode.frequency.value over time.
        this.channel1 = new Channel1(this.audioContext, this.cpu);
        this.channel2 = new Channel2(this.audioContext, this.cpu);
        // Channel 3: Use an AudioBuffer to store the 32-sample waveform. An AudioBufferSourceNode
        // plays this buffer in a loop. The frequency is controlled by changing the playbackRate
        // of the source node.
        this.channel3 = new Channel3(this.audioContext, this.cpu);
        // Channel 4: The most accurate way is to use an AudioWorkletNode to generate the noise 
        // according to the Game Boy's algorithm. A simpler starting point is to create an
        // AudioBuffer filled with white noise and play it back with an AudioBufferSourceNode
        this.channel4 = new Channel4(this.audioContext, this.cpu);

        this.scriptNode.connect(this.audioContext.destination);
    }

    SetEnabled(enabled) {
        this.enabled = enabled;
        
        if (!enabled) {
            // Disable audio
            if (this.scriptNode && this.audioContext) {
                this.scriptNode.disconnect();
            }
            if (this.audioContext) {
                this.audioContext.suspend();
            }
        }
        else {
            // Enable audio
            if (this.audioContext) {
                this.audioContext.resume();
                if (this.scriptNode) {
                    this.scriptNode.connect(this.audioContext.destination);
                }
            }
            else {
                // Initialize audio if not already done
                this.Initialize();
            }
        }
    }

    ProcessAudio(audioProcessingEvent) {
        // The output buffer to be filled
        const outputBuffer = audioProcessingEvent.outputBuffer.getChannelData(0);

        for (let i = 0; i < outputBuffer.length; i++) {
            // If we have buffered samples, use them
            if (this.sampleBuffer.length > 0) {
                outputBuffer[i] = this.sampleBuffer.shift();
            } else {
                // No samples available - output silence
                outputBuffer[i] = 0;
            }
        }
    }

    // Generate a single audio sample at the current moment
    GenerateSample() {
        // Get sample from each channel
        const ch1_sample = this.channel1.GetSample();
        const ch2_sample = this.channel2.GetSample();
        const ch3_sample = this.channel3.GetSample();
        const ch4_sample = this.channel4.GetSample();

        // Apply master volume (for now, just use right volume for mono output)
        const masterVolume = this.rightVolume / 7.0;
        
        // Mix samples and apply master volume
        const mixedSample = (ch1_sample + ch2_sample + ch3_sample + ch4_sample) * masterVolume / 4.0;

        return Math.max(-1.0, Math.min(1.0, mixedSample)); // Clamp to prevent distortion
    }

    WriteRegister(address, value) {
        // This is where you'll delegate writes to the correct channel
        // For example:
        if (address >= 0xFF10 && address <= 0xFF14) {
            this.channel1.WriteRegister(address, value);
        }
    }

    AdvanceChannelPhases() {
        // Channel 1 Phase - Fixed increment per sample
        if (this.channel1.enabled && this.channel1.frequency > 0 && this.channel1.frequency < 2048) {
            const gbFreq = 131072 / (2048 - this.channel1.frequency);
            const phaseIncrement = (gbFreq * 8) / this.sampleRate; // 8 duty cycle steps
            this.channel1.phase = (this.channel1.phase + phaseIncrement) % 8;
        }
        
        // Channel 2 Phase - Fixed increment per sample
        if (this.channel2.enabled && this.channel2.frequency > 0 && this.channel2.frequency < 2048) {
            const gbFreq = 131072 / (2048 - this.channel2.frequency);
            const phaseIncrement = (gbFreq * 8) / this.sampleRate; // 8 duty cycle steps
            this.channel2.phase = (this.channel2.phase + phaseIncrement) % 8;
        }

        // Channel 3 Phase - Fixed increment per sample
        if (this.channel3.enabled && this.channel3.frequency > 0 && this.channel3.frequency < 2048) {
            const gbFreq = 131072 / (2048 - this.channel3.frequency);
            const phaseIncrement = (gbFreq * 32) / this.sampleRate; // 32 wave samples
            this.channel3.phase = (this.channel3.phase + phaseIncrement) % 32;
        }

        // Channel 4 Phase (noise) - More controlled advancement
        if (this.channel4.enabled) {
            this.channel4.AdvanceNoise();
        }
    }

    Update(cycles) {
        // Skip all audio processing if audio is disabled
        if (!this.enabled) {
            return;
        }

        // Update each channel's internal timing first
        this.channel1.UpdateTiming(cycles);
        this.channel2.UpdateTiming(cycles);
        this.channel3.UpdateTiming(cycles);
        this.channel4.UpdateTiming(cycles);

        // Generate audio samples based on cycles
        this.sampleClock += cycles * this.samplesPerCycle;
        
        // Generate samples for each whole sample period that has passed
        while (this.sampleClock >= 1.0) {
            this.sampleClock -= 1.0;
            
            // Generate and buffer the sample (channels handle their own phase advancement)
            const sample = this.GenerateSample();
            this.sampleBuffer.push(sample);
            
            // Limit buffer size to prevent memory issues
            if (this.sampleBuffer.length > 8192) {
                this.sampleBuffer.shift(); // Remove oldest sample
            }
        }

        // The Frame Sequencer runs at 512 Hz.
        // The CPU clock is 4194304 Hz.
        // So, the sequencer ticks every 4194304 / 512 = 8192 cycles.
        this.frameSequencerClock += cycles;
        while (this.frameSequencerClock >= 8192) {
            this.frameSequencerClock -= 8192;

            // Step 0, 2, 4, 6: Length counters
            if (this.frameSequencerStep % 2 === 0) {
                this.channel1.UpdateLength();
                this.channel2.UpdateLength();
                this.channel3.UpdateLength();
                this.channel4.UpdateLength();
            }
            // Step 7: Volume envelopes
            if (this.frameSequencerStep === 7) {
                this.channel1.UpdateEnvelope();
                this.channel2.UpdateEnvelope();
                this.channel4.UpdateEnvelope();
            }
            // Step 2, 6: Sweep
            if (this.frameSequencerStep === 2 || this.frameSequencerStep === 6) {
                this.channel1.UpdateSweep();
            }

            this.frameSequencerStep = (this.frameSequencerStep + 1) % 8;
        }
    }

    WriteRegister(address, value) {
        // This is where you'll delegate writes to the correct channel
        // For example:
        if (address >= 0xFF10 && address <= 0xFF14) {
            this.channel1.WriteRegister(address, value);
        }
        if (address >= 0xFF16 && address <= 0xFF19) {
            this.channel2.WriteRegister(address, value);
        }
        // Channel 3 registers (including wave RAM)
        if ((address >= 0xFF1A && address <= 0xFF1E) || (address >= 0xFF30 && address <= 0xFF3F)) {
            this.channel3.WriteRegister(address, value);
        }
        // Channel 4 registers
        if (address >= 0xFF20 && address <= 0xFF23) {
            this.channel4.WriteRegister(address, value);
        }

        // Master volume and mixing control
        if (address === 0xFF24) { // NR50: Master Volume & VIN Panning
            this.leftVolume = (value >> 4) & 0x07;
            this.rightVolume = value & 0x07;
            this.vinLeft = (value & 0x80) !== 0;
            this.vinRight = (value & 0x40) !== 0;
        }

        if (address === 0xFF25) { // NR51: Sound Panning
            this.soundPanning = value;
        }

        // Master sound control
        if (address === 0xFF26) {
            if ((value & 0x80) === 0)
                this.StopAll();
        }
    }

    StopAll() {
        this.channel1.Stop();
        this.channel2.Stop();
        this.channel3.Stop();
        this.channel4.Stop();
    }
}

class Channel1 {
    constructor(audioContext, cpu) {
        this.audioContext = audioContext;
        this.cpu = cpu;
        this.enabled = false;

        // Channel properties
        this.lengthCounter = 0;
        this.lengthEnabled = false;

        this.initialVolume = 0;
        this.currentVolume = 0;
        this.envelopeDirection = -1;
        this.envelopePeriod = 0;
        this.envelopeCounter = 0;

        this.frequency = 0;
        this.shadowFrequency = 0;

        // Sweep properties
        this.sweepPeriod = 0;
        this.sweepDirection = 1; // 1 for addition, -1 for subtraction
        this.sweepShift = 0;
        this.sweepCounter = 0;
        this.sweepEnabled = false;

        this.phase = 0;
        this.dutyCycle = 0;

        // Internal timing
        this.timingCounter = 0;

        // Duty cycle patterns for the square wave
        this.dutyPatterns = [
            [0, 1, 1, 1, 1, 1, 1, 1], // 12.5%
            [0, 0, 1, 1, 1, 1, 1, 1], // 25%
            [0, 0, 0, 0, 1, 1, 1, 1], // 50%
            [0, 0, 0, 0, 0, 0, 1, 1]  // 75%
        ];
    }

    Trigger() {
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64;
        }

        this.currentVolume = this.initialVolume;
        this.envelopeCounter = this.envelopePeriod;
        this.phase = 0;

        // Sweep initialization
        this.shadowFrequency = this.frequency;
        this.sweepCounter = this.sweepPeriod;
        this.sweepEnabled = this.sweepPeriod > 0 || this.sweepShift > 0;

        // Initial sweep calculation and overflow check
        if (this.sweepShift > 0) {
            this.CalculateSweep(true); // Check for overflow without updating frequency
        }

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x01;
    }

    GetSample() {
        if (!this.enabled) {
            return 0;
        }

        const pattern = this.dutyPatterns[this.dutyCycle];
        const phaseIndex = Math.floor(this.phase) % 8;
        const waveOutput = pattern[phaseIndex];

        // Add slight smoothing to reduce harshness
        const volume = this.currentVolume / 15.0;
        return waveOutput * volume * 0.8; // Slightly reduce amplitude to prevent harsh square waves
    }

    UpdateTiming(cycles) {
        if (!this.enabled || this.frequency === 0 || this.frequency >= 2048) return;

        // Game Boy frequency formula: freq = 131072 / (2048 - frequency)
        const gbFreq = 131072 / (2048 - this.frequency);
        const cyclesPerStep = 4194304 / (gbFreq * 8); // 8 steps per cycle

        this.timingCounter += cycles;
        while (this.timingCounter >= cyclesPerStep) {
            this.timingCounter -= cyclesPerStep;
            this.phase = (this.phase + 1) % 8;
        }
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x01;
    }

    UpdateLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.Stop();
            }
        }
    }

    UpdateEnvelope() {
        if (this.envelopePeriod === 0)
            return;

        this.envelopeCounter--;
        
        if (this.envelopeCounter <= 0) {
            this.envelopeCounter = this.envelopePeriod;
            const newVolume = this.currentVolume + this.envelopeDirection;
            if (newVolume >= 0 && newVolume <= 15) {
                this.currentVolume = newVolume;
            }
        }
    }

    UpdateSweep() {
        if (!this.sweepEnabled)
            return;

        this.sweepCounter--;
        if (this.sweepCounter <= 0) {
            this.sweepCounter = this.sweepPeriod === 0 ? 8 : this.sweepPeriod;

            if (this.sweepPeriod > 0) {
                const newFreq = this.CalculateSweep(false);
                if (newFreq <= 2047 && this.sweepShift > 0) {
                    this.frequency = newFreq;
                    this.shadowFrequency = newFreq;
                    this.cpu.memory[0xFF13] = newFreq & 0xFF;
                    this.cpu.memory[0xFF14] = (this.cpu.memory[0xFF14] & 0xF8) | (newFreq >> 8);
                    this.CalculateSweep(true); // Final overflow check
                }
            }
        }
    }

    CalculateSweep(checkOnly) {
        let newFreq = this.shadowFrequency >> this.sweepShift;
        if (this.sweepDirection === -1) {
            newFreq = this.shadowFrequency - newFreq;
        }
        else {
            newFreq = this.shadowFrequency + newFreq;
        }

        if (newFreq > 2047 && !checkOnly) {
            this.Stop();
        }

        return newFreq;
    }

    WriteRegister(address, value) {
        switch (address) {
            case 0xFF10: // NR10: Sweep
                this.sweepPeriod = (value >> 4) & 0x07;
                this.sweepDirection = (value & 0x08) ? -1 : 1;
                this.sweepShift = value & 0x07;
                break;
            case 0xFF11: // NR11: Length and Duty
                this.lengthCounter = 64 - (value & 0x3F);
                this.dutyCycle = (value >> 6) & 0x03;
                break;
            case 0xFF12: // NR12: Volume Envelope
                this.initialVolume = value >> 4;
                this.envelopeDirection = (value & 0x08) ? 1 : -1;
                this.envelopePeriod = value & 0x07;
                if ((value >> 3) === 0)
                    this.Stop();
                break;
            case 0xFF13: // NR13: Frequency LSB
                this.frequency = (this.frequency & 0xFF00) | value;
                break;
            case 0xFF14: // NR14: Frequency MSB and Control
                this.frequency = (this.frequency & 0x00FF) | ((value & 0x07) << 8);
                this.lengthEnabled = (value & 0x40) !== 0;
                if ((value & 0x80) !== 0)
                    this.Trigger();
                break;
        }
    }
}

class Channel2 {
    constructor(audioContext, cpu) {
        this.audioContext = audioContext;
        this.cpu = cpu;
        this.enabled = false;

        // Channel properties
        this.lengthCounter = 0;
        this.lengthEnabled = false;

        this.initialVolume = 0;
        this.currentVolume = 0;
        this.envelopeDirection = -1;
        this.envelopePeriod = 0;
        this.envelopeCounter = 0;

        this.frequency = 0;
        this.phase = 0;
        this.dutyCycle = 0;

        // Internal timing
        this.timingCounter = 0;

        // Duty cycle patterns for the square wave
        this.dutyPatterns = [
            [0, 1, 1, 1, 1, 1, 1, 1], // 12.5%
            [0, 0, 1, 1, 1, 1, 1, 1], // 25%
            [0, 0, 0, 0, 1, 1, 1, 1], // 50%
            [0, 0, 0, 0, 0, 0, 1, 1]  // 75%
        ];
    }

    Trigger() {
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64;
        }

        this.currentVolume = this.initialVolume;
        this.envelopeCounter = this.envelopePeriod;
        this.phase = 0;

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x02;
    }

    GetSample() {
        if (!this.enabled) {
            return 0;
        }

        const pattern = this.dutyPatterns[this.dutyCycle];
        const phaseIndex = Math.floor(this.phase) % 8;
        const waveOutput = pattern[phaseIndex];

        // Add slight smoothing to reduce harshness
        const volume = this.currentVolume / 15.0;
        return waveOutput * volume * 0.8; // Slightly reduce amplitude to prevent harsh square waves
    }

    UpdateTiming(cycles) {
        if (!this.enabled || this.frequency === 0 || this.frequency >= 2048) return;

        // Game Boy frequency formula: freq = 131072 / (2048 - frequency)
        const gbFreq = 131072 / (2048 - this.frequency);
        const cyclesPerStep = 4194304 / (gbFreq * 8); // 8 steps per cycle

        this.timingCounter += cycles;
        while (this.timingCounter >= cyclesPerStep) {
            this.timingCounter -= cyclesPerStep;
            this.phase = (this.phase + 1) % 8;
        }
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x02;
    }

    UpdateLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.Stop();
            }
        }
    }

    UpdateEnvelope() {
        if (this.envelopePeriod === 0) {
            return;
        }

        this.envelopeCounter--;
        if (this.envelopeCounter <= 0) {
            this.envelopeCounter = this.envelopePeriod;

            const newVolume = this.currentVolume + this.envelopeDirection;
            if (newVolume >= 0 && newVolume <= 15) {
                this.currentVolume = newVolume;
            }
            // Note: Don't disable envelope updates when hitting bounds
            // Game Boy continues to run envelope even at min/max volume
        }
    }

    WriteRegister(address, value) {
        switch (address) {
            case 0xFF16: // NR21: Length and Duty
                this.lengthCounter = 64 - (value & 0x3F);
                this.dutyCycle = (value >> 6) & 0x03;
                break;
            case 0xFF17: // NR22: Volume Envelope
                this.initialVolume = value >> 4;
                this.envelopeDirection = (value & 0x08) ? 1 : -1;
                this.envelopePeriod = value & 0x07;
                // If DAC is off, channel is disabled
                if ((value >> 3) === 0)
                    this.Stop();
                break;
            case 0xFF18: // NR23: Frequency LSB
                this.frequency = (this.frequency & 0xFF00) | value;
                break;
            case 0xFF19: // NR24: Frequency MSB and Control
                this.frequency = (this.frequency & 0x00FF) | ((value & 0x07) << 8);
                this.lengthEnabled = (value & 0x40) !== 0;
                if ((value & 0x80) !== 0) {
                    this.Trigger();
                }
                break;
        }
    }
}

class Channel3 {
    constructor(audioContext, cpu) {
        this.audioContext = audioContext;
        this.cpu = cpu;
        this.enabled = false;

        // Channel properties
        this.lengthCounter = 0;
        this.lengthEnabled = false;

        this.volumeLevel = 0; // 0-3
        this.frequency = 0;
        this.phase = 0;
        this.gain = 0;

        // Internal timing
        this.timingCounter = 0;
    }

    Trigger() {
        if ((this.cpu.memory[0xFF1A] & 0x80) === 0) { // DAC check
            this.Stop();
            return;
        }
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 256;
        }

        this.phase = 0;
        this.SetVolume(this.volumeLevel);

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x04;
    }

    GetSample() {
        if (!this.enabled) {
            return 0;
        }

        // Read from wave RAM
        const waveIndex = Math.floor(this.phase / 2); // Each byte contains 2 samples
        const waveByte = this.cpu.memory[0xFF30 + waveIndex];
        
        // Get the correct nibble (high nibble first, then low nibble)
        const nibbleIndex = Math.floor(this.phase) % 2;
        const sample4bit = nibbleIndex === 0 ? (waveByte >> 4) & 0x0F : waveByte & 0x0F;
        
        // Convert 4-bit sample (0-15) to float (-1.0 to 1.0) and apply volume
        const normalizedSample = (sample4bit / 7.5) - 1.0;
        return normalizedSample * this.gain;
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x04;
    }

    UpdateTiming(cycles) {
        if (!this.enabled || this.frequency === 0 || this.frequency >= 2048) return;

        // Game Boy frequency formula: freq = 131072 / (2048 - frequency)
        const gbFreq = 131072 / (2048 - this.frequency);
        const cyclesPerStep = 4194304 / (gbFreq * 32); // 32 samples per cycle

        this.timingCounter += cycles;
        while (this.timingCounter >= cyclesPerStep) {
            this.timingCounter -= cyclesPerStep;
            this.phase = (this.phase + 1) % 32;
        }
    }

    UpdateLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.Stop();
            }
        }
    }

    SetVolume(level) {
        this.volumeLevel = level;
        switch (level) {
            case 0: this.gain = 0.0;  break; // Mute
            case 1: this.gain = 1.0;  break; // 100%
            case 2: this.gain = 0.5;  break; // 50%
            case 3: this.gain = 0.25; break; // 25%
        }
    }

    UpdateWaveform() {
        // We'll read from memory directly during sample generation
        // This method is now just a placeholder or can be removed.
        for (let i = 0; i < 16; i++) {
            const byte = this.cpu.memory[0xFF30 + i];
            // High nibble first, then low nibble
            const sample1 = (byte >> 4) & 0x0F;
            const sample2 = byte & 0x0F;

            // Convert 4-bit sample (0-15) to float (-1.0 to 1.0)
        }
    }

    WriteRegister(address, value) {
        switch (address) {
            case 0xFF1A: // NR30: DAC Power
                if ((value & 0x80) === 0) this.Stop();
                break;
            case 0xFF1B: // NR31: Length
                this.lengthCounter = 256 - value;
                break;
            case 0xFF1C: // NR32: Volume
                this.SetVolume((value >> 5) & 0x03);
                break;
            case 0xFF1D: // NR33: Frequency LSB
                this.frequency = (this.frequency & 0xFF00) | value;
                break;
            case 0xFF1E: // NR34: Frequency MSB and Control
                this.frequency = (this.frequency & 0x00FF) | ((value & 0x07) << 8);
                this.lengthEnabled = (value & 0x40) !== 0;
                if ((value & 0x80) !== 0)
                    this.Trigger();
                break;
        }

        // Handle writes to Wave Pattern RAM
        if (address >= 0xFF30 && address <= 0xFF3F) {
            // Writing to wave RAM while channel is active can cause corruption
            // For now, we'll allow the write - the GetSample method reads directly from memory
            // A more accurate implementation might need to handle this differently
        }
    }
}

class Channel4 {
    constructor(audioContext, cpu) {
        this.audioContext = audioContext;
        this.cpu = cpu;
        this.enabled = false;

        // Channel properties
        this.lengthCounter = 0;
        this.lengthEnabled = false;

        this.initialVolume = 0;
        this.currentVolume = 0;
        this.envelopeDirection = -1;
        this.envelopePeriod = 0;
        this.envelopeCounter = 0;

        // Noise generation
        this.lfsr = 0x7FFF; // 15-bit Linear Feedback Shift Register
        this.clockShift = 0;
        this.widthMode = 0; // 0 = 15-bit, 1 = 7-bit
        this.divisorCode = 0;
        this.sampleCounter = 0;
        this.samplePeriod = 1;
    }

    Trigger() {
        if ((this.cpu.memory[0xFF21] >> 3) === 0) { // DAC check
            this.Stop();
            return;
        }
        this.enabled = true;
        if (this.lengthCounter === 0) {
            this.lengthCounter = 64;
        }

        this.currentVolume = this.initialVolume;
        this.envelopeCounter = this.envelopePeriod;
        this.lfsr = 0x7FFF; // Reset LFSR
        this.sampleCounter = 0;

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x08;
    }

    GetSample() {
        if (!this.enabled) {
            return 0;
        }

        // Get current noise bit (bit 0 of LFSR determines output)
        const output = (this.lfsr & 1) ? 1 : -1;
        return output * (this.currentVolume / 15.0);
    }

    AdvanceNoise() {
        // More consistent timing for noise generation
        if (this.samplePeriod <= 0) return;
        
        this.sampleCounter -= 1;
        if (this.sampleCounter <= 0) {
            this.sampleCounter = this.samplePeriod;
            
            // Advance LFSR
            const bit0 = this.lfsr & 1;
            const bit1 = (this.lfsr >> 1) & 1;
            const result = bit0 ^ bit1;
            
            this.lfsr >>= 1;
            
            if (this.widthMode === 0) {
                // 15-bit mode
                this.lfsr |= result << 14;
            }
            else {
                // 7-bit mode
                this.lfsr &= 0x7F;
                this.lfsr |= result << 6;
            }
        }
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x08;
    }

    UpdateTiming(cycles) {
        // For Channel 4, we advance noise during each CPU cycle update
        for (let i = 0; i < cycles; i++) {
            if (this.enabled) {
                this.AdvanceNoise();
            }
        }
    }

    UpdateLength() {
        if (this.lengthEnabled && this.lengthCounter > 0) {
            this.lengthCounter--;
            if (this.lengthCounter === 0) {
                this.Stop();
            }
        }
    }

    UpdateEnvelope() {
        if (this.envelopePeriod === 0)
            return;

        this.envelopeCounter--;
        if (this.envelopeCounter <= 0) {
            this.envelopeCounter = this.envelopePeriod;
            const newVolume = this.currentVolume + this.envelopeDirection;
            if (newVolume >= 0 && newVolume <= 15) {
                this.currentVolume = newVolume;
            }
            // Note: Don't disable envelope updates when hitting bounds
            // Game Boy continues to run envelope even at min/max volume
        }
    }

    WriteRegister(address, value) {
        switch (address) {
            case 0xFF20: // NR41: Length
                this.lengthCounter = 64 - (value & 0x3F);
                break;
            case 0xFF21: // NR42: Volume Envelope
                this.initialVolume = value >> 4;
                this.envelopeDirection = (value & 0x08) ? 1 : -1;
                this.envelopePeriod = value & 0x07;
                if ((value >> 3) === 0)
                    this.Stop();
                break;
            case 0xFF22: // NR43: Polynomial Counter (Frequency)
                this.clockShift = value >> 4;
                this.widthMode = (value >> 3) & 1;
                this.divisorCode = value & 0x07;
                
                // Calculate sample period for noise generation
                const divisors = [8, 16, 32, 48, 64, 80, 96, 112];
                const divisor = divisors[this.divisorCode];
                const gbNoiseFreq = 4194304 / (divisor << this.clockShift);
                
                // Convert to audio sample rate timing - make it more stable
                this.samplePeriod = Math.max(1, Math.round(this.cpu.apu.sampleRate / gbNoiseFreq));
                break;
            case 0xFF23: // NR44: Counter/consecutive; initial
                this.lengthEnabled = (value & 0x40) !== 0;
                if ((value & 0x80) !== 0)
                    this.Trigger();
                break;
        }
    }
}
