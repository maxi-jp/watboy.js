class APU {
    constructor(cpu) {
        this.cpu = cpu;
        this.audioContext = null;
        this.scriptNode = null;

        this.frameSequencerClock = 0;
        this.frameSequencerStep = 0;

        // Add a check to resume audio context on user interaction
        document.addEventListener('click', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }, { once: true });
    }

    Initialize() {
        if (this.audioContext)
            return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        
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

    ProcessAudio(audioProcessingEvent) {
        // The output buffer to be filled
        const outputBuffer = audioProcessingEvent.outputBuffer.getChannelData(0);

        for (let i = 0; i < outputBuffer.length; i++) {
            // Get sample from each channel
            const ch1_sample = this.channel1.GetSample();
            const ch2_sample = this.channel2.GetSample();

            // Mix samples. Divide by 4 to prevent clipping.
            const mixedSample = (ch1_sample + ch2_sample) / 4.0;

            outputBuffer[i] = mixedSample;

            // Advance Channel State for the next sample
            // Channel 1 Phase
            if (this.channel1.enabled) {
                const freq = 131072 / (2048 - this.channel1.frequency);
                const samplesPerCycle = this.sampleRate / freq;
                const samplesPerPhase = samplesPerCycle / 8; // 8 steps in a duty cycle
                this.channel1.phase = (this.channel1.phase + (1 / samplesPerPhase)) % 8;
            }
            // Channel 2 Phase
            if (this.channel2.enabled) {
                const freq = 131072 / (2048 - this.channel2.frequency);
                const samplesPerCycle = this.sampleRate / freq;
                const samplesPerPhase = samplesPerCycle / 8; // 8 steps in a duty cycle
                this.channel2.phase = (this.channel2.phase + (1 / samplesPerPhase)) % 8;
            }
            // TODO advance other channels...
        }
    }

    Update(cycles) {
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

        // Master sound control
        if (address === 0xFF26) {
            if ((value & 0x80) === 0) this.StopAll();
        }
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
        const waveOutput = pattern[Math.floor(this.phase)];

        return waveOutput * (this.currentVolume / 15.0);
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
        const waveOutput = pattern[Math.floor(this.phase)];

        return waveOutput * (this.currentVolume / 15.0);
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
            else {
                // Stop envelope updates
                this.envelopePeriod = 0;
            }
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

        this.UpdateWaveform();
        this.SetVolume(this.volumeLevel);

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x04;
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x04;
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
            // If the channel is active, writing to the wave RAM can cause audio corruption
            // on real hardware. For simplicity, we'll just update the buffer.
            // A more accurate emulation might require more complex handling.
            this.UpdateWaveform();
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

        // Set channel ON flag in NR52
        this.cpu.memory[0xFF26] |= 0x08;
    }

    Stop() {
        this.enabled = false;
        // Clear channel ON flag in NR52
        this.cpu.memory[0xFF26] &= ~0x08;
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
            else {
                this.envelopePeriod = 0; // Stop envelope updates
            }
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
                if ((value >> 3) === 0) this.Stop();
                break;
            case 0xFF22: // NR43: Polynomial Counter (Frequency)
                // This register is complex. For simple white noise, lets just
                // roughly map the frequency settings to the playback rate.
                const clockShift = value >> 4;
                const divisorCode = value & 0x07;
                const divisor = [8, 16, 32, 48, 64, 80, 96, 112][divisorCode];
                const freq = 4194304 / (divisor << clockShift);
                break;
            case 0xFF23: // NR44: Counter/consecutive; initial
                this.lengthEnabled = (value & 0x40) !== 0;
                if ((value & 0x80) !== 0)
                    this.Trigger();
                break;
        }
    }
}
