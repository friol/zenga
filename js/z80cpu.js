
/* 

    The Z80 

    Z80 has a lot of different opcodes, with zero, one or two bytes prefixes:
    - 0xcb prefix (bit instructions)
    - 0xdd prefix (IX instructions)
    - 0xddcb prefix (IX bit instructions)
    - 0xed prefix (misc instructions)
    - 0xfd prefix (IY instructions)
    - 0xfdcb prefix (IY bit instructions) 

    We're assuming we are always in interrupt mode 1 (SMS should use only that one).

*/

const z80flags = 
{
    FLAG_C: 0x01,
    FLAG_N: 0x02,
    FLAG_PV: 0x04,
    FLAG_F3: 0x08,
    FLAG_H: 0x10,
    FLAG_F5: 0x20,
    FLAG_Z: 0x40,
    FLAG_S: 0x80
};

class z80cpu
{
    constructor(theMMU)
    {
        // Clock rate: 3.579545 MHz (NTSC)
        this.clockRate=3579545;

        this.theMMU=theMMU;

        this.registers = 
        { 
            a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, f: 0, 
            ixh: 0, ixl: 0, iyh: 0, iyl: 0,
            pc: 0, sp: 0xdff0, r: 0, i:0
        };
    
        this.shadowRegisters = 
        { 
            a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, f: 0 
        };

        this.maskableInterruptsEnabled = false;
        this.maskableInterruptWaiting = false;        
        this.interruptMode = 0;

        this.totCycles=0;

        this.parityLookUp=[];
        this.buildParityLookUp();

        this.unprefixedOpcodes=new Array();
        for (var op=0;op<256;op++) this.unprefixedOpcodes.push(undefined);
        this.prefixcbOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixcbOpcodes.push(undefined);
        this.prefixddOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixddOpcodes.push(undefined);
        this.prefixddcbOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixddcbOpcodes.push(undefined);
        this.prefixedOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixedOpcodes.push(undefined);
        this.prefixfdOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixfdOpcodes.push(undefined);
        this.prefixfdcbOpcodes=new Array();
        for (var op=0;op<256;op++) this.prefixfdcbOpcodes.push(undefined);

        this.initUnprefixedTable();
        this.initEdTable();
        this.initCbTable();
        this.initFdTable();
        this.initFdCbTable();
        this.initDdTable();
        this.initDdCbTable();

        var unprefOpcodesCount=this.countOpcodes(this.unprefixedOpcodes);
        var edOpcodesCount=this.countOpcodes(this.prefixedOpcodes);
        var cbOpcodesCount=this.countOpcodes(this.prefixcbOpcodes);
        var fdOpcodesCount=this.countOpcodes(this.prefixfdOpcodes);
        var fdcbOpcodesCount=this.countOpcodes(this.prefixfdcbOpcodes);
        var ddOpcodesCount=this.countOpcodes(this.prefixddOpcodes);
        var ddcbOpcodesCount=this.countOpcodes(this.prefixddcbOpcodes);
        var totalOpcodes=unprefOpcodesCount+edOpcodesCount+cbOpcodesCount+fdOpcodesCount+ddOpcodesCount+ddcbOpcodesCount+fdcbOpcodesCount;

        console.log("CPU::Inited");
        console.log("Unprefixed: "+unprefOpcodesCount+
                    " - ED: "+edOpcodesCount+
                    " - CB: "+cbOpcodesCount+
                    " - FD: "+fdOpcodesCount+
                    " - DD: "+ddOpcodesCount+
                    " - DDCB: "+ddcbOpcodesCount+
                    " - FDCB: "+fdcbOpcodesCount+
                    " - total opcodes: "+totalOpcodes
                    );
    }

    countOpcodes(arr)
    {
        var cnt=0;
        for (var o=0;o<arr.length;o++)
        {
            if (arr[o]!=undefined)
            {
                cnt++;
            }
        }
        return cnt;
    }

    raiseMaskableInterrupt()
    {
        if (this.maskableInterruptsEnabled)
        {
            this.maskableInterruptWaiting=true;
        }
    }

    buildParityLookUp()
    {
		for (let i = 0; i <= 0xff; i++) 
        {
			let bitCount = 0;
			for (let j = 0; j < 8; j++) 
            {
				if ((i & (1 << j)) != 0) 
                {
					bitCount++;
				}
			}

			this.parityLookUp[i] = bitCount % 2 == 0;
		}
	}

    incPc(n) 
    { 
        this.registers.pc+=n; 
        this.registers.pc &= 0xffff; 
    }

    jumpRel(n)
    {
        if ((n&0x80)==0x80) 
        {
            this.registers.pc+=-0x80 + (n&0x7F);
        }
        else this.registers.pc+=n;
        this.registers.pc&=0xffff;
    }

    rlc_8bit(v) 
    {
		let bit7Set = (v & 0x80) > 0;

		let newValue = (v << 1) & 0xff;
		if (bit7Set) {
			newValue |= 0x01;
		}

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit7Set) {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    adc_16bit(v1, v2) 
    {
		let v3 = (this.registers.f & z80flags.FLAG_C) ? 1: 0;
		let rawNewValue = v1 + v2 + v3;
		let newValue = rawNewValue & 0xffff;

		// Reset the flags.
		this.registers.f = 0;

		// C: set if the result is greater than 0xffff.
		if (rawNewValue > 0xffff) {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: reset.

		// P/V: Set if the two's compliment addition overflowed.
		if ((v1 & 0x8000) == (v2 & 0x8000) && (v1 & 0x8000) != (newValue & 0x8000)) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: preserved.

		// H: Set if the first 4 bits of the high byte addition resulted in a carry.
		if ((v1 & 0x0fff) + (v2 & 0x0fff) + v3 > 0x0fff) {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: preserved

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x8000) {
			this.registers.f |= z80flags.FLAG_S;
		}

        return newValue;
	}

    daa_8bit(v) 
    {
		let correctionFactor = 0;
		let carryFlagWasSet = (this.registers.f & z80flags.FLAG_C) > 0;
		let halfCarryFlagWasSet = (this.registers.f & z80flags.FLAG_H) > 0;
		let subtractionFlagWasSet = (this.registers.f & z80flags.FLAG_N) > 0;

		// Reset the flags (preserve N).
		this.registers.f &= 0x02;

		if (v > 0x99 || carryFlagWasSet) {
			correctionFactor |= 0x60;
			this.registers.f |= z80flags.FLAG_C;
		}

		if ((v & 0x0f) > 9 || halfCarryFlagWasSet) {
			correctionFactor |= 0x06;
		}

		let newValue = v;

		if (!subtractionFlagWasSet) {
			newValue += correctionFactor;
		} else {
			newValue -= correctionFactor;
		}

		newValue &= 0xff;

		if ((v & 0x10) ^ (newValue & 0x10)) {
			this.registers.f |= z80flags.FLAG_H;
		}

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset.

		// F5: Reset.

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    sbc_8bit(v1, v2) 
    {
		let v3 = (this.registers.f & z80flags.FLAG_C) ? 1 : 0;
		let rawNewValue = v1 - v2 - v3;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if the result is negative..		
		if (rawNewValue < 0) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Set if the two's compliment subtraction overflowed.
		if ((v1 & 0x80) != (v2 & 0x80) && (v1 & 0x80) != (newValue & 0x80)) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset

		// H: Set if the first 4 bits of the subtraction resulted in a borrow.
		if ((v1 & 0x0f) - (v2 & 0x0f) - v3 < 0) {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Reset

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    rr_8bit(v) 
    {
		let bit0Set = (v & 0x01) > 0;

		let newValue = (v >> 1) & 0xff;
		if (this.registers.f & z80flags.FLAG_C) 
        {
			newValue |= 0x80;
		}

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit0Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    srl_8bit(v) 
    {
		let bit0Set = (v & 0x01) > 0;
		let newValue = (v >> 1) & 0xff;

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit0Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    rl_8bit(v) 
    {
		let bit7Set = (v & 0x80) > 0;

		let newValue = (v << 1) & 0xff;
		if (this.registers.f & z80flags.FLAG_C) 
        {
			newValue |= 0x01;
		}

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit7Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    sbc_16bit(v1, v2) 
    {
		let v3 = (this.registers.f & z80flags.FLAG_C) ? 1 : 0;
		let rawNewValue = v1 - v2 - v3;
		let newValue = rawNewValue & 0xffff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if the result is negative
		if (rawNewValue < 0) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Set if the two's compliment subtraction overflowed.
		if ((v1 & 0x8000) != (v2 & 0x8000) && (v1 & 0x8000) != (newValue & 0x8000)) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset

		// H: Set if the first 4 bits of the high byte subtraction resulted in a borrow.
		if ((v1 & 0x0fff) - (v2 & 0x0fff) - v3 < 0) 
        {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Reset

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (newValue & 0x8000) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    rra_8bit(v) 
    {
		let bit0Set = (v & 0x01) > 0;
		let carryFlagSet = (this.registers.f & z80flags.FLAG_C) > 0;

		let newValue = (v >> 1) & 0xff;
		if (carryFlagSet) 
        {
			newValue |= 0x80;
		}

		// Reset the flags.
		this.registers.f &= 0xc4;

		// C: Set if bit 0 of the input is set.
		if (bit0Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Preserved.

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

		return newValue;
	}

    adc_8bit(v1, v2) 
    {
		let v3 = (this.registers.f & z80flags.FLAG_C) ? 1: 0;
		let rawNewValue = v1 + v2 + v3;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if the result is greater than 0xff.
		if (rawNewValue > 0xff) {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: reset.

		// P/V: Set if the two's compliment addition overflowed.
		if ((v1 & 0x80) == (v2 & 0x80) && (v1 & 0x80) != (newValue & 0x80)) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset

		// H: Set if the first 4 bits of the addition resulted in a carry.
		if ((v1 & 0x0f) + (v2 & 0x0f) + v3 > 0x0f) {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Reset

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    rl_8bit(v) 
    {
		let bit7Set = (v & 0x80) > 0;

		let newValue = (v << 1) & 0xff;
		if (this.registers.f & z80flags.FLAG_C) 
        {
			newValue |= 0x01;
		}

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit7Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    rrc_8bit(v) 
    {
		let bit0Set = (v & 0x01) > 0;

		let newValue = (v >> 1) & 0xff;
		if (bit0Set) 
        {
			newValue |= 0x80;
		}

		// Reset the flags.
		this.registers.f = 0x00;

		// C: Set if bit 7 of the input is set.
		if (bit0Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;	
	}

    rlca_8bit(v) 
    {
		let bit7Set = (v & 0x80) > 0;

		let newValue = (v << 1) & 0xff;
		if (bit7Set) 
        {
			newValue |= 0x01;
		}

		// Reset the flags.
		this.registers.f &= 0xc4;

		// C: Set if bit 7 of the input is set.
		if (bit7Set) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Preserved.

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

		return newValue;
	}

    add_8bit(v1, v2) 
    {
		let rawNewValue = v1 + v2;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if the result is greater than 0xff.
		if (rawNewValue > 0xff) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: reset.

		// P/V: Set if the two's compliment addition overflowed.
		if ((v1 & 0x80) == (v2 & 0x80) && (v1 & 0x80) != (newValue & 0x80)) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset

		// H: Set if the first 4 bits of the addition resulted in a carry.
		if ((v1 & 0x0f) + (v2 & 0x0f) > 0x0f) 
        {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Reset

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    sra_8bit(v) 
    {
		let newValue = (v >> 1) & 0xff;
		if (v & 0x80) 
        {
			newValue |= 0x80;
		}

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if bit 0 of the input is set.
		if (v & 0x01) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}    

    sla_8bit(v) 
    {
		let newValue = (v << 1) & 0xff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if bit 7 of the input is set.
		if (v & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    bit_8bit(v, bitMask) 
    {
		let bitSet = (v & bitMask) != 0;

		// Reset the flags.
		this.registers.f &= 0x01;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if bit not set.
		if (!bitSet) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset.

		// H: Set.
		this.registers.f |= z80flags.FLAG_H;

		// F5: Reset.

		// Z: Set if bit not set.
		if (!bitSet) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if bit number is 7 and bit 7 is set.
		if (bitMask == 0x80 && (v & 0x80)) {
			this.registers.f |= z80flags.FLAG_S;
		}
	}

    inc_8bit(v) 
    {
		// Increment and mask back to 8 bits.
		let newValue = (v + 1) & 0xff;

		// Reset the flags.
		this.registers.f &= 0x01; 

		// C: Preserved.

		// N: Reset.

		// P/V: Set if the two's compliment addition overflowed.
		if ((v & 0x80) == 0 && (newValue & 0x80)) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Set if the first 4 bits of the addition resulted in a carry.
		if ((v & 0x0f) + 1 > 0x0f) 
        {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}

    dec_8bit(v) 
    {
        var newValue=(v-1)&0xff;

        this.registers.f&=0x01; 

        // N: Set.
        this.registers.f |= z80flags.FLAG_N;

        // P/V: Set if the two's compliment subtraction overflowed.
        if ((v & 0x80) && (newValue & 0x80) == 0) 
        {
            this.registers.f |= z80flags.FLAG_PV;
        }

        // F3: Set if bit 3 of the result is set.
        if (newValue & 0x08) 
        {
            this.registers.f |= z80flags.FLAG_F3;
        }

        // H: Set if the first 4 bits of the subtraction resulted in a borrow.
        if ((v & 0x0f) - 1 < 0) 
        {
            this.registers.f |= z80flags.FLAG_H;
        }

        // F5: Set if bit 5 of the test byte is set.
        if (newValue & 0x20) 
        {
            this.registers.f |= z80flags.FLAG_F5;
        }

        // Z: Set if the value is zero.
        if (newValue == 0) 
        {
            this.registers.f |= z80flags.FLAG_Z;
        }

        // S: Set if the twos-compliment value is negative.
        if (newValue & 0x80) 
        {
            this.registers.f |= z80flags.FLAG_S;
        }        

        return newValue;
    }

    sub_8bit(v1, v2) 
    {
		let rawNewValue = v1 - v2;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f = 0;

		// C: Set if the result is negative
		if (rawNewValue < 0) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Set if the two's compliment subtraction overflowed.
		if ((v1 & 0x80) != (v2 & 0x80) && (v1 & 0x80) != (newValue & 0x80)) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (newValue & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Set if the first 4 bits of the subtraction resulted in a borrow.
		if ((v1 & 0x0f) - (v2 & 0x0f) < 0) 
        {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: Set if bit 5 of the test byte is set.
		if (newValue & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}    

    or_8bit(v1, v2) 
    {
		let newValue = v1 | v2;

		// Reset the flags.
		this.registers.f = 0;

		// C: Reset.

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset.

		// H: Reset.

		// F5: Reset.

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}    

    xor_8bit(v1, v2) 
    {
		let newValue = v1 ^ v2;

		// Reset the flags.
		this.registers.f = 0;

		// C: Reset.

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset.

		// H: Reset.

		// F5: Reset.

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}    

    cpl_8bit(v) 
    {
		v ^= 0xff;

		// C: Preserved.

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Preserved.

		// F3: Preserved.

		// H: Set.
		this.registers.f |= z80flags.FLAG_H;

		// F5: Preserved.

		// Z: Preserved.

		// S: Preserved.

		return v;
	}    

    add_16bit(v1, v2) 
    {
		let rawNewValue = v1 + v2;
		let newValue = rawNewValue & 0xffff;

		// Reset the flags.
		this.registers.f &= 0xec;

		// C: set if the result is greater than 0xffff.
		if (rawNewValue > 0xffff) 
        {
			this.registers.f |= z80flags.FLAG_C;
		}

		// N: reset.

		// P/V: preserved.

		// F3: preserved.

		// H: Set if the first 4 bits of the high byte addition resulted in a carry.
		if ((v1 & 0x0fff) + (v2 & 0x0fff) > 0x0fff) 
        {
			this.registers.f |= z80flags.FLAG_H;
		}

		// F5: preserved

		// Z: preserved.

		// S: preserved.

		return newValue;
	}    

    and_8bit(v1, v2) 
    {
		let newValue = v1 & v2;

		// Reset the flags.
		this.registers.f = 0;

		// C: Reset.

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[newValue]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Reset.

		// H: Set.
		this.registers.f |= z80flags.FLAG_H;

		// F5: Reset.

		// Z: Set if the value is zero.
		if (newValue == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
	}    

    popWord() 
    {
		let word = this.theMMU.readAddr16bit(this.registers.sp);

        this.registers.sp+=2;
        this.registers.sp&=0xffff;

		return word;
	}

    pushWord(word)
    {
        this.registers.sp-=2;
        this.registers.sp&=0xffff;
        this.theMMU.writeAddr16bit(this.registers.sp,word);
    }

    executeCpir() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);

        hl=hl+1; hl&=0xffff;
        bc=bc-1; bc&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		let v1 = this.registers.a;
		let v2 = byte;
		let rawNewValue = v1 - v2;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f &= 0x01;

		// H: Set if the first 4 bits of the subtraction resulted in a borrow.
		if ((v1 & 0x0f) - (v2 & 0x0f) < 0) {
			this.registers.f |= z80flags.FLAG_H;
		}

		let testByte = (this.registers.a - byte - ((this.registers.f & z80flags.FLAG_H) ? 1 : 0)) & 0xff;

		// C: Preserved.

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Set if BC is not 0.
		if (bc != 0) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of (A - (HL) - H) is set.
		if (testByte & 0x04) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// F5: Set if bit 1 of (A - (HL) - H) is set.
		if (testByte & 0x02) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

		if (bc != 0 && (this.registers.f & z80flags.FLAG_Z) == 0) 
        {
			//return 21;
		} 
        else 
        {
            this.incPc(2);
			//return 16;
		}
	}

	executeOutIncrementRepeat() 
    {
        // the most complex instruction in the world with a funny name
        // TODO: handle cycles count properly

		this.registers.r+=2;
        this.registers.r&=0xff;

		let hl = this.registers.l|(this.registers.h<<8);

		let byte = this.theMMU.readAddr(hl);

        this.theMMU.writePort(this.registers.c,byte);

        hl+=1; hl&=0xffff;
        this.registers.l=hl&0xff;
        this.registers.h=(hl>>8)&0xff;

		this.registers.b = this.dec_8bit(this.registers.b);

		if (this.registers.b > 0) 
        {
			//return 21;
		} 
        else 
        {
            this.incPc(2);
			//return 16;
		}
	}    

    executeLoadIncrementRepeat() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let de = this.registers.e|(this.registers.d<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);;
        this.theMMU.writeAddr(de,byte);

        hl=hl+1; hl&=0xffff;
        de=de+1; de&=0xffff;
        bc=bc-1; bc&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.e=de&0xff; this.registers.d=de>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		this.registers.f &= 0xc1;

		let testByte = (byte + this.registers.a) & 0xff;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if BC is not 0.
		if (bc > 0) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the test byte is set.
		if (testByte & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 1 of the test byte is set.
		if (testByte & 0x02) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

        // TODO: variable number of cycles
		if (bc>0) 
        {
		}
        else
        {
            this.incPc(2);
        }
	}    

    executeLoadDecrementRepeat() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let de = this.registers.e|(this.registers.d<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);;
        this.theMMU.writeAddr(de,byte);

        hl=hl-1; hl&=0xffff;
        de=de-1; de&=0xffff;
        bc=bc-1; bc&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.e=de&0xff; this.registers.d=de>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		this.registers.f &= 0xc1;

		let testByte = (byte + this.registers.a) & 0xff;

		// C: Preserved.

		// N: Reset.
		if (bc > 0) {
			this.registers.f |= z80flags.FLAG_N;
		}

		// P/V: Reset.

		// F3: Set if bit 3 of the test byte is set.
		if (testByte & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 1 of the test byte is set.
		if (testByte & 0x02) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

        // TODO 21/16 cycles
		if (bc > 0) 
        {
			//dec2_pc();
			//return 21;
		} 
        else 
        {
            this.incPc(2);
			//return 16;
		}
	}

    executeLoadDecrement() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let de = this.registers.e|(this.registers.d<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);;
        this.theMMU.writeAddr(de,byte);

        hl=hl-1; hl&=0xffff;
        de=de-1; de&=0xffff;
        bc=bc-1; bc&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.e=de&0xff; this.registers.d=de>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		this.registers.f &= 0xc1;

		let testByte = (byte + this.registers.a) & 0xff;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if BC is not 0.
		if (bc > 0) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the test byte is set.
		if (testByte & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 1 of the test byte is set.
		if (testByte & 0x02) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

        this.incPc(2);
	}

    executeCpi() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);

        hl=hl+1; hl&=0xffff;
        bc=bc-1; bc&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		let v1 = this.registers.a;
		let v2 = byte;
		let rawNewValue = v1 - v2;
		let newValue = rawNewValue & 0xff;

		// Reset the flags.
		this.registers.f &= 0x01;

		// H: Set if the first 4 bits of the subtraction resulted in a borrow.
		if ((v1 & 0x0f) - (v2 & 0x0f) < 0) {
			this.registers.f |= z80flags.FLAG_H;
		}

		let testByte = (this.registers.a - byte - ((this.registers.f & z80flags.FLAG_H) ? 1 : 0)) & 0xff;

		// C: Preserved.

		// N: Set.
		this.registers.f |= z80flags.FLAG_N;

		// P/V: Set if BC is not 0.
		if (bc != 0) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of (A - (HL) - H) is set.
		if (testByte & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// F5: Set if bit 1 of (A - (HL) - H) is set.
		if (testByte & 0x02) {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (newValue == 0) {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (newValue & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}

        this.incPc(2);
	}    

    executeOuti() 
    {
		let hl = this.registers.l|(this.registers.h<<8);

		let byte = this.theMMU.readAddr(hl);
		this.theMMU.writePort(this.registers.c,byte);

        hl=hl+1; hl&=0xffff;
        this.registers.l=hl&0xff; this.registers.h=hl>>8;

		this.registers.b = this.dec_8bit(this.registers.b);

        this.incPc(2);
	}    

    executeRld() 
    {
		let address = this.registers.l|(this.registers.h<<8);
		let byte = this.theMMU.readAddr(address);

		let nibble0 = (this.registers.a & 0x0f);
		let nibble1 = (byte & 0xf0) >> 4;
		let nibble2 = (byte & 0x0f);

		this.registers.a = (this.registers.a & 0xf0) | nibble1;
		byte = (nibble2 << 4) | nibble0;

        this.theMMU.writeAddr16bit(address, byte);

		// Reset the flags.
		this.registers.f &= 0x01;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[this.registers.a]) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (this.registers.a & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (this.registers.a & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (this.registers.a == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (this.registers.a & 0x80) {
			this.registers.f |= z80flags.FLAG_S;
		}
	}

    executeRrd() 
    {
		let address = this.registers.l|(this.registers.h<<8);
		let byte = this.theMMU.readAddr(address);

		let nibble0 = (this.registers.a & 0x0f);
		let nibble1 = (byte & 0xf0) >> 4;
		let nibble2 = (byte & 0x0f);

		this.registers.a = (this.registers.a & 0xf0) | nibble2;
		byte = (nibble0 << 4) | nibble1;

        this.theMMU.writeAddr(address,byte);

		// Reset the flags.
		this.registers.f &= 0x01;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if new value has even number of set bits.
		if (this.parityLookUp[this.registers.a]) {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the result is set.
		if (this.registers.a & 0x08) {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 5 of the test byte is set.
		if (this.registers.a & 0x20) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Set if the value is zero.
		if (this.registers.a == 0) 
        {
			this.registers.f |= z80flags.FLAG_Z;
		}

		// S: If the twos-compliment value is negative, set the negative flag.
		if (this.registers.a & 0x80) 
        {
			this.registers.f |= z80flags.FLAG_S;
		}
	}

    executeLdi() 
    {
		let hl = this.registers.l|(this.registers.h<<8);
		let de = this.registers.e|(this.registers.d<<8);
		let bc = this.registers.c|(this.registers.b<<8);

		let byte = this.theMMU.readAddr(hl);
        this.theMMU.writeAddr(de,byte);

        hl=hl+1; hl&=0xffff;
        de=de+1; de&=0xffff;
        bc=bc-1; de&=0xffff;

        this.registers.l=hl&0xff; this.registers.h=hl>>8;
        this.registers.e=de&0xff; this.registers.d=de>>8;
        this.registers.c=bc&0xff; this.registers.b=bc>>8;

		this.registers.f &= 0xc1;

		let testByte = (byte + this.registers.a) & 0xff;

		// C: Preserved.

		// N: Reset.

		// P/V: Set if BC is not 0.
		if (bc > 0) 
        {
			this.registers.f |= z80flags.FLAG_PV;
		}

		// F3: Set if bit 3 of the test byte is set.
		if (testByte & 0x08) 
        {
			this.registers.f |= z80flags.FLAG_F3;
		}

		// H: Reset.

		// F5: Set if bit 1 of the test byte is set.
		if (testByte & 0x02) 
        {
			this.registers.f |= z80flags.FLAG_F5;
		}

		// Z: Preserved.

		// S: Preserved.

        this.incPc(2);
	}

    // tables structure:
    // execution function, debug string, cycles, num of additional bytes, undocumented true/false

    initUnprefixedTable()
    {
        let self = this;

        this.unprefixedOpcodes[0x00]=[function() { self.incPc(1); }, "NOP", 4, 0, false];
        this.unprefixedOpcodes[0x01]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1); 
            var m2=self.theMMU.readAddr(self.registers.pc+2); 
            self.registers.b=m2; 
            self.registers.c=m1; 
            self.incPc(3); 
        }, "LD BC,%d", 10, 2, false];

        this.unprefixedOpcodes[0x02]=[function()
        {
            var bc=self.registers.c|(self.registers.b<<8);
            self.theMMU.writeAddr(bc,self.registers.a);
            self.incPc(1); 
        }, "LD (BC),A",7,0, false];
    
        this.unprefixedOpcodes[0x03]=[function()
        {
            var bc=self.registers.c|(self.registers.b<<8);
            bc+=1; bc&=0xffff;
            self.registers.c=bc&0xff;
            self.registers.b=(bc>>8)&0xff;
            self.incPc(1);
        }, "INC BC", 6, 0, false];
    
        this.unprefixedOpcodes[0x04]=[function() { self.registers.b=self.inc_8bit(self.registers.b); self.incPc(1); }, "INC B", 4, 0, false];
        this.unprefixedOpcodes[0x05]=[function() { self.registers.b=self.dec_8bit(self.registers.b); self.incPc(1); }, "DEC B", 4, 0, false];
        this.unprefixedOpcodes[0x06]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.b=m1; self.incPc(2); }, "LD B,%d", 7, 1, false];
        this.unprefixedOpcodes[0x07]=[function()
        { 
            self.registers.a = self.rlca_8bit(self.registers.a);
            self.incPc(1); 
        }, "RLCA", 4, 0, false];
        
        this.unprefixedOpcodes[0x08]=[function()
        { 
            var tmp=self.registers.a;
            self.registers.a=self.shadowRegisters.a;
            self.shadowRegisters.a=tmp;

            tmp=self.registers.f;
            self.registers.f=self.shadowRegisters.f;
            self.shadowRegisters.f=tmp;

            self.incPc(1); 
        }, "XCHG AF,AF'", 4, 0, false];

        this.unprefixedOpcodes[0x09]=[function() 
        { 
            var hl=self.registers.l|(self.registers.h<<8);
            var bc=self.registers.c|(self.registers.b<<8);
            hl=self.add_16bit(hl,bc);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(1); 
        }, "ADD HL,BC", 11, 0, false];

        this.unprefixedOpcodes[0xa]=[function()
        {
            const bc=self.registers.c|(self.registers.b<<8);
            self.registers.a=self.theMMU.readAddr(bc);
            self.incPc(1); 
        }, "LD A,(BC)",7, 0, false];
    
        this.unprefixedOpcodes[0x0b]=[function()
        {
            var bc=self.registers.c|(self.registers.b<<8);
            bc-=1; bc&=0xffff;
            self.registers.c=bc&0xff;
            self.registers.b=(bc>>8)&0xff;
            self.incPc(1);
        }, "DEC BC", 6, 0, false];

        this.unprefixedOpcodes[0x0c]=[function() { self.registers.c=self.inc_8bit(self.registers.c); self.incPc(1); }, "INC C", 4, 0, false];
        this.unprefixedOpcodes[0x0d]=[function() { self.registers.c=self.dec_8bit(self.registers.c); self.incPc(1); }, "DEC C", 4, 0, false];
        this.unprefixedOpcodes[0x0e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.c=m1; self.incPc(2); }, "LD C,%d", 7, 1, false];
        this.unprefixedOpcodes[0x0f]=[function()
        { 
            self.registers.a = self.rrc_8bit(self.registers.a);            
            self.incPc(1); 
        }, "RRCA", 4, 0, false];

        this.unprefixedOpcodes[0x10]=[function()
        {  
            // TODO 8/13 cycles
            self.registers.b--; self.registers.b &= 0xff;
    
            var jq=self.theMMU.readAddr(self.registers.pc+1);
            
            self.incPc(2);
            if (self.registers.b != 0) 
            {
                self.jumpRel(jq); 
                //return 13;
            } 
            else 
            {
                //return 8;
            }
        }, "DJNZ %d", 8, 1, false];

        this.unprefixedOpcodes[0x11]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.d=m2;
            self.registers.e=m1;
            self.incPc(3); 
        }, "LD DE,%d",10, 2, false];

        this.unprefixedOpcodes[0x12]=[function()
        {
            var de=self.registers.e|(self.registers.d<<8);
            self.theMMU.writeAddr(de,self.registers.a);
            self.incPc(1); 
        }, "LD (DE),A",7,0, false];
    
        this.unprefixedOpcodes[0x13]=[function()
        {
            var de=self.registers.e|(self.registers.d<<8);
            de+=1; de&=0xffff;
            self.registers.e=de&0xff;
            self.registers.d=(de>>8)&0xff;
            self.incPc(1);
        }, "INC DE", 6, 0, false];

        this.unprefixedOpcodes[0x14]=[function() { self.registers.d=self.inc_8bit(self.registers.d); self.incPc(1); }, "INC D", 4, 0, false];
        this.unprefixedOpcodes[0x15]=[function() { self.registers.d=self.dec_8bit(self.registers.d); self.incPc(1); }, "DEC D", 4, 0, false];
        
        this.unprefixedOpcodes[0x17]=[function() 
        { 
            self.registers.a = self.rl_8bit(self.registers.a);
            self.incPc(1); 
        }, "RLA", 4, 0, false];

        this.unprefixedOpcodes[0x16]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.d=m1; 
            self.incPc(2); 
        }, "LD D,%d", 7, 1, false];
   

        this.unprefixedOpcodes[0x18]=[function() { var jq=self.theMMU.readAddr(self.registers.pc+1); self.incPc(2); self.jumpRel(jq); }, "JR %d", 12, 1, false];
        this.unprefixedOpcodes[0x19]=[function() 
        { 
            var hl=self.registers.l|(self.registers.h<<8);
            var de=self.registers.e|(self.registers.d<<8);
            hl=self.add_16bit(hl,de);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(1); 
        }, "ADD HL,DE", 11, 0, false];

        this.unprefixedOpcodes[0x1a]=[function()
        {
            const addr=self.registers.e|(self.registers.d<<8);
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(1); 
        }, "LD A,(DE)",7, 0, false];

        this.unprefixedOpcodes[0x1b]=[function()
        {
            var de=self.registers.e|(self.registers.d<<8);
            de-=1; de&=0xffff;
            self.registers.e=de&0xff;
            self.registers.d=(de>>8)&0xff;
            self.incPc(1);
        }, "DEC DE", 6, 0, false];
    
        this.unprefixedOpcodes[0x1c]=[function() { self.registers.e=self.inc_8bit(self.registers.e); self.incPc(1); }, "INC E", 4, 0, false];
        this.unprefixedOpcodes[0x1d]=[function() { self.registers.e=self.dec_8bit(self.registers.e); self.incPc(1); }, "DEC E", 4, 0, false];

        this.unprefixedOpcodes[0x1e]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.e=m1; 
            self.incPc(2); 
        }, "LD E,%d", 7, 1, false];

        this.unprefixedOpcodes[0x1f]=[function()
        { 
            self.registers.a = self.rra_8bit(self.registers.a);
            self.incPc(1); 
        }, "RRA", 4, 0, false];
        
        this.unprefixedOpcodes[0x20]=[function() 
        { 
            // TODO 12/7 cycles (12 if jumped, 7 otherwise)
            var jq=self.theMMU.readAddr(self.registers.pc+1); 
            self.incPc(2); 
            if (!(self.registers.f&z80flags.FLAG_Z))
            {
                self.jumpRel(jq); 
            }
        }, "JR NZ,%d", 7, 1, false];
        this.unprefixedOpcodes[0x21]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.h=m2;
            self.registers.l=m1;
            self.incPc(3); 
        }, "LD HL,%d", 10, 2, false];
        this.unprefixedOpcodes[0x22]=[function()
        {
            var m1=self.theMMU.readAddr((self.registers.pc+1)&0xffff);
            var m2=self.theMMU.readAddr((self.registers.pc+2)&0xffff);
            var addr=(m2<<8)|m1;
            self.theMMU.writeAddr(addr,self.registers.l);
            self.theMMU.writeAddr(addr+1,self.registers.h);
            self.incPc(3);
        }, "LD (%d),HL", 16, 2, false];
        this.unprefixedOpcodes[0x23]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            hl+=1; hl&=0xffff;
            self.registers.l=hl&0xff;
            self.registers.h=(hl>>8)&0xff;
            self.incPc(1);
        }, "INC HL", 6, 0, false];

        this.unprefixedOpcodes[0x24]=[function() { self.registers.h=self.inc_8bit(self.registers.h); self.incPc(1); }, "INC H", 4, 0, false];

        this.unprefixedOpcodes[0x26]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.h=m1;
            self.incPc(2); 
        }, "LD H,%d", 7, 1, false];

        this.unprefixedOpcodes[0x27]=[function() { self.registers.a = self.daa_8bit(self.registers.a); self.incPc(1); }, "DAA", 4, 0, false];
        
        this.unprefixedOpcodes[0x28]=[function() 
        { 
            // TODO 12/7 cycles (12 if jumped, 7 otherwise)
            var jq=self.theMMU.readAddr(self.registers.pc+1); 
            self.incPc(2); 
            if (self.registers.f&z80flags.FLAG_Z)
            {
                self.jumpRel(jq); 
            }
        },
        "JR Z,%d", 7, 1, false];

        this.unprefixedOpcodes[0x29]=[function() 
        { 
            var hl=self.registers.l|(self.registers.h<<8);
            var bc=self.registers.c|(self.registers.b<<8);
            hl=self.add_16bit(hl,hl);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(1); 
        }, "ADD HL,HL", 11, 0, false];
    
        this.unprefixedOpcodes[0x2a]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            
            var addr=(m2<<8)|m1;
            const word=self.theMMU.readAddr16bit(addr);

            self.registers.h=word>>8;
            self.registers.l=word&0xff;

            self.incPc(3); 
        }, "LD HL,(%d)", 16, 2, false];

        this.unprefixedOpcodes[0x2b]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            hl-=1; hl&=0xffff;
            self.registers.l=hl&0xff;
            self.registers.h=(hl>>8)&0xff;
            self.incPc(1);
        }, "DEC HL", 6, 0, false];

        this.unprefixedOpcodes[0x2c]=[function() { self.registers.l=self.inc_8bit(self.registers.l); self.incPc(1); }, "INC L", 4, 0, false];
        
        this.unprefixedOpcodes[0x2e]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.l=m1;
            self.incPc(2);
        }, "LD L,%d", 7, 1, false];

        this.unprefixedOpcodes[0x2f]=[function()
        { 
            self.registers.a=self.cpl_8bit(self.registers.a);
            self.incPc(1); 
        }, "CPL", 4, 0, false];
        
        this.unprefixedOpcodes[0x30]=[function() 
        { 
            // TODO 12/7 cycles (12 if jumped, 7 otherwise)
            var jq=self.theMMU.readAddr(self.registers.pc+1); 
            self.incPc(2); 
            if (!(self.registers.f&z80flags.FLAG_C))
            {
                self.jumpRel(jq); 
            }
        },
        "JR NC,%d", 7, 1, false];
    
        this.unprefixedOpcodes[0x31]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.sp=(m2<<8)|m1;
            self.incPc(3); 
        }, "LD SP,%d", 10, 2, false];
        this.unprefixedOpcodes[0x32]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var addr=(m2<<8)|m1;
            self.theMMU.writeAddr(addr,self.registers.a);
            self.incPc(3); 
        }, "LD (%d),A", 13, 2, false];

        this.unprefixedOpcodes[0x33]=[function()
        {
            self.registers.sp+=1; self.registers.sp&=0xffff;
            self.incPc(1);
        }, "INC SP", 6, 0, false];
    
        this.unprefixedOpcodes[0x34]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            var b=self.theMMU.readAddr(hl);
            b=self.inc_8bit(b);
            self.theMMU.writeAddr(hl,b);
            self.incPc(1);
        }, "INC (HL)", 11, 0, false];

        this.unprefixedOpcodes[0x35]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            var b=self.theMMU.readAddr(hl);
            b=self.dec_8bit(b);
            self.theMMU.writeAddr(hl,b);
            self.incPc(1);
        }, "DEC (HL)", 11, 0, false];
            
        this.unprefixedOpcodes[0x36]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var addr=(self.registers.h<<8)|self.registers.l;
            self.theMMU.writeAddr(addr,m1);
            self.incPc(2); 
        }, "LD (HL),%d", 10, 1, false];

        this.unprefixedOpcodes[0x37]=[function() 
        { 
            self.registers.f &= 0xc4; 
            self.registers.f |= z80flags.FLAG_C;
            self.incPc(1); 
        }, "SCF", 4, 0, false];
            
        this.unprefixedOpcodes[0x38]=[function() 
        { 
            // TODO 12/7 cycles (12 if jumped, 7 otherwise)
            var jq=self.theMMU.readAddr(self.registers.pc+1); 
            self.incPc(2); 
            if (self.registers.f&z80flags.FLAG_C)
            {
                self.jumpRel(jq); 
            }
        },
        "JR C,%d", 7, 1, false];

        this.unprefixedOpcodes[0x39]=[function() 
        {
            var hl=self.registers.l|(self.registers.h<<8);
            var res=self.add_16bit(hl,self.registers.sp);
            self.registers.l=res&0xff;
            self.registers.h=res>>8;
            self.incPc(1); 
        }, "ADD HL,SP", 11, 0, false];
    
        this.unprefixedOpcodes[0x3a]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var addr=(m2<<8)|m1;
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(3); 
        }, "LD A,(%d)", 13, 2, false];

        this.unprefixedOpcodes[0x3b]=[function()
        {
            self.registers.sp-=1; self.registers.sp&=0xffff;
            self.incPc(1);
        }, "DEC SP", 6, 0, false];
    
        this.unprefixedOpcodes[0x3c]=[function() { self.registers.a=self.inc_8bit(self.registers.a); self.incPc(1); }, "INC A", 4, 0, false];
        this.unprefixedOpcodes[0x3d]=[function() { self.registers.a=self.dec_8bit(self.registers.a); self.incPc(1); }, "DEC A", 4, 0, false]; // the 3-D opcode
        this.unprefixedOpcodes[0x3e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.a=m1; self.incPc(2); }, "LD A,%d", 7, 1, false];
        this.unprefixedOpcodes[0x3f]=[function()
        { 
            let oldC = self.registers.f & z80flags.FLAG_C;

            self.registers.f &= 0xc4;
    
            if (!oldC) 
            {
                self.registers.f |= z80flags.FLAG_C;
            }
    
            if (oldC) 
            {
                self.registers.f |= z80flags.FLAG_H;
            }
            self.incPc(1); 
        }, "CCF", 4, 0, false];
        this.unprefixedOpcodes[0x41]=[function() { self.registers.b=self.registers.c; self.incPc(1); }, "LD B,C", 4, 0, false];
        this.unprefixedOpcodes[0x44]=[function() { self.registers.b=self.registers.h; self.incPc(1); }, "LD B,H", 4, 0, false];
        this.unprefixedOpcodes[0x45]=[function() { self.registers.b=self.registers.l; self.incPc(1); }, "LD B,L", 4, 0, false];

        this.unprefixedOpcodes[0x46]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.b=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD B,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x47]=[function() { self.registers.b=self.registers.a; self.incPc(1); }, "LD B,A", 4, 0, false];
        this.unprefixedOpcodes[0x48]=[function() { self.registers.c=self.registers.b; self.incPc(1); }, "LD C,B", 4, 0, false];
        this.unprefixedOpcodes[0x4a]=[function() { self.registers.c=self.registers.d; self.incPc(1); }, "LD C,D", 4, 0, false];
        this.unprefixedOpcodes[0x4b]=[function() { self.registers.c=self.registers.e; self.incPc(1); }, "LD C,E", 4, 0, false];
        this.unprefixedOpcodes[0x4c]=[function() { self.registers.c=self.registers.h; self.incPc(1); }, "LD C,H", 4, 0, false];
        this.unprefixedOpcodes[0x4d]=[function() { self.registers.c=self.registers.l; self.incPc(1); }, "LD C,L", 4, 0, false];

        this.unprefixedOpcodes[0x4e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.c=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD C,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x4f]=[function() { self.registers.c=self.registers.a; self.incPc(1); }, "LD C,A", 4, 0, false];
        this.unprefixedOpcodes[0x50]=[function() { self.registers.d=self.registers.b; self.incPc(1); }, "LD D,B", 4, 0, false];
        this.unprefixedOpcodes[0x51]=[function() { self.registers.d=self.registers.c; self.incPc(1); }, "LD D,C", 4, 0, false];
        this.unprefixedOpcodes[0x52]=[function() { self.registers.d=self.registers.d; self.incPc(1); }, "LD D,D", 4, 0, false];
        this.unprefixedOpcodes[0x53]=[function() { self.registers.d=self.registers.e; self.incPc(1); }, "LD D,E", 4, 0, false];
        this.unprefixedOpcodes[0x54]=[function() { self.registers.d=self.registers.h; self.incPc(1); }, "LD D,H", 4, 0, false];
        this.unprefixedOpcodes[0x55]=[function() { self.registers.d=self.registers.l; self.incPc(1); }, "LD D,L", 4, 0, false];

        this.unprefixedOpcodes[0x56]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.d=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD D,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x57]=[function() { self.registers.d=self.registers.a; self.incPc(1); }, "LD D,A", 4, 0, false];
        this.unprefixedOpcodes[0x58]=[function() { self.registers.e=self.registers.b; self.incPc(1); }, "LD E,B", 4, 0, false];
        this.unprefixedOpcodes[0x59]=[function() { self.registers.e=self.registers.c; self.incPc(1); }, "LD E,C", 4, 0, false];
        this.unprefixedOpcodes[0x5a]=[function() { self.registers.e=self.registers.d; self.incPc(1); }, "LD E,D", 4, 0, false];
        this.unprefixedOpcodes[0x5c]=[function() { self.registers.e=self.registers.h; self.incPc(1); }, "LD E,H", 4, 0, false];
        this.unprefixedOpcodes[0x5d]=[function() { self.registers.e=self.registers.l; self.incPc(1); }, "LD E,L", 4, 0, false];

        this.unprefixedOpcodes[0x5e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.e=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD E,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x5f]=[function() { self.registers.e=self.registers.a; self.incPc(1); }, "LD E,A", 4, 0, false];
        this.unprefixedOpcodes[0x60]=[function() { self.registers.h=self.registers.b; self.incPc(1); }, "LD H,B", 4, 0, false];
        this.unprefixedOpcodes[0x61]=[function() { self.registers.h=self.registers.c; self.incPc(1); }, "LD H,C", 4, 0, false];
        this.unprefixedOpcodes[0x62]=[function() { self.registers.h=self.registers.d; self.incPc(1); }, "LD H,D", 4, 0, false];
        this.unprefixedOpcodes[0x63]=[function() { self.registers.h=self.registers.e; self.incPc(1); }, "LD H,E", 4, 0, false];
        this.unprefixedOpcodes[0x64]=[function() { self.registers.h=self.registers.h; self.incPc(1); }, "LD H,H", 4, 0, false];
        this.unprefixedOpcodes[0x65]=[function() { self.registers.h=self.registers.l; self.incPc(1); }, "LD H,L", 4, 0, false];

        this.unprefixedOpcodes[0x66]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.h=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD H,(HL)",7, 0, false];

        this.unprefixedOpcodes[0x67]=[function() { self.registers.h=self.registers.a; self.incPc(1); }, "LD H,A", 4, 0, false];
        this.unprefixedOpcodes[0x69]=[function() { self.registers.l=self.registers.c; self.incPc(1); }, "LD L,C", 4, 0, false];
        this.unprefixedOpcodes[0x6a]=[function() { self.registers.l=self.registers.d; self.incPc(1); }, "LD L,D", 4, 0, false];
        this.unprefixedOpcodes[0x6b]=[function() { self.registers.l=self.registers.e; self.incPc(1); }, "LD L,E", 4, 0, false];
        this.unprefixedOpcodes[0x6c]=[function() { self.registers.l=self.registers.h; self.incPc(1); }, "LD L,H", 4, 0, false];

        this.unprefixedOpcodes[0x6e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.l=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD L,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x6f]=[function() { self.registers.l=self.registers.a; self.incPc(1); }, "LD L,A", 4, 0, false];
        this.unprefixedOpcodes[0x70]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.b);
            self.incPc(1);
        }, "LD (HL),B",7, 0, false];

        this.unprefixedOpcodes[0x71]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.c);
            self.incPc(1);
        }, "LD (HL),C",7, 0, false];
    
        this.unprefixedOpcodes[0x72]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.d);
            self.incPc(1);
        }, "LD (HL),D",7, 0, false];

        this.unprefixedOpcodes[0x73]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.e);
            self.incPc(1);
        }, "LD (HL),E",7, 0, false];

        this.unprefixedOpcodes[0x75]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.l);
            self.incPc(1);
        }, "LD (HL),L",7, 0, false];
            
        this.unprefixedOpcodes[0x77]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.a);
            self.incPc(1);
        }, "LD (HL),A",7, 0, false];
    
        this.unprefixedOpcodes[0x78]=[function() { self.registers.a=self.registers.b; self.incPc(1); }, "LD A,B", 4, 0, false];
        this.unprefixedOpcodes[0x79]=[function() { self.registers.a=self.registers.c; self.incPc(1); }, "LD A,C", 4, 0, false];
        this.unprefixedOpcodes[0x7a]=[function() { self.registers.a=self.registers.d; self.incPc(1); }, "LD A,D", 4, 0, false];
        this.unprefixedOpcodes[0x7b]=[function() { self.registers.a=self.registers.e; self.incPc(1); }, "LD A,E", 4, 0, false];
        this.unprefixedOpcodes[0x7c]=[function() { self.registers.a=self.registers.h; self.incPc(1); }, "LD A,H", 4, 0, false];
        this.unprefixedOpcodes[0x7d]=[function() { self.registers.a=self.registers.l; self.incPc(1); }, "LD A,L", 4, 0, false];

        this.unprefixedOpcodes[0x7e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD A,(HL)", 7, 0, false];

        this.unprefixedOpcodes[0x80]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.b); 
            self.incPc(1); 
        }, "ADD A,B", 4, 0, false];

        this.unprefixedOpcodes[0x81]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.c); 
            self.incPc(1); 
        }, "ADD A,C", 4, 0, false];
    
        this.unprefixedOpcodes[0x82]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.d); 
            self.incPc(1); 
        }, "ADD A,D", 4, 0, false];
    
        this.unprefixedOpcodes[0x83]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.e); 
            self.incPc(1); 
        }, "ADD A,E", 4, 0, false];
    
        this.unprefixedOpcodes[0x84]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.h); 
            self.incPc(1); 
        }, "ADD A,H", 4, 0, false];

        this.unprefixedOpcodes[0x85]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.l); 
            self.incPc(1); 
        }, "ADD A,L", 4, 0, false];

        this.unprefixedOpcodes[0x86]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            const val=self.theMMU.readAddr(addr);
            self.registers.a=self.add_8bit(self.registers.a,val); 
            self.incPc(1);
        }, "ADD A,(HL)", 7, 0, false];
            
        this.unprefixedOpcodes[0x87]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.a); 
            self.incPc(1); 
        }, "ADD A,A", 4, 0, false];

        this.unprefixedOpcodes[0x88]=[function()
        { 
            self.registers.a=self.adc_8bit(self.registers.a,self.registers.b); 
            self.incPc(1); 
        }, "ADC A,B", 4, 0, false];
    
        this.unprefixedOpcodes[0x89]=[function()
        { 
            self.registers.a=self.adc_8bit(self.registers.a,self.registers.c); 
            self.incPc(1); 
        }, "ADC A,C", 4, 0, false];

        this.unprefixedOpcodes[0x8a]=[function()
        { 
            self.registers.a=self.adc_8bit(self.registers.a,self.registers.d); 
            self.incPc(1); 
        }, "ADC A,D", 4, 0, false];
    
        this.unprefixedOpcodes[0x8c]=[function()
        { 
            self.registers.a=self.adc_8bit(self.registers.a,self.registers.h); 
            self.incPc(1); 
        }, "ADC A,H", 4, 0, false];
            
        this.unprefixedOpcodes[0x90]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        }, "SUB B", 4, 0, false];

        this.unprefixedOpcodes[0x91]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.c);
            self.incPc(1); 
        }, "SUB C", 4, 0, false];

        this.unprefixedOpcodes[0x92]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.d);
            self.incPc(1); 
        }, "SUB D", 4, 0, false];
    
        this.unprefixedOpcodes[0x93]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.e);
            self.incPc(1); 
        }, "SUB E", 4, 0, false];

        this.unprefixedOpcodes[0x94]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.h);
            self.incPc(1); 
        }, "SUB H", 4, 0, false];
            
        this.unprefixedOpcodes[0x95]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.l);
            self.incPc(1); 
        }, "SUB L", 4, 0, false];

        this.unprefixedOpcodes[0x96]=[function() 
        { 
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.registers.a=self.sub_8bit(self.registers.a,m1);
            self.incPc(1); 
        }, "SUB (HL)", 7, 0, false];
    
        this.unprefixedOpcodes[0x97]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.a);
            self.incPc(1); 
        }, "SUB A", 4, 0, false];

        this.unprefixedOpcodes[0x98]=[function()
        {
            self.registers.a = self.sbc_8bit(self.registers.a, self.registers.b);
            self.incPc(1);
        }, "SBC A,B", 4, 0, false];
            
        this.unprefixedOpcodes[0x9e]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            var m1=self.theMMU.readAddr(hl);
            self.registers.a = self.sbc_8bit(self.registers.a, m1);
            self.incPc(1);
        }, "SBC A,(HL)", 7, 0, false];

        this.unprefixedOpcodes[0x9f]=[function()
        {
            self.registers.a = self.sbc_8bit(self.registers.a, self.registers.a);
            self.incPc(1);
        }, "SBC A,A", 4, 0, false];
            
        this.unprefixedOpcodes[0xa0]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        },"AND B", 4, 0, false];

        this.unprefixedOpcodes[0xa1]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.c);
            self.incPc(1); 
        },"AND C", 4, 0, false];

        this.unprefixedOpcodes[0xa2]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.d);
            self.incPc(1); 
        },"AND D", 4, 0, false];

        this.unprefixedOpcodes[0xa3]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.e);
            self.incPc(1); 
        },"AND E", 4, 0, false];
            
        this.unprefixedOpcodes[0xa4]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.h);
            self.incPc(1); 
        },"AND H", 4, 0, false];

        this.unprefixedOpcodes[0xa6]=[function()
        { 
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.registers.a=self.and_8bit(self.registers.a,m1);
            self.incPc(1); 
        },"AND (HL)", 4, 0, false];
    
        this.unprefixedOpcodes[0xa7]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.a);
            self.incPc(1); 
        },"AND A", 4, 0, false];

        this.unprefixedOpcodes[0xa8]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.b);
            self.incPc(1);
        }, "XOR B", 4, 0, false];
            
        this.unprefixedOpcodes[0xa9]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.c);
            self.incPc(1);
        }, "XOR C", 4, 0, false];

        this.unprefixedOpcodes[0xaa]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.d);
            self.incPc(1);
        }, "XOR D", 4, 0, false];

        this.unprefixedOpcodes[0xab]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.e);
            self.incPc(1);
        }, "XOR E", 4, 0, false];

        this.unprefixedOpcodes[0xac]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.h);
            self.incPc(1);
        }, "XOR H", 4, 0, false];

        this.unprefixedOpcodes[0xad]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.l);
            self.incPc(1);
        }, "XOR L", 4, 0, false];
            
        this.unprefixedOpcodes[0xae]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.registers.a = self.xor_8bit(self.registers.a, m1);
            self.incPc(1);
        }, "XOR (HL)", 7, 0, false];
            
        this.unprefixedOpcodes[0xaf]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.a);
            self.incPc(1);
        }, "XOR A", 4, 0, false];
        this.unprefixedOpcodes[0xb0]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        }, "OR B", 4, 0, false];
        this.unprefixedOpcodes[0xb1]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.c);
            self.incPc(1); 
        }, "OR C", 4, 0, false];
        this.unprefixedOpcodes[0xb2]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.d);
            self.incPc(1); 
        }, "OR D", 4, 0, false];
        this.unprefixedOpcodes[0xb3]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.e);
            self.incPc(1); 
        }, "OR E", 4, 0, false];
        this.unprefixedOpcodes[0xb4]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.h);
            self.incPc(1); 
        }, "OR H", 4, 0, false];
        this.unprefixedOpcodes[0xb5]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.l);
            self.incPc(1); 
        }, "OR L", 4, 0, false];
        this.unprefixedOpcodes[0xb6]=[function()
        { 
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.registers.a=self.or_8bit(self.registers.a,m1);
            self.incPc(1); 
        }, "OR (HL)", 4, 0, false];
        this.unprefixedOpcodes[0xb7]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.a);
            self.incPc(1); 
        }, "OR A", 4, 0, false];

        this.unprefixedOpcodes[0xb8]=[function()
        {
            self.sub_8bit(self.registers.a,self.registers.b);
            self.incPc(1);
        }, "CP B", 4, 0, false];
    
        this.unprefixedOpcodes[0xb9]=[function()
        {
            self.sub_8bit(self.registers.a,self.registers.c);
            self.incPc(1);
        }, "CP C", 4, 0, false];

        this.unprefixedOpcodes[0xbb]=[function()
        {
            self.sub_8bit(self.registers.a,self.registers.e);
            self.incPc(1);
        }, "CP E", 4, 0, false];
    
        this.unprefixedOpcodes[0xbc]=[function()
        {
            self.sub_8bit(self.registers.a,self.registers.h);
            self.incPc(1);
        }, "CP H", 4, 0, false];
    
        this.unprefixedOpcodes[0xbd]=[function()
        {
            self.sub_8bit(self.registers.a,self.registers.l);
            self.incPc(1);
        }, "CP L", 4, 0, false];
            
        this.unprefixedOpcodes[0xbe]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.sub_8bit(self.registers.a,m1);
            self.incPc(1);
        }, "CP (HL)", 7, 0, false];

        this.unprefixedOpcodes[0xc0]=[function()
        {
            // TODO 11/5 cycles
            if (!(self.registers.f&z80flags.FLAG_Z))
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET NZ", 5, 0, false];
            
        this.unprefixedOpcodes[0xc1]=[function() { const bc=self.popWord(); self.registers.c=bc&0xff; self.registers.b=(bc>>8); self.incPc(1); },"POP BC", 10, 0, false];
        this.unprefixedOpcodes[0xc2]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (!(self.registers.f&z80flags.FLAG_Z))
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP NZ,%d", 10, 2, false];
        this.unprefixedOpcodes[0xc3]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.pc=(m2<<8)|m1;
        }, "JP %d", 10, 2, false];

        this.unprefixedOpcodes[0xc4]=[function()
        {
            // TODO 17/10 cycles
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            if (!(self.registers.f&z80flags.FLAG_Z))
            {
                self.pushWord(self.registers.pc+3);
                self.registers.pc=newaddr;
            }
            else
            {
                self.incPc(3);
            }
        }, "CALL NZ,%d", 10, 2, false];

        this.unprefixedOpcodes[0xc5]=[function() { const bc=self.registers.c|(self.registers.b<<8); self.pushWord(bc); self.incPc(1); },"PUSH BC", 11, 0, false];

        this.unprefixedOpcodes[0xc6]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.add_8bit(self.registers.a,m1); 
            self.incPc(2); 
        }, "ADD A,%d", 7, 1, false];
    
        this.unprefixedOpcodes[0xc8]=[function()
        {
            // TODO 11/5 cycles
            if (self.registers.f&z80flags.FLAG_Z)
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET Z", 5, 0, false];
    
        this.unprefixedOpcodes[0xc9]=[function()
        {
            self.registers.pc=self.popWord();
        }, "RET", 10, 0, false];

        this.unprefixedOpcodes[0xca]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (self.registers.f&z80flags.FLAG_Z)
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP Z,%d", 10, 2, false];

        this.unprefixedOpcodes[0xcc]=[function()
        {
            // TODO 17/10 cycles
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            if (self.registers.f&z80flags.FLAG_Z)
            {
                self.pushWord(self.registers.pc+3);
                self.registers.pc=newaddr;
            }
            else
            {
                self.incPc(3);
            }
        }, "CALL Z,%d", 10, 2, false];
            
        this.unprefixedOpcodes[0xcd]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            self.pushWord(self.registers.pc+3);
            self.registers.pc=newaddr;
        }, "CALL %d", 17, 2, false];
    
        this.unprefixedOpcodes[0xce]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.adc_8bit(self.registers.a,m1); 
            self.incPc(2); 
        }, "ADC A,%d", 7, 1, false];

        this.unprefixedOpcodes[0xcf]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x08;
        }, "RST 8h", 11, 0, false];

        this.unprefixedOpcodes[0xd0]=[function()
        {
            // TODO 11/5 cycles
            if (!(self.registers.f&z80flags.FLAG_C))
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET NC", 5, 0, false];
    
        this.unprefixedOpcodes[0xd1]=[function() { const de=self.popWord(); self.registers.e=de&0xff; self.registers.d=(de>>8); self.incPc(1); },"POP DE", 10, 0, false];

        this.unprefixedOpcodes[0xd2]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (!(self.registers.f&z80flags.FLAG_C))
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP NC,%d", 10, 2, false];
    
        this.unprefixedOpcodes[0xd3]=[function() { var port=self.theMMU.readAddr(self.registers.pc+1); self.theMMU.writePort(port,self.registers.a); self.incPc(2); }, "OUT (%d),A", 11, 1, false];

        this.unprefixedOpcodes[0xd4]=[function()
        {
            // TODO 17/10 cycles
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            if (!(self.registers.f&z80flags.FLAG_C))
            {
                self.pushWord(self.registers.pc+3);
                self.registers.pc=newaddr;
            }
            else
            {
                self.incPc(3);
            }
        }, "CALL NC,%d", 10, 2, false];
    
        this.unprefixedOpcodes[0xd5]=[function() { const de=self.registers.e|(self.registers.d<<8); self.pushWord(de); self.incPc(1); },"PUSH DE", 11, 0, false];
        this.unprefixedOpcodes[0xd6]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.sub_8bit(self.registers.a,m1);
            self.incPc(2); 
        }, "SUB %d", 7, 1, false];

        this.unprefixedOpcodes[0xd7]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x10;
        }, "RST 10h", 11, 0, false];

        this.unprefixedOpcodes[0xd8]=[function()
        {
            // TODO 11/5 cycles
            if (self.registers.f&z80flags.FLAG_C)
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET C", 5, 0, false];
    
        this.unprefixedOpcodes[0xd9]=[function()
        {
            var tmp=self.registers.b;
            self.registers.b=self.shadowRegisters.b;
            self.shadowRegisters.b=tmp;
            tmp=self.registers.c;
            self.registers.c=self.shadowRegisters.c;
            self.shadowRegisters.c=tmp;

            tmp=self.registers.d;
            self.registers.d=self.shadowRegisters.d;
            self.shadowRegisters.d=tmp;
            tmp=self.registers.e;
            self.registers.e=self.shadowRegisters.e;
            self.shadowRegisters.e=tmp;

            tmp=self.registers.h;
            self.registers.h=self.shadowRegisters.h;
            self.shadowRegisters.h=tmp;
            tmp=self.registers.l;
            self.registers.l=self.shadowRegisters.l;
            self.shadowRegisters.l=tmp;

            self.incPc(1); 
        }, "EXX", 4, 0, false];

        this.unprefixedOpcodes[0xda]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (self.registers.f&z80flags.FLAG_C)
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP C,%d", 10, 2, false];
            
        this.unprefixedOpcodes[0xdb]=[function() 
        { 
            var port=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.a=self.theMMU.readPort(port); 
            self.incPc(2); 
        }, "IN A,(%d)", 11, 1, false];

        this.unprefixedOpcodes[0xdc]=[function()
        {
            // TODO 17/10 cycles
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            if (self.registers.f&z80flags.FLAG_C)            
            {
                self.pushWord(self.registers.pc+3);
                self.registers.pc=newaddr;
            }
            else
            {
                self.incPc(3);                
            }
        }, "CALL C,%d", 10, 2, false];

        this.unprefixedOpcodes[0xde]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a = self.sbc_8bit(self.registers.a, m1);
            self.incPc(2);
        }, "SBC A,%d", 7, 0, false];
            
        this.unprefixedOpcodes[0xdf]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x18;
        }, "RST 18h", 11, 0, false];

        this.unprefixedOpcodes[0xe0]=[function()
        {
            // TODO 11/5 cycles
            if (!(self.registers.f&z80flags.FLAG_PV))
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET PO", 5, 0, false];
    
        this.unprefixedOpcodes[0xe1]=[function() { const hl=self.popWord(); self.registers.l=hl&0xff; self.registers.h=(hl>>8); self.incPc(1); },"POP HL", 10, 0, false];

        this.unprefixedOpcodes[0xe2]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (!(self.registers.f&z80flags.FLAG_PV))
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP PO,%d", 10, 2, false];
    
        this.unprefixedOpcodes[0xe3]=[function() 
        { 
            var tmp=self.theMMU.readAddr(self.registers.sp);
            self.theMMU.writeAddr(self.registers.sp,self.registers.l);
            self.registers.l=tmp;

            tmp=self.theMMU.readAddr(self.registers.sp+1);
            self.theMMU.writeAddr(self.registers.sp+1,self.registers.h);
            self.registers.h=tmp;

            self.incPc(1); 
        },"XCHG (SP),HL", 19, 0, false];
        this.unprefixedOpcodes[0xe5]=[function() { const hl=self.registers.l|(self.registers.h<<8); self.pushWord(hl); self.incPc(1); },"PUSH HL", 11, 0, false];
        this.unprefixedOpcodes[0xe6]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.and_8bit(self.registers.a,m1);
            self.incPc(2); 
        },"AND %d", 7, 1, false];

        this.unprefixedOpcodes[0xe7]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x20;
        }, "RST 20h", 11, 0, false];
    
        this.unprefixedOpcodes[0xe9]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            self.registers.pc=hl;
        }, "JP (HL)", 4, 0, false];

        this.unprefixedOpcodes[0xea]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (self.registers.f&z80flags.FLAG_PV)
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP PE,%d", 10, 2, false];
            
        this.unprefixedOpcodes[0xeb]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            var de=self.registers.e|(self.registers.d<<8);
            var tmp=hl;
            hl=de;
            de=tmp;

            self.registers.l=hl&0xff;
            self.registers.h=(hl>>8)&0xff;

            self.registers.e=de&0xff;
            self.registers.d=(de>>8)&0xff;

            self.incPc(1);
        }, "XCHG DE,HL", 4, 0, false];
    
        this.unprefixedOpcodes[0xee]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a = self.xor_8bit(self.registers.a, m1);
            self.incPc(2);
        }, "XOR %d", 7, 1, false];

        this.unprefixedOpcodes[0xf0]=[function()
        {
            // TODO 11/5 cycles
            if (!(self.registers.f&z80flags.FLAG_S))
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET P", 5, 0, false];
    
        this.unprefixedOpcodes[0xf1]=[function() { const af=self.popWord(); self.registers.f=af&0xff; self.registers.a=(af>>8); self.incPc(1); },"POP AF", 10, 0, false];

        this.unprefixedOpcodes[0xf2]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if ((self.registers.f&z80flags.FLAG_S)==0)
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP P,%d", 10, 2, false];
    
        this.unprefixedOpcodes[0xf3]=[function() { self.maskableInterruptsEnabled = false; self.incPc(1); },"DI", 4, 0, false];
        this.unprefixedOpcodes[0xf5]=[function() { const af=self.registers.f|(self.registers.a<<8); self.pushWord(af); self.incPc(1); },"PUSH AF", 11, 0, false];
        this.unprefixedOpcodes[0xf6]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.or_8bit(self.registers.a,m1);
            self.incPc(2); 
        }, "OR %d", 7, 1, false];

        this.unprefixedOpcodes[0xf7]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x30;
        }, "RST 30h", 11, 0, false];
    
        this.unprefixedOpcodes[0xf8]=[function()
        {
            // TODO 11/5 cycles
            if (self.registers.f&z80flags.FLAG_S)
            {
                self.registers.pc=self.popWord();
            }
            else
            {
                self.incPc(1);
            }
        }, "RET M", 5, 0, false];

        this.unprefixedOpcodes[0xfa]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            if (self.registers.f&z80flags.FLAG_S)
            {
                self.registers.pc=(m2<<8)|m1;
            }
            else
            {
                self.incPc(3);
            }
        }, "JP M,%d", 10, 2, false];
    
        this.unprefixedOpcodes[0xfb]=[function() { self.maskableInterruptsEnabled = true; self.incPc(1); }, "EI", 4, 0, false];

        this.unprefixedOpcodes[0xfc]=[function()
        {
            // TODO 17/10 cycles
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            if (self.registers.f&z80flags.FLAG_S)
            {
                self.pushWord(self.registers.pc+3);
                self.registers.pc=newaddr;
            }
            else
            {
                self.incPc(3);
            }
        }, "CALL M,%d", 10, 2, false];

        this.unprefixedOpcodes[0xfe]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.sub_8bit(self.registers.a,m1);
            self.incPc(2);
        }, "CP %d", 7, 1, false];
    }

    initEdTable()
    {
        let self = this;

        this.prefixedOpcodes[0x41]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.b);
            self.incPc(2);
        }, "OUT (C),B", 12, 0, false];
    
        this.prefixedOpcodes[0x42]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            const bc=self.registers.c|(self.registers.b<<8);
            hl=self.sbc_16bit(hl,bc);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(2);
        }, "SBC HL,BC", 15, 0, false];

        this.prefixedOpcodes[0x43]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var addr=(m2<<8)|m1;
            self.theMMU.writeAddr(addr,self.registers.c);
            self.theMMU.writeAddr(addr+1,self.registers.b);
            self.incPc(4);
        }, "LD (%d),BC", 20, 2, false];
            
        this.prefixedOpcodes[0x44]=[function()
        {
            self.registers.a = self.sub_8bit(0, self.registers.a);
            self.incPc(2);
        }, "NEG", 8, 0, false];

        this.prefixedOpcodes[0x4b]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var val=self.theMMU.readAddr16bit((m2<<8)|m1);
            self.registers.c=val&0xff;
            self.registers.b=val>>8;
            self.incPc(4);
        }, "LD BC,(%d)", 20, 2, false];

        this.prefixedOpcodes[0x4d]=[function()
        {
            self.registers.pc=self.popWord();
        }, "RETI", 14, 0, false];
            
        this.prefixedOpcodes[0x51]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.d);
            self.incPc(2);
        }, "OUT (C),D", 12, 0, false];

        this.prefixedOpcodes[0x52]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            const de=self.registers.e|(self.registers.d<<8);
            hl=self.sbc_16bit(hl,de);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(2);
        }, "SBC HL,DE", 15, 0, false];
    
        this.prefixedOpcodes[0x53]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var addr=(m2<<8)|m1;
            self.theMMU.writeAddr(addr,self.registers.e);
            self.theMMU.writeAddr(addr+1,self.registers.d);
            self.incPc(4);
        }, "LD (%d),DE", 20, 2, false];
    
        this.prefixedOpcodes[0x56]=[function() { self.interruptMode = 1; self.incPc(2); }, "IM 1", 8, 0, false];

        this.prefixedOpcodes[0x57]=[function()
        {
            // TODO check flags
            self.registers.a=self.registers.i;
            self.registers.f&=~z80flags.FLAG_N;
            self.registers.f&=~z80flags.FLAG_H;
            self.incPc(2);
        }, "LD A,I", 9, 2, false];
    
        this.prefixedOpcodes[0x59]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.e);
            self.incPc(2);
        }, "OUT (C),E", 12, 0, false];

        this.prefixedOpcodes[0x5a]=[function()
        { 
            var hl=self.registers.l|(self.registers.h<<8);
            var de=self.registers.e|(self.registers.d<<8);

            const ret=self.adc_16bit(hl,de);

            self.registers.l=ret&0xff;
            self.registers.h=ret>>8;

            self.incPc(2); 
        }, "ADC HL,DE", 15, 0, false];
    
        this.prefixedOpcodes[0x5b]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var val=self.theMMU.readAddr16bit((m2<<8)|m1);
            self.registers.e=val&0xff;
            self.registers.d=val>>8;
            self.incPc(4);
        }, "LD DE,(%d)", 20, 2, false];

        this.prefixedOpcodes[0x5f]=[function()
        {
            // TODO flags
            self.registers.r+=2;
            self.registers.a=self.registers.r;
            self.registers.f&=~z80flags.FLAG_N;
            self.registers.f&=~z80flags.FLAG_H;
            self.incPc(2);
        }, "LD A,R", 9, 2, false];
            
        this.prefixedOpcodes[0x61]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.h);
            self.incPc(2);
        }, "OUT (C),H", 12, 0, false];

        this.prefixedOpcodes[0x67]=[function()
        {
            self.executeRrd();
            self.incPc(2);
        }, "RRD", 18, 0, false];
    
        this.prefixedOpcodes[0x69]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.l);
            self.incPc(2);
        }, "OUT (C),L", 12, 0, false];

        this.prefixedOpcodes[0x6a]=[function()
        { 
            var hl=self.registers.l|(self.registers.h<<8);

            const ret=self.adc_16bit(hl,hl);

            self.registers.l=ret&0xff;
            self.registers.h=ret>>8;

            self.incPc(2); 
        }, "ADC HL,HL", 15, 0, false];
    
        this.prefixedOpcodes[0x6f]=[function()
        {
            self.executeRld();
            self.incPc(2);
        }, "RLD", 18, 0, false];
    
        this.prefixedOpcodes[0x71]=[function() 
        { 
            self.theMMU.writePort(self.registers.c,0);
            self.incPc(2);
        }, "OUT (C),0", 12, 0, true];

        this.prefixedOpcodes[0x73]=[function()
        {
            var m1=self.theMMU.readAddr((self.registers.pc+2)&0xffff);
            var m2=self.theMMU.readAddr((self.registers.pc+3)&0xffff);
            var addr=(m2<<8)|m1;
            self.theMMU.writeAddr(addr,self.registers.sp&0xff);
            self.theMMU.writeAddr(addr+1,self.registers.sp>>8);
            self.incPc(4);
        }, "LD (%d),SP", 20, 2, false];
    
        this.prefixedOpcodes[0x78]=[function() 
        { 
            self.registers.a=self.theMMU.readPort(self.registers.c);
            self.incPc(2);
        }, "IN A,(C)", 12, 0, true];

        this.prefixedOpcodes[0x79]=[function() 
        { 
            self.theMMU.writePort(self.registers.c,self.registers.a);
            self.incPc(2);
        }, "OUT (C),A", 12, 0, true];

        this.prefixedOpcodes[0x7b]=[function()
        {
            var m1=self.theMMU.readAddr((self.registers.pc+2)&0xffff);
            var m2=self.theMMU.readAddr((self.registers.pc+3)&0xffff);
            var addr=(m2<<8)|m1;
            var word=self.theMMU.readAddr16bit(addr);
            self.registers.sp=word;
            self.incPc(4);
        }, "LD SP,(%d)", 20, 2, false];
    
        this.prefixedOpcodes[0xa0]=[function() { self.executeLdi(); }, "LDI", 16, 0, false];
        this.prefixedOpcodes[0xa1]=[function() { self.executeCpi(); }, "CPI", 16, 0, false];
        this.prefixedOpcodes[0xa3]=[function() { self.executeOuti(); }, "OUTI", 16, 0, false];
        this.prefixedOpcodes[0xa8]=[function() { self.executeLoadDecrement(); }, "LDD", 16, 0, false];
        
        this.prefixedOpcodes[0xb0]=[function() { self.executeLoadIncrementRepeat(); }, "LDIR", 16, 0, false];
        this.prefixedOpcodes[0xb1]=[function() { self.executeCpir(); }, "CPIR", 16, 0, false];
        this.prefixedOpcodes[0xb8]=[function() { self.executeLoadDecrementRepeat(); }, "LDDR", 16, 0, false];
        this.prefixedOpcodes[0xb3]=[function() { self.executeOutIncrementRepeat(); }, "OTIR", 16, 0, false];
    }

    initCbTable()
    {
        let self = this;

        this.prefixcbOpcodes[0x01]=[function() 
        {
            self.registers.c = self.rlc_8bit(self.registers.c);
            self.incPc(2); 
        }, "RLC C", 8, 0, false];

        this.prefixcbOpcodes[0x04]=[function() 
        {
            self.registers.h = self.rlc_8bit(self.registers.h);
            self.incPc(2); 
        }, "RLC H", 8, 0, false];

        this.prefixcbOpcodes[0x08]=[function()
        { 
            self.registers.b=self.rrc_8bit(self.registers.b);
            self.incPc(2); 
        }, "RRC B", 8, 0, false];
            
        this.prefixcbOpcodes[0x0e]=[function()
        { 
            
            const address=self.registers.l|(self.registers.h<<8);
            const res=self.rrc_8bit(self.theMMU.readAddr(address));
            self.theMMU.writeAddr(address,res);
            self.incPc(2); 
        }, "RRC (HL)", 15, 0, false];
    
        this.prefixcbOpcodes[0x10]=[function() 
        {
            self.registers.b = self.rl_8bit(self.registers.b); 
            self.incPc(2); 
        }, "RL B", 8, 0, false];
    
        this.prefixcbOpcodes[0x11]=[function() 
        {
            self.registers.c = self.rl_8bit(self.registers.c); 
            self.incPc(2); 
        }, "RL C", 8, 0, false];

        this.prefixcbOpcodes[0x12]=[function() 
        {
            self.registers.d = self.rl_8bit(self.registers.d); 
            self.incPc(2); 
        }, "RL D", 8, 0, false];

        this.prefixcbOpcodes[0x14]=[function() 
        {
            self.registers.h = self.rl_8bit(self.registers.h); 
            self.incPc(2); 
        }, "RL H", 8, 0, false];
    
        this.prefixcbOpcodes[0x15]=[function() 
        {
            self.registers.l = self.rl_8bit(self.registers.l); 
            self.incPc(2); 
        }, "RL L", 8, 0, false];

        this.prefixcbOpcodes[0x17]=[function() 
        {
            self.registers.a = self.rl_8bit(self.registers.a); 
            self.incPc(2); 
        }, "RL A", 8, 0, false];

        this.prefixcbOpcodes[0x18]=[function() 
        {
            self.registers.b = self.rr_8bit(self.registers.b); 
            self.incPc(2); 
        }, "RR B", 8, 0, false];
            
        this.prefixcbOpcodes[0x19]=[function() 
        {
            self.registers.c = self.rr_8bit(self.registers.c); 
            self.incPc(2); 
        }, "RR C", 8, 0, false];

        this.prefixcbOpcodes[0x1a]=[function() 
        {
            self.registers.d = self.rr_8bit(self.registers.d); 
            self.incPc(2); 
        }, "RR D", 8, 0, false];

        this.prefixcbOpcodes[0x1b]=[function() 
        {
            self.registers.e = self.rr_8bit(self.registers.e); 
            self.incPc(2); 
        }, "RR E", 8, 0, false];

        this.prefixcbOpcodes[0x1d]=[function() 
        {
            self.registers.l = self.rr_8bit(self.registers.l); 
            self.incPc(2); 
        }, "RR L", 8, 0, false];

        this.prefixcbOpcodes[0x1f]=[function() 
        {
            self.registers.a = self.rr_8bit(self.registers.a); 
            self.incPc(2); 
        }, "RR A", 8, 0, false];

        this.prefixcbOpcodes[0x20]=[function() 
        {
            self.registers.b = self.sla_8bit(self.registers.b); 
            self.incPc(2); 
        }, "SLA B", 8, 0, false];
            
        this.prefixcbOpcodes[0x21]=[function() 
        {
            self.registers.c = self.sla_8bit(self.registers.c); 
            self.incPc(2); 
        }, "SLA C", 8, 0, false];

        this.prefixcbOpcodes[0x22]=[function() 
        {
            self.registers.d = self.sla_8bit(self.registers.d); 
            self.incPc(2); 
        }, "SLA D", 8, 0, false];

        this.prefixcbOpcodes[0x23]=[function() 
        {
            self.registers.e = self.sla_8bit(self.registers.e); 
            self.incPc(2); 
        }, "SLA E", 8, 0, false];

        this.prefixcbOpcodes[0x24]=[function() 
        {
            self.registers.h = self.sla_8bit(self.registers.h); 
            self.incPc(2); 
        }, "SLA H", 8, 0, false];

        this.prefixcbOpcodes[0x25]=[function() 
        {
            self.registers.l = self.sla_8bit(self.registers.l); 
            self.incPc(2); 
        }, "SLA L", 8, 0, false];
            
        this.prefixcbOpcodes[0x27]=[function() 
        {
            self.registers.a = self.sla_8bit(self.registers.a); 
            self.incPc(2); 
        }, "SLA A", 8, 0, false];

        this.prefixcbOpcodes[0x2c]=[function() 
        {
            self.registers.h = self.sra_8bit(self.registers.h); 
            self.incPc(2); 
        }, "SRA H", 8, 0, false];
            
        this.prefixcbOpcodes[0x2f]=[function() 
        {
            self.registers.a = self.sra_8bit(self.registers.a); 
            self.incPc(2); 
        }, "SRA A", 8, 0, false];

        this.prefixcbOpcodes[0x38]=[function() 
        {
            self.registers.b = self.srl_8bit(self.registers.b); 
            self.incPc(2); 
        }, "SRL B", 8, 0, false];

        this.prefixcbOpcodes[0x39]=[function() 
        {
            self.registers.c = self.srl_8bit(self.registers.c); 
            self.incPc(2); 
        }, "SRL C", 8, 0, false];

        this.prefixcbOpcodes[0x3a]=[function() 
        {
            self.registers.d = self.srl_8bit(self.registers.d); 
            self.incPc(2); 
        }, "SRL D", 8, 0, false];
    
        this.prefixcbOpcodes[0x3b]=[function() 
        {
            self.registers.e = self.srl_8bit(self.registers.e); 
            self.incPc(2); 
        }, "SRL E", 8, 0, false];

        this.prefixcbOpcodes[0x3c]=[function() 
        {
            self.registers.h = self.srl_8bit(self.registers.h); 
            self.incPc(2); 
        }, "SRL H", 8, 0, false];
            
        this.prefixcbOpcodes[0x3d]=[function() 
        {
            self.registers.l = self.srl_8bit(self.registers.l); 
            self.incPc(2); 
        }, "SRL L", 8, 0, false];
            
        this.prefixcbOpcodes[0x3f]=[function() 
        {
            self.registers.a = self.srl_8bit(self.registers.a); 
            self.incPc(2); 
        }, "SRL A", 8, 0, false];

        this.prefixcbOpcodes[0x40]=[function() 
        {
            self.bit_8bit(self.registers.b, 0x01); 
            self.incPc(2); 
        }, "BIT 0,B", 8, 0, false];
    
        this.prefixcbOpcodes[0x41]=[function() 
        {
            self.bit_8bit(self.registers.c, 0x01); 
            self.incPc(2); 
        }, "BIT 0,C", 8, 0, false];
            
        this.prefixcbOpcodes[0x43]=[function() 
        {
            self.bit_8bit(self.registers.e, 0x01); 
            self.incPc(2); 
        }, "BIT 0,E", 8, 0, false];
            
        this.prefixcbOpcodes[0x45]=[function() 
        {
            self.bit_8bit(self.registers.l, 0x01); 
            self.incPc(2); 
        }, "BIT 0,L", 8, 0, false];

        this.prefixcbOpcodes[0x46]=[function() 
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x01); 
            self.incPc(2); 
        }, "BIT 0,(HL)", 12, 0, false];

        this.prefixcbOpcodes[0x47]=[function() 
        {
            self.bit_8bit(self.registers.a, 0x01); 
            self.incPc(2); 
        }, "BIT 0,A", 8, 0, false];

        this.prefixcbOpcodes[0x48]=[function() 
        {
            self.bit_8bit(self.registers.b, 0x02); 
            self.incPc(2); 
        }, "BIT 1,B", 8, 0, false];

        this.prefixcbOpcodes[0x49]=[function() 
        {
            self.bit_8bit(self.registers.c, 0x02); 
            self.incPc(2); 
        }, "BIT 1,C", 8, 0, false];
            
        this.prefixcbOpcodes[0x4b]=[function() {self.bit_8bit(self.registers.e, 0x02); self.incPc(2); }, "BIT 1,E", 8, 0, false];
        this.prefixcbOpcodes[0x4c]=[function() {self.bit_8bit(self.registers.h, 0x02); self.incPc(2); }, "BIT 1,H", 8, 0, false];
        this.prefixcbOpcodes[0x4d]=[function() {self.bit_8bit(self.registers.l, 0x02); self.incPc(2); }, "BIT 1,L", 8, 0, false];

        this.prefixcbOpcodes[0x4e]=[function() 
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x02); 
            self.incPc(2); 
        }, "BIT 1,(HL)", 12, 0, false];
    
        this.prefixcbOpcodes[0x4f]=[function() {self.bit_8bit(self.registers.a, 0x02); self.incPc(2); }, "BIT 1,A", 8, 0, false];
        this.prefixcbOpcodes[0x50]=[function() {self.bit_8bit(self.registers.b, 0x04); self.incPc(2); }, "BIT 2,B", 8, 0, false];
        this.prefixcbOpcodes[0x51]=[function() {self.bit_8bit(self.registers.c, 0x04); self.incPc(2); }, "BIT 2,C", 8, 0, false];
        this.prefixcbOpcodes[0x53]=[function() {self.bit_8bit(self.registers.e, 0x04); self.incPc(2); }, "BIT 2,E", 8, 0, false];

        this.prefixcbOpcodes[0x56]=[function() 
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x04); 
            self.incPc(2); 
        }, "BIT 2,(HL)", 12, 0, false];
    
        this.prefixcbOpcodes[0x57]=[function() {self.bit_8bit(self.registers.a, 0x04); self.incPc(2); }, "BIT 2,A", 8, 0, false];
        this.prefixcbOpcodes[0x58]=[function() {self.bit_8bit(self.registers.b, 0x08); self.incPc(2); }, "BIT 3,B", 8, 0, false];
        this.prefixcbOpcodes[0x5b]=[function() {self.bit_8bit(self.registers.e, 0x08); self.incPc(2); }, "BIT 3,E", 8, 0, false];

        this.prefixcbOpcodes[0x5e]=[function() 
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x08); 
            self.incPc(2); 
        }, "BIT 3,(HL)", 12, 0, false];
    
        this.prefixcbOpcodes[0x5f]=[function() {self.bit_8bit(self.registers.a, 0x08); self.incPc(2); }, "BIT 3,A", 8, 0, false];

        this.prefixcbOpcodes[0x66]=[function() 
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x10); 
            self.incPc(2); 
        }, "BIT 4,(HL)", 12, 0, false];
    
        this.prefixcbOpcodes[0x67]=[function() {self.bit_8bit(self.registers.a, 0x10); self.incPc(2); }, "BIT 4,A", 8, 0, false];
        this.prefixcbOpcodes[0x69]=[function() {self.bit_8bit(self.registers.c, 0x20); self.incPc(2); }, "BIT 5,C", 8, 0, false];

        this.prefixcbOpcodes[0x6e]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x20); 
            self.incPc(2); 
        }, "BIT 5,(HL)",12, 0, false];
    
        this.prefixcbOpcodes[0x6f]=[function() {self.bit_8bit(self.registers.a, 0x20); self.incPc(2); }, "BIT 5,A", 8, 0, false];
        this.prefixcbOpcodes[0x71]=[function() {self.bit_8bit(self.registers.c, 0x40); self.incPc(2); }, "BIT 6,C", 8, 0, false];

        this.prefixcbOpcodes[0x76]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x40); 
            self.incPc(2); 
        }, "BIT 6,(HL)",12, 0, false];
    
        this.prefixcbOpcodes[0x77]=[function() {self.bit_8bit(self.registers.a, 0x40); self.incPc(2); }, "BIT 6,A", 8, 0, false];
        this.prefixcbOpcodes[0x78]=[function() {self.bit_8bit(self.registers.b, 0x80); self.incPc(2); }, "BIT 7,B", 8, 0, false];
        this.prefixcbOpcodes[0x79]=[function() {self.bit_8bit(self.registers.c, 0x80); self.incPc(2); }, "BIT 7,C", 8, 0, false];
        this.prefixcbOpcodes[0x7a]=[function() {self.bit_8bit(self.registers.d, 0x80); self.incPc(2); }, "BIT 7,D", 8, 0, false];
        this.prefixcbOpcodes[0x7b]=[function() {self.bit_8bit(self.registers.e, 0x80); self.incPc(2); }, "BIT 7,E", 8, 0, false];
        this.prefixcbOpcodes[0x7e]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const content=self.theMMU.readAddr(hl);
            self.bit_8bit(content, 0x80); 
            self.incPc(2); 
        }, "BIT 7,(HL)", 12, 0, false];
        this.prefixcbOpcodes[0x7f]=[function() {self.bit_8bit(self.registers.a, 0x80); self.incPc(2); }, "BIT 7,A", 8, 0, false];

        this.prefixcbOpcodes[0x81]=[function()
        {
            self.registers.c&=~0x01;
            self.incPc(2); 
        }, "RES 0,C", 8, 0, false];
    
        this.prefixcbOpcodes[0x86]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x01;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 0,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0x87]=[function()
        {
            self.registers.a&=~0x01;
            self.incPc(2); 
        }, "RES 0,A", 8, 0, false];
    
        this.prefixcbOpcodes[0x89]=[function()
        {
            self.registers.c&=~0x02;
            self.incPc(2); 
        }, "RES 1,C", 8, 0, false];

        this.prefixcbOpcodes[0x8e]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x02;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 1,(HL)", 15, 0, false];
    
        this.prefixcbOpcodes[0x90]=[function()
        {
            self.registers.b&=~0x04;
            self.incPc(2); 
        }, "RES 2,B", 8, 0, false];
    
        this.prefixcbOpcodes[0x91]=[function()
        {
            self.registers.c&=~0x04;
            self.incPc(2); 
        }, "RES 2,C", 8, 0, false];

        this.prefixcbOpcodes[0x96]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x04;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 2,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0x97]=[function()
        {
            self.registers.a&=~0x04;
            self.incPc(2); 
        }, "RES 2,A", 8, 0, false];
            
        this.prefixcbOpcodes[0x99]=[function()
        {
            self.registers.c&=~0x08;
            self.incPc(2); 
        }, "RES 3,C", 8, 0, false];

        this.prefixcbOpcodes[0x9e]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x08;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 3,(HL)", 15, 0, false];
    
        this.prefixcbOpcodes[0x9f]=[function()
        {
            self.registers.a&=~0x08;
            self.incPc(2); 
        }, "RES 3,A", 8, 0, false];
    
        this.prefixcbOpcodes[0xa1]=[function()
        {
            self.registers.c&=~0x10;
            self.incPc(2); 
        }, "RES 4,C", 8, 0, false];

        this.prefixcbOpcodes[0xa8]=[function()
        {
            self.registers.b&=~0x20;
            self.incPc(2); 
        }, "RES 5,B", 8, 0, false];
    
        this.prefixcbOpcodes[0xa9]=[function()
        {
            self.registers.c&=~0x20;
            self.incPc(2); 
        }, "RES 5,C", 8, 0, false];

        this.prefixcbOpcodes[0xb6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x40;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 6,(HL)", 8, 0, false];

        this.prefixcbOpcodes[0xb7]=[function()
        {
            self.registers.a&=~0x40;
            self.incPc(2); 
        }, "RES 6,A", 8, 0, false];
    
        this.prefixcbOpcodes[0xb8]=[function()
        {
            self.registers.b&=~0x80;
            self.incPc(2); 
        }, "RES 7,B", 8, 0, false];

        this.prefixcbOpcodes[0xb9]=[function()
        {
            self.registers.c&=~0x80;
            self.incPc(2); 
        }, "RES 7,C", 8, 0, false];
    
        this.prefixcbOpcodes[0xbb]=[function()
        {
            self.registers.e&=~0x80;
            self.incPc(2); 
        }, "RES 7,E", 8, 0, false];
            
        this.prefixcbOpcodes[0xbe]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x80;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 7,(HL)", 8, 0, false];

        this.prefixcbOpcodes[0xbd]=[function()
        {
            self.registers.l&=~0x80;
            self.incPc(2); 
        }, "RES 7,L", 8, 0, false];
            
        this.prefixcbOpcodes[0xbf]=[function()
        {
            self.registers.a&=~0x80;
            self.incPc(2); 
        }, "RES 7,A", 8, 0, false];
            
        this.prefixcbOpcodes[0xc6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x01;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 0,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xc7]=[function()
        {
            self.registers.a|=0x01;
            self.incPc(2); 
        }, "SET 0,A", 8, 0, false];
    
        this.prefixcbOpcodes[0xce]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x02;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 1,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xd0]=[function()
        {
            self.registers.b|=0x04;
            self.incPc(2); 
        }, "SET 2,B", 8, 0, false];
            
        this.prefixcbOpcodes[0xd6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x04;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 2,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xd7]=[function()
        {
            self.registers.a|=0x04;
            self.incPc(2); 
        }, "SET 2,A", 8, 0, false];
    
        this.prefixcbOpcodes[0xdf]=[function()
        {
            self.registers.a|=0x08;
            self.incPc(2); 
        }, "SET 3,A", 8, 0, false];

        this.prefixcbOpcodes[0xe5]=[function() 
        { 
            self.registers.l|=0x10;
            self.incPc(2); 
        }, "SET 4,L", 8, 0, false];
            
        this.prefixcbOpcodes[0xe6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x10;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 4,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xe8]=[function() 
        { 
            self.registers.b|=0x20;
            self.incPc(2); 
        }, "SET 5,B", 8, 0, false];

        this.prefixcbOpcodes[0xee]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x20;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 5,(HL)", 15, 0, false];
    
        this.prefixcbOpcodes[0xef]=[function() 
        { 
            self.registers.a|=0x20;
            self.incPc(2); 
        }, "SET 5,A", 8, 0, false];
            
        this.prefixcbOpcodes[0xf2]=[function() 
        { 
            self.registers.d|=0x40;
            self.incPc(2); 
        }, "SET 6,D", 8, 0, false];

        this.prefixcbOpcodes[0xf6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x40;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 6,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xf7]=[function() 
        { 
            self.registers.a|=0x40;
            self.incPc(2); 
        }, "SET 6,A", 8, 0, false];
            
        this.prefixcbOpcodes[0xfb]=[function() 
        { 
            self.registers.e|=0x80;
            self.incPc(2); 
        }, "SET 7,E", 8, 0, false];
    
        this.prefixcbOpcodes[0xfe]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x80;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 7,(HL)", 15, 0, false];

        this.prefixcbOpcodes[0xff]=[function() 
        { 
            self.registers.a|=0x80;
            self.incPc(2); 
        }, "SET 7,A", 8, 0, false];
            
    }

    initFdTable()
    {
        let self = this;

        this.prefixfdOpcodes[0x19]=[function() 
        {
            var iy=self.registers.iyl|(self.registers.iyh<<8);
            var de=self.registers.e|(self.registers.d<<8);
            var res=self.add_16bit(iy,de);
            self.registers.iyl=res&0xff;
            self.registers.iyh=res>>8;
            self.incPc(2); 
        }, "ADD IY,DE", 15, 0, false];
    
        this.prefixfdOpcodes[0x21]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            self.registers.iyh=m2;
            self.registers.iyl=m1;
            self.incPc(4); 
        }, "LD IY,%d", 14, 2, false];

        this.prefixfdOpcodes[0x22]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var iy=self.registers.iyl|(self.registers.iyh<<8);
            self.theMMU.writeAddr16bit(m1|(m2<<8),iy);
            self.incPc(4); 
        }, "LD (%d),IY", 20, 2, false];
    
        this.prefixfdOpcodes[0x23]=[function() 
        {
            var iy=self.registers.iyl|(self.registers.iyh<<8); 
            iy+=1; iy&=0xffff;
            self.registers.iyl=iy&0xff;
            self.registers.iyh=iy>>8;
            self.incPc(2); 
        }, "INC IY", 10, 0, false];

        this.prefixfdOpcodes[0x26]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.iyh=m1;
            self.incPc(3); 
        }, "LD IYH,%d", 11, 1, true];
    
        this.prefixfdOpcodes[0x2a]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var mem=self.theMMU.readAddr16bit(m1|(m2<<8));
            self.registers.iyh=mem>>8;
            self.registers.iyl=mem&0xff;
            self.incPc(4); 
        }, "LD IY,(%d)", 20, 2, false];

        this.prefixfdOpcodes[0x2e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.iyl=m1;
            self.incPc(3); 
        }, "LD IYL,%d", 11, 1, true];

        this.prefixfdOpcodes[0x34]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            var val=self.theMMU.readAddr(addr);
            val=self.inc_8bit(val);
            self.theMMU.writeAddr(addr,val);

            

            self.incPc(3); 
        }, "INC (IY+%d)", 23, 0, false];
            
        this.prefixfdOpcodes[0x36]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,m2);

            self.incPc(4); 
        }, "LD (IY+%d),%d", 19, 1, false];

        this.prefixfdOpcodes[0x39]=[function() 
        {
            var iy=self.registers.iyl|(self.registers.iyh<<8);
            var res=self.add_16bit(iy,self.registers.sp);
            self.registers.iyl=res&0xff;
            self.registers.iyh=res>>8;
            self.incPc(2); 
        }, "ADD IY,SP", 15, 0, false];
    
        this.prefixfdOpcodes[0x56]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.d=mem;

            self.incPc(3); 
        }, "LD D,(IY+%d)", 19, 1, false];
    
        this.prefixfdOpcodes[0x5e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.e=mem;

            self.incPc(3); 
        }, "LD E,(IY+%d)", 19, 1, false];
            
        this.prefixfdOpcodes[0x66]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.h=mem;

            self.incPc(3); 
        }, "LD H,(IY+%d)", 19, 1, false];

        this.prefixfdOpcodes[0x6e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.l=mem;

            self.incPc(3); 
        }, "LD L,(IY+%d)", 19, 1, false];

        this.prefixfdOpcodes[0x70]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.b);

            self.incPc(3); 
        }, "LD (IY+%d),B", 19, 1, false];
    
        this.prefixfdOpcodes[0x72]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.d);

            self.incPc(3); 
        }, "LD (IY+%d),D", 19, 1, false];
    
        this.prefixfdOpcodes[0x73]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.e);

            self.incPc(3); 
        }, "LD (IY+%d),E", 19, 1, false];
    
        this.prefixfdOpcodes[0x74]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.h);

            self.incPc(3); 
        }, "LD (IY+%d),H", 19, 1, false];

        this.prefixfdOpcodes[0x75]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.l);

            self.incPc(3); 
        }, "LD (IY+%d),L", 19, 1, false];

        this.prefixfdOpcodes[0x77]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.a);

            self.incPc(3); 
        }, "LD (IY+%d),A", 19, 1, false];
            
        this.prefixfdOpcodes[0x7e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(3); 
        }, "LD A,(IY+%d)", 14, 1, false];

        this.prefixfdOpcodes[0x86]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            self.registers.a=self.add_8bit(self.registers.a,self.theMMU.readAddr(addr));
            self.incPc(3); 
        }, "ADD A,(IY+%d)", 19, 1, false];

        this.prefixfdOpcodes[0xb6]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            self.registers.a=self.or_8bit(self.registers.a,mem);
            self.incPc(3);
        }, "OR (IY+%d)", 19, 1, false];
    
        this.prefixfdOpcodes[0xbe]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const iy=self.registers.iyl|(self.registers.iyh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(iy+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            self.sub_8bit(self.registers.a,mem);
            self.incPc(3);
        }, "CP (IY+%d)", 19, 1, false];
            
        this.prefixfdOpcodes[0xe1]=[function()
        { 
            const iy=self.popWord(); 
            self.registers.iyl=iy&0xff; 
            self.registers.iyh=(iy>>8); 
            self.incPc(2); 
        },"POP IY", 14, 0, false];
        
        this.prefixfdOpcodes[0xe5]=[function() 
        {
            const iy=self.registers.iyl|(self.registers.iyh<<8); 
            self.pushWord(iy);
            self.incPc(2); 
        }, "PUSH IY", 14, 0, false];

        this.prefixfdOpcodes[0xf9]=[function() 
        {
            var iy=self.registers.iyl|(self.registers.iyh<<8);
            self.registers.sp=iy;
            self.incPc(2); 
        }, "LD SP,IY", 15, 0, false];
    
    }

    initDdTable()
    {
        let self = this;

        this.prefixddOpcodes[0x09]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8);
            var bc=self.registers.c|(self.registers.b<<8);
            var res=self.add_16bit(ix,bc);
            self.registers.ixl=res&0xff;
            self.registers.ixh=res>>8;
            self.incPc(2); 
        }, "ADD IX,BC", 15, 0, false];
    
        this.prefixddOpcodes[0x19]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8);
            var de=self.registers.e|(self.registers.d<<8);
            var res=self.add_16bit(ix,de);
            self.registers.ixl=res&0xff;
            self.registers.ixh=res>>8;
            self.incPc(2); 
        }, "ADD IX,DE", 15, 0, false];
    
        this.prefixddOpcodes[0x21]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            self.registers.ixh=m2;
            self.registers.ixl=m1;
            self.incPc(4); 
        }, "LD IX,%d", 14, 2, false];

        this.prefixddOpcodes[0x22]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            const addr=m1|(m2<<8);
            var ix=self.registers.ixl|(self.registers.ixh<<8); 
            self.theMMU.writeAddr16bit(addr,ix);
            self.incPc(4); 
        }, "LD (%d),IX", 20, 2, false];
    
        this.prefixddOpcodes[0x24]=[function() 
        {
            self.registers.ixh=self.inc_8bit(self.registers.ixh);
            self.incPc(2); 
        }, "INC IXH", 8, 0, true];
    
        this.prefixddOpcodes[0x26]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.ixh=m1;
            self.incPc(3); 
        }, "LD IXH,%d", 11, 1, true];
    
        this.prefixddOpcodes[0x2a]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            var mem=self.theMMU.readAddr16bit(m1|(m2<<8));
            self.registers.ixh=mem>>8;
            self.registers.ixl=mem&0xff;
            self.incPc(4); 
        }, "LD IX,(%d)", 20, 2, false];
    
        this.prefixddOpcodes[0x23]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8); 
            ix+=1; ix&=0xffff;
            self.registers.ixh=ix>>8;
            self.registers.ixl=ix&0xff;
            self.incPc(2); 
        }, "INC IX", 10, 0, false];

        this.prefixddOpcodes[0x2b]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8); 
            ix-=1; ix&=0xffff;
            self.registers.ixh=ix>>8;
            self.registers.ixl=ix&0xff;
            self.incPc(2); 
        }, "DEC IX", 10, 0, false];
    
        this.prefixddOpcodes[0x2e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.ixl=m1;
            self.incPc(3); 
        }, "LD IXL,%d", 11, 1, true];
            
        this.prefixddOpcodes[0x34]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            var res=self.inc_8bit(mem);
            self.theMMU.writeAddr(addr,res);

            self.incPc(3); 
        }, "INC (IX+%d)", 23, 1, false];

        this.prefixddOpcodes[0x35]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            var res=self.dec_8bit(mem);
            self.theMMU.writeAddr(addr,res);

            self.incPc(3); 
        }, "DEC (IX+%d)", 23, 1, false];
    
        this.prefixddOpcodes[0x36]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            var m2=self.theMMU.readAddr(self.registers.pc+3);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,m2);

            self.incPc(4); 
        }, "LD (IX+%d),%d", 19, 1, false];

        this.prefixddOpcodes[0x39]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8);
            var res=self.add_16bit(ix,self.registers.sp);
            self.registers.ixl=res&0xff;
            self.registers.ixh=res>>8;
            self.incPc(2); 
        }, "ADD IX,SP", 15, 0, false];
    
        this.prefixddOpcodes[0x46]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.b=mem;

            self.incPc(3); 
        }, "LD B,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0x4e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.c=mem;

            self.incPc(3); 
        }, "LD C,(IX+%d)", 19, 1, false];
            
        this.prefixddOpcodes[0x56]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.d=mem;

            self.incPc(3); 
        }, "LD D,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0x5d]=[function() 
        {
            self.registers.e=self.registers.ixl;
            self.incPc(2); 
        }, "LD E,IXL", 8, 0, true];
            
        this.prefixddOpcodes[0x5e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.e=mem;

            self.incPc(3); 
        }, "LD E,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0x66]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.h=mem;

            self.incPc(3); 
        }, "LD H,(IX+%d)", 19, 1, false];
    
        this.prefixddOpcodes[0x6e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.l=mem;

            self.incPc(3); 
        }, "LD L,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0x70]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.b);

            self.incPc(3); 
        }, "LD (IX+%d),B", 19, 1, false];
    
        this.prefixddOpcodes[0x71]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.c);

            self.incPc(3); 
        }, "LD (IX+%d),C", 19, 1, false];
            
        this.prefixddOpcodes[0x72]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.d);

            self.incPc(3); 
        }, "LD (IX+%d),D", 19, 1, false];
    
        this.prefixddOpcodes[0x73]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.e);

            self.incPc(3); 
        }, "LD (IX+%d),E", 19, 1, false];

        this.prefixddOpcodes[0x74]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.h);

            self.incPc(3); 
        }, "LD (IX+%d),H", 19, 1, false];
    
        this.prefixddOpcodes[0x75]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.l);

            self.incPc(3); 
        }, "LD (IX+%d),L", 19, 1, false];
    
        this.prefixddOpcodes[0x77]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            self.theMMU.writeAddr(addr,self.registers.a);

            self.incPc(3); 
        }, "LD (IX+%d),A", 19, 1, false];

        this.prefixddOpcodes[0x7e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a=mem;

            self.incPc(3); 
        }, "LD A,(IX+%d)", 19, 1, false];
          
        this.prefixddOpcodes[0x84]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.ixh); 
            self.incPc(2); 
        }, "ADD A,IXH", 8, 0, false];
            
        this.prefixddOpcodes[0x86]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a=self.add_8bit(self.registers.a,mem);

            self.incPc(3); 
        }, "ADD A,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0x96]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a=self.sub_8bit(self.registers.a,mem);

            self.incPc(3); 
        }, "SUB (IX+%d)", 19, 1, false];
    
        this.prefixddOpcodes[0x9e]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a = self.sbc_8bit(self.registers.a, mem);
            
            self.incPc(3);
        }, "SBC A,(IX+%d)", 19, 1, false];

        this.prefixddOpcodes[0xa6]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a=self.and_8bit(self.registers.a,mem);
            self.incPc(3); 
        },"AND (IX+%d)", 19, 1, false];
            
        this.prefixddOpcodes[0xae]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a = self.xor_8bit(self.registers.a, mem);
            self.incPc(3);
        }, "XOR (IX+%d)", 19, 1, false];
    
        this.prefixddOpcodes[0xb6]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);

            self.registers.a=self.or_8bit(self.registers.a,mem);

            self.incPc(3); 
        }, "OR (IX+%d)", 19, 1, false];
          
        this.prefixddOpcodes[0xbe]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);
            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            self.sub_8bit(self.registers.a,mem);
            self.incPc(3);
        }, "CP (IX+%d)", 19, 1, false];
            
        this.prefixddOpcodes[0xe1]=[function()
        { 
            const ix=self.popWord(); 
            self.registers.ixl=ix&0xff; 
            self.registers.ixh=(ix>>8); 
            self.incPc(2); 
        },"POP IX", 14, 0, false];
    
        this.prefixddOpcodes[0xe5]=[function() 
        {
            const ix=self.registers.ixl|(self.registers.ixh<<8); 
            self.pushWord(ix);
            self.incPc(2); 
        }, "PUSH IX", 15, 0, false];

        this.prefixddOpcodes[0xf9]=[function() 
        {
            var ix=self.registers.ixl|(self.registers.ixh<<8);
            self.registers.sp=ix;
            self.incPc(2); 
        }, "LD SP,IX", 15, 0, false];
    
    }

    initDdCbTable()
    {
        let self = this;

        this.prefixddcbOpcodes[0x16]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);

            mem = self.rl_8bit(mem); 

            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "RL (IX+%d)", 23, 1, false];
    
        this.prefixddcbOpcodes[0x26]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);

            mem = self.sla_8bit(mem); 

            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SLA (IX+%d)", 23, 1, false];
    
        this.prefixddcbOpcodes[0x46]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x01);
            self.incPc(4); 
        }, "BIT 0,(IX+%d)", 20, 1, false];
    
        this.prefixddcbOpcodes[0x56]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x04);
            self.incPc(4); 
        }, "BIT 2,(IX+%d)", 20, 1, false];
    
        this.prefixddcbOpcodes[0x5e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x08);
            self.incPc(4); 
        }, "BIT 3,(IX+%d)", 20, 1, false];
    
        this.prefixddcbOpcodes[0x66]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x10);
            self.incPc(4); 
        }, "BIT 4,(IX+%d)", 20, 1, false];

        this.prefixddcbOpcodes[0x6e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x20);
            self.incPc(4); 
        }, "BIT 5,(IX+%d)", 20, 1, false];

        this.prefixddcbOpcodes[0x76]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x40);
            self.incPc(4); 
        }, "BIT 6,(IX+%d)", 20, 1, false];
            
        this.prefixddcbOpcodes[0x7e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            const mem=self.theMMU.readAddr(addr);
            
            self.bit_8bit(mem,0x80);
            self.incPc(4); 
        }, "BIT 7,(IX+%d)", 20, 1, false];

        this.prefixddcbOpcodes[0x8e]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem&=~0x02;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "RES 1,(IX+%d)", 23, 1, false];
    
        this.prefixddcbOpcodes[0x96]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            mem&=~0x04;
            
            self.theMMU.writeAddr(addr,mem);
            self.incPc(4); 
        }, "RES 2,(IX+%d)", 20, 1, false];

        this.prefixddcbOpcodes[0xb6]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            mem&=~0x40;
            
            self.theMMU.writeAddr(addr,mem);
            self.incPc(4); 
        }, "RES 6,(IX+%d)", 23, 1, false];
    
        this.prefixddcbOpcodes[0xc6]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem|=0x01;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SET 0,(IX+%d)", 23, 1, false];

        this.prefixddcbOpcodes[0xd6]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem|=0x04;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SET 2,(IX+%d)", 23, 1, false];

        this.prefixddcbOpcodes[0xee]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem|=0x20;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SET 5,(IX+%d)", 23, 1, false];
            
        this.prefixddcbOpcodes[0xf6]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem|=0x40;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SET 6,(IX+%d)", 23, 1, false];

        this.prefixddcbOpcodes[0xfe]=[function() 
        {
            var m1=self.theMMU.readAddr(self.registers.pc+2);

            const ix=self.registers.ixl|(self.registers.ixh<<8); 

            var incr;
            if ((m1&0x80)==0x80) 
            {
                incr=-0x80+(m1&0x7F);
            }
            else incr=m1;

            const addr=(ix+incr)&0xffff;
            var mem=self.theMMU.readAddr(addr);
            
            mem|=0x80;
            self.theMMU.writeAddr(addr,mem);

            self.incPc(4); 
        }, "SET 7,(IX+%d)", 23, 1, false];
            
    }

    initFdCbTable()
    {
        let self = this;

        this.prefixfdcbOpcodes[0x7e]=[function() 
            {
                var m1=self.theMMU.readAddr(self.registers.pc+2);
    
                const iy=self.registers.iyl|(self.registers.iyh<<8); 
    
                var incr;
                if ((m1&0x80)==0x80) 
                {
                    incr=-0x80+(m1&0x7F);
                }
                else incr=m1;
    
                const addr=(iy+incr)&0xffff;
                const mem=self.theMMU.readAddr(addr);
                
                self.bit_8bit(mem,0x80);
                self.incPc(4); 
            }, "BIT 7,(IY+%d)", 20, 1, false];
    }

    // execution

    executeOne()
    {
        var elapsedCycles=0;

        if (this.maskableInterruptWaiting)
        {
            this.maskableInterruptWaiting = false;
            this.maskableInterruptsEnabled = false;
            this.pushWord(this.registers.pc);
            this.registers.pc = 0x0038;
        }

        var b1=this.theMMU.readAddr(this.registers.pc);
        if (b1==0xcb)
        {
            // 0xcb prefix opcodes
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            var instrCode=this.prefixcbOpcodes[b2];
            if (instrCode==undefined)
            {
                console.log("z80CPU::unhandled opcode cb "+b2.toString(16));
            }
            else
            {
                instrCode[0]();
                elapsedCycles=instrCode[2];
            }
        }
        else if (b1==0xed)
        {
            // 0xed misc opcodes
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            var instrCode=this.prefixedOpcodes[b2];

            if (instrCode==undefined)
            {
                alert("z80CPU::unhandled opcode "+b1.toString(16)+b2.toString(16));
            }
            else
            {
                instrCode[0]();
                elapsedCycles=instrCode[2];
            }
        }
        else if (b1==0xdd)
        {
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            if (b2==0xcb)
            {
                // 0xddcb prefixed opcodes
                var b4=this.theMMU.readAddr(this.registers.pc+3);

                var instrCode=this.prefixddcbOpcodes[b4];
                if (instrCode==undefined)
                {
                    alert("z80CPU::unhandled opcode 0xddcb xx "+b4.toString(16)+" at PC:"+this.registers.pc.toString(16));
                }
                else
                {
                    instrCode[0]();
                    elapsedCycles=instrCode[2];
                }
            }
            else
            {
                var instrCode=this.prefixddOpcodes[b2];
                if (instrCode==undefined)
                {
                    alert("z80CPU::unhandled opcode "+b1.toString(16)+b2.toString(16));
                }
                else
                {
                    instrCode[0]();
                    elapsedCycles=instrCode[2];
                }
            }
        }
        else if (b1==0xfd)
        {
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            if (b2==0xcb)
            {
                // 0xfdcb prefixed opcodes
                var b4=this.theMMU.readAddr(this.registers.pc+3);

                var instrCode=this.prefixfdcbOpcodes[b4];
                if (instrCode==undefined)
                {
                    alert("z80CPU::unhandled opcode 0xfdcb xx "+b4.toString(16)+" at PC:"+this.registers.pc.toString(16));
                }
                else
                {
                    instrCode[0]();
                    elapsedCycles=instrCode[2];
                }
            }
            else
            {
                var instrCode=this.prefixfdOpcodes[b2];
                if (instrCode==undefined)
                {
                    alert("z80CPU::unhandled opcode "+b1.toString(16)+b2.toString(16));
                }
                else
                {
                    instrCode[0]();
                    elapsedCycles=instrCode[2];
                }
            }
        }
        else
        {
            // normal (unprefixed) opcodes
            var instrCode=this.unprefixedOpcodes[b1];
            if (instrCode==undefined)
            {
                console.log("z80CPU::unhandled opcode "+b1.toString(16)+" at PC:"+this.registers.pc.toString(16));
            }
            else
            {
                instrCode[0]();
                elapsedCycles=instrCode[2];
            }
        }

        this.totCycles+=elapsedCycles;
        return elapsedCycles;
    }

    // debugger

    getFullDecodedString(instr,bts)
    {
        var retStr=instr[1];
        if (instr[1].includes("%d"))
        {
            if (instr[3]==1)
            {
                retStr=retStr.replace("%d","0x"+bts[bts.length-1].toString(16).padStart(2,'0'));
            }
            else if (instr[3]==2)
            {
                retStr=retStr.replace("%d","0x"+bts[bts.length-1].toString(16).padStart(2,'0')+bts[bts.length-2].toString(16).padStart(2,'0'));
            }
        }

        return retStr;
    }

    debugInstructions(numInstr)
    {
        var retStruct=new Array();
        var pc=this.registers.pc;

        for (var i=0;i<numInstr;i++)
        {
            var curInstr=new Object();
            this.debugDecodeOpcode(pc,curInstr);
            retStruct.push(curInstr);
            pc+=curInstr.bytes.length;
        }

        return retStruct;
    }

    debugDecodeOpcode(thePC,retStruct)
    {
        retStruct.bytes=new Array();
        retStruct.decodedString="UNK";
        retStruct.address=thePC;

        var b1=this.theMMU.readAddr(thePC);
        if (b1==0xcb)
        {
            // 0xcb prefix opcodes
            retStruct.bytes.push(0xcb);
            var b2=this.theMMU.readAddr(thePC+1);
            retStruct.bytes.push(b2);

            var instrCode=this.prefixcbOpcodes[b2];
            if (instrCode!=undefined)
            {
                retStruct.decodedString=instrCode[1];
            }
        }
        else if (b1==0xed)
        {
            // 0xed misc opcodes
            retStruct.bytes.push(0xed);
            var b2=this.theMMU.readAddr(thePC+1);
            retStruct.bytes.push(b2);

            var instrCode=this.prefixedOpcodes[b2];
            if (instrCode==undefined)
            {
            }
            else
            {
                retStruct.decodedString=instrCode[1];
            }
        }
        else if (b1==0xdd)
        {
            var b2=this.theMMU.readAddr(thePC+1);
            if (b2==0xcb)
            {
                // 0xddcb prefixed opcodes
                retStruct.bytes.push(0xdd);
                retStruct.bytes.push(0xcb);
                var b3=this.theMMU.readAddr(thePC+2);
                retStruct.bytes.push(b3);
    
            }
            else
            {
                retStruct.bytes.push(0xdd);
                retStruct.bytes.push(b2);

                var instrCode=this.prefixddOpcodes[b2];
                if (instrCode==undefined)
                {
                }
                else
                {
                    retStruct.decodedString=instrCode[1];
                }
                    
            }
        }
        else if (b1==0xfd)
        {
            var b2=this.theMMU.readAddr(thePC+1);
            if (b2==0xcb)
            {
                // 0xfdcb prefixed opcodes
                retStruct.bytes.push(0xfd);
                retStruct.bytes.push(0xcb);
                var b3=this.theMMU.readAddr(thePC+2);
                retStruct.bytes.push(b3);

            }
            else
            {
                retStruct.bytes.push(0xfd);
                retStruct.bytes.push(b2);

                var instrCode=this.prefixfdOpcodes[b2];
                if (instrCode==undefined)
                {
                }
                else
                {
                    retStruct.decodedString=instrCode[1];
                }
    
            }
        }
        else
        {
            // normal (unprefixed) opcodes
            var instrCode=this.unprefixedOpcodes[b1];
            retStruct.bytes.push(b1);
            if (instrCode==undefined)
            {
            }
            else
            {
                for (var ab=0;ab<instrCode[3];ab++)
                {
                    retStruct.bytes.push(this.theMMU.readAddr(thePC+1+ab));
                }
                retStruct.decodedString=this.getFullDecodedString(instrCode,retStruct.bytes);
            }
        }
    }

}
