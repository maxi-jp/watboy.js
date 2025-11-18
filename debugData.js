
const debugData = {
    serial: null,
    registers: {
        a: null,
        b: null,
        c: null,
        d: null,
        e: null,
        f: null,
        h: null,
        l: null,
        sp: null,
        pc: null,
    },
    flags: {
        ie: null
    },
    lastInstruction: null
}

function InitDebugData() {
    // get html debug element references
    debugData.serial = document.querySelector('#serial > span');
    for (const prop in debugData.registers) {
        debugData.registers[prop] = document.getElementById(`reg_${prop}`);
    }
    for (const prop in debugData.flags) {
        debugData.flags[prop] = document.getElementById(`flags_${prop}`);
    }
    debugData.lastInstruction = document.getElementById('last_inst');
}

function updateDebugData() {
    if (gameboy.cpu.serialBuffer !== '') {
        if (debugData.serial.innerText !== gameboy.cpu.serialBuffer)
            debugData.serial.classList.add('red');
        else
            debugData.serial.classList.remove('red');
        debugData.serial.innerText = gameboy.cpu.serialBuffer;
    }
    else if (debugData.serial.classList.contains('red'))
        debugData.serial.classList.remove('red');

    for (const prop in debugData.registers) {
        const val = gameboy.cpu.registers[prop.toUpperCase()];
        const newStr = `0x${val.toString(16)} (${val})`;

        if (debugData.registers[prop].innerText !== newStr)
            debugData.registers[prop].classList.add('red');
        else
            debugData.registers[prop].classList.remove('red');
        
        debugData.registers[prop].innerText = newStr;
    }
    
    debugData.flags.ie.innerText = gameboy.cpu.interruptsEnabled;
    
    const newOpcode = `${gameboy.cpu.lastOpcodeHandlerName} (0x${gameboy.cpu.memory[gameboy.cpu.registers.lastPC].toString(16)})`;
    if (debugData.lastInstruction.innerText !== newOpcode)
        debugData.lastInstruction.classList.add('red');
    else
        debugData.lastInstruction.classList.remove('red');
    debugData.lastInstruction.innerText = newOpcode;
}

window.addEventListener('load', InitDebugData);