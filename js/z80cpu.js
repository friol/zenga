/* 

    The Z80 

    Z80 seems to have a lot of different opcodes, with zero, one or two bytes prefixes:
    - 0xcb prefix (bit instructions)
    - 0xdd prefix (IX instructions)
    - 0xddcb prefix (IX bit instructions)
    - 0xed prefix (misc instructions)
    - 0xfd prefix (IY instructions)
    - 0xfdcb prefix (IY bit instructions) 


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
        this.theMMU=theMMU;

        this.registers = 
        { 
            a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, f: 0, 
            ixh: 0, ixl: 0, iyh: 0, iyl: 0,
            pc: 0, sp: 0xdff0, r: 0 
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
        this.initDdTable();

        var unprefOpcodesCount=0;
        for (var o=0;o<this.unprefixedOpcodes.length;o++)
        {
            if (this.unprefixedOpcodes[o]!=undefined)
            {
                unprefOpcodesCount++;
            }
        }

        var edOpcodesCount=0;
        for (var o=0;o<this.prefixedOpcodes.length;o++)
        {
            if (this.prefixedOpcodes[o]!=undefined)
            {
                edOpcodesCount++;
            }
        }

        console.log("CPU::Inited - unprefixed opcodes: "+unprefOpcodesCount+" - ED opcodes: "+edOpcodesCount);
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

        this.unprefixedOpcodes[0x15]=[function() { self.registers.d=self.dec_8bit(self.registers.d); self.incPc(1); }, "DEC D", 4, 0, false];
        
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

        this.unprefixedOpcodes[0x1c]=[function() { self.registers.e=self.inc_8bit(self.registers.e); self.incPc(1); }, "INC E", 4, 0, false];
        this.unprefixedOpcodes[0x1d]=[function() { self.registers.e=self.dec_8bit(self.registers.e); self.incPc(1); }, "DEC E", 4, 0, false];

        this.unprefixedOpcodes[0x1e]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.e=m1; 
            self.incPc(2); 
        }, "LD E,%d", 7, 1, false];
            
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

        this.unprefixedOpcodes[0x36]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var addr=(self.registers.h<<8)|self.registers.l;
            self.theMMU.writeAddr(addr,m1);
            self.incPc(2); 
        }, "LD (HL),%d", 10, 1, false];
    
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

        this.unprefixedOpcodes[0x3a]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var addr=(m2<<8)|m1;
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(3); 
        }, "LD A,(%d)", 13, 2, false];

        this.unprefixedOpcodes[0x3c]=[function() { self.registers.a=self.inc_8bit(self.registers.a); self.incPc(1); }, "INC A", 4, 0, false];
        this.unprefixedOpcodes[0x3d]=[function() { self.registers.a=self.dec_8bit(self.registers.a); self.incPc(1); }, "DEC A", 4, 0, false]; // the 3-D opcode
        this.unprefixedOpcodes[0x3e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.a=m1; self.incPc(2); }, "LD A,%d", 7, 1, false];
        this.unprefixedOpcodes[0x41]=[function() { self.registers.b=self.registers.c; self.incPc(1); }, "LD B,C", 4, 0, false];
        this.unprefixedOpcodes[0x45]=[function() { self.registers.b=self.registers.l; self.incPc(1); }, "LD B,L", 4, 0, false];

        this.unprefixedOpcodes[0x46]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.b=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD B,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x47]=[function() { self.registers.b=self.registers.a; self.incPc(1); }, "LD B,A", 4, 0, false];
        this.unprefixedOpcodes[0x4a]=[function() { self.registers.c=self.registers.d; self.incPc(1); }, "LD C,D", 4, 0, false];
        this.unprefixedOpcodes[0x4d]=[function() { self.registers.c=self.registers.l; self.incPc(1); }, "LD C,L", 4, 0, false];

        this.unprefixedOpcodes[0x4e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.c=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD C,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x4f]=[function() { self.registers.c=self.registers.a; self.incPc(1); }, "LD C,A", 4, 0, false];
        this.unprefixedOpcodes[0x52]=[function() { self.registers.d=self.registers.d; self.incPc(1); }, "LD D,D", 4, 0, false];

        this.unprefixedOpcodes[0x56]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.d=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD D,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x57]=[function() { self.registers.d=self.registers.a; self.incPc(1); }, "LD D,A", 4, 0, false];
        this.unprefixedOpcodes[0x58]=[function() { self.registers.e=self.registers.b; self.incPc(1); }, "LD E,B", 4, 0, false];
        this.unprefixedOpcodes[0x5c]=[function() { self.registers.e=self.registers.h; self.incPc(1); }, "LD E,H", 4, 0, false];

        this.unprefixedOpcodes[0x5e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.e=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD E,(HL)",7, 0, false];
    
        this.unprefixedOpcodes[0x5f]=[function() { self.registers.e=self.registers.a; self.incPc(1); }, "LD E,A", 4, 0, false];
        this.unprefixedOpcodes[0x61]=[function() { self.registers.h=self.registers.c; self.incPc(1); }, "LD H,C", 4, 0, false];

        this.unprefixedOpcodes[0x66]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.h=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD H,(HL)",7, 0, false];

        this.unprefixedOpcodes[0x67]=[function() { self.registers.h=self.registers.a; self.incPc(1); }, "LD H,A", 4, 0, false];
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
    
        this.unprefixedOpcodes[0x87]=[function()
        { 
            self.registers.a=self.add_8bit(self.registers.a,self.registers.a); 
            self.incPc(1); 
        }, "ADD A,A", 4, 0, false];

        this.unprefixedOpcodes[0x90]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        }, "SUB B", 4, 0, false];

        this.unprefixedOpcodes[0xa0]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        },"AND B", 4, 0, false];
            
        this.unprefixedOpcodes[0xa4]=[function()
        { 
            self.registers.a=self.and_8bit(self.registers.a,self.registers.h);
            self.incPc(1); 
        },"AND H", 4, 0, false];
    
        this.unprefixedOpcodes[0xaf]=[function()
        {
            self.registers.a = self.xor_8bit(self.registers.a, self.registers.a);
            self.incPc(1);
        }, "XOR A", 4, 0, false];
        this.unprefixedOpcodes[0xb1]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.c);
            self.incPc(1); 
        }, "OR C", 4, 0, false];
        this.unprefixedOpcodes[0xb3]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.e);
            self.incPc(1); 
        }, "OR E", 4, 0, false];
        this.unprefixedOpcodes[0xb5]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.l);
            self.incPc(1); 
        }, "OR L", 4, 0, false];
        this.unprefixedOpcodes[0xb7]=[function()
        { 
            self.registers.a=self.or_8bit(self.registers.a,self.registers.a);
            self.incPc(1); 
        }, "OR A", 4, 0, false];

        this.unprefixedOpcodes[0xbe]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            const m1=self.theMMU.readAddr(hl);
            self.sub_8bit(self.registers.a,m1);
            self.incPc(1);
        }, "CP (HL)", 7, 0, false];
    
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
        this.unprefixedOpcodes[0xcd]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            var newaddr=m1|(m2<<8);
            self.pushWord(self.registers.pc+3);
            self.registers.pc=newaddr;
        }, "CALL %d", 17, 2, false];
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
            
        this.unprefixedOpcodes[0xdb]=[function() 
        { 
            var port=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.a=self.theMMU.readPort(port); 
            self.incPc(2); 
        }, "IN A,(%d)", 11, 1, false];

        this.unprefixedOpcodes[0xdf]=[function()
        {
            self.pushWord(self.registers.pc+1);
            self.registers.pc=0x18;
        }, "RST 18h", 11, 0, false];

        this.unprefixedOpcodes[0xe1]=[function() { const hl=self.popWord(); self.registers.l=hl&0xff; self.registers.h=(hl>>8); self.incPc(1); },"POP HL", 10, 0, false];
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

        this.unprefixedOpcodes[0xe9]=[function()
        {
            var hl=self.registers.l|(self.registers.h<<8);
            self.registers.pc=hl;
        }, "JP (HL)", 4, 0, false];
    
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
        this.unprefixedOpcodes[0xfb]=[function() { self.maskableInterruptsEnabled = true; self.incPc(1); }, "EI", 4, 0, false];
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
        this.prefixedOpcodes[0x51]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.d);
            self.incPc(2);
        }, "OUT (C),D", 12, 0, false];
        this.prefixedOpcodes[0x56]=[function() { self.interruptMode = 1; self.incPc(2); }, "IM 1", 8, 0, false];
        this.prefixedOpcodes[0x59]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.e);
            self.incPc(2);
        }, "OUT (C),E", 12, 0, false];
        this.prefixedOpcodes[0x61]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.h);
            self.incPc(2);
        }, "OUT (C),H", 12, 0, false];
        this.prefixedOpcodes[0x69]=[function()
        {
            self.theMMU.writePort(self.registers.c,self.registers.l);
            self.incPc(2);
        }, "OUT (C),L", 12, 0, false];
        this.prefixedOpcodes[0x71]=[function() 
        { 
            self.theMMU.writePort(self.registers.c,0);
            self.incPc(2);
        }, "OUT (C),0", 12, 0, true];

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

        this.prefixedOpcodes[0xa1]=[function() { self.executeCpi(); }, "CPI", 16, 0, false];
        this.prefixedOpcodes[0xa3]=[function() { self.executeOuti(); }, "OUTI", 16, 0, false];
        
        this.prefixedOpcodes[0xb0]=[function() { self.executeLoadIncrementRepeat(); }, "LDIR", 16, 0, false];
        this.prefixedOpcodes[0xb3]=[function() { self.executeOutIncrementRepeat(); }, "OTIR", 16, 0, false];
    }

    initCbTable()
    {
        let self = this;

        this.prefixcbOpcodes[0x11]=[function() 
        {
            self.registers.c = self.rl_8bit(self.registers.c); 
            self.incPc(2); 
        }, "RL C", 8, 0, false];
    
        this.prefixcbOpcodes[0x21]=[function() 
        {
            self.registers.c = self.sla_8bit(self.registers.c); 
            self.incPc(2); 
        }, "SLA C", 8, 0, false];

        this.prefixcbOpcodes[0x2f]=[function() 
        {
            self.registers.a = self.sra_8bit(self.registers.a); 
            self.incPc(2); 
        }, "SRA A", 8, 0, false];
    
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
    
        this.prefixcbOpcodes[0x4b]=[function() {self.bit_8bit(self.registers.e, 0x02); self.incPc(2); }, "BIT 1,E", 8, 0, false];
        this.prefixcbOpcodes[0x4d]=[function() {self.bit_8bit(self.registers.l, 0x02); self.incPc(2); }, "BIT 1,L", 8, 0, false];
        this.prefixcbOpcodes[0x53]=[function() {self.bit_8bit(self.registers.e, 0x04); self.incPc(2); }, "BIT 2,E", 8, 0, false];
        this.prefixcbOpcodes[0x57]=[function() {self.bit_8bit(self.registers.a, 0x04); self.incPc(2); }, "BIT 2,A", 8, 0, false];
        this.prefixcbOpcodes[0x5b]=[function() {self.bit_8bit(self.registers.e, 0x08); self.incPc(2); }, "BIT 3,E", 8, 0, false];

        this.prefixcbOpcodes[0x79]=[function() {self.bit_8bit(self.registers.c, 0x80); self.incPc(2); }, "BIT 7,C", 8, 0, false];

        this.prefixcbOpcodes[0x86]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content&=~0x01;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "RES 0,(HL)", 15, 0, false];
    
        this.prefixcbOpcodes[0xc6]=[function()
        {
            const hl=self.registers.l|(self.registers.h<<8);
            var content=self.theMMU.readAddr(hl);
            content|=0x01;
            self.theMMU.writeAddr(hl,content);
            self.incPc(2); 
        }, "SET 0,(HL)", 15, 0, false];
        
        this.prefixcbOpcodes[0xf2]=[function() 
        { 
            self.registers.d|=0x40;
            self.incPc(2); 
        }, "SET 6,D", 8, 0, false];


    }

    initFdTable()
    {
        let self = this;

        this.prefixfdOpcodes[0xe5]=[function() 
        {
            const iy=self.registers.iyl|(self.registers.iyh<<8); 
            self.pushWord(iy);
            self.incPc(2); 
        }, "PUSH IY", 15, 0, false];

    }

    initDdTable()
    {
        let self = this;

        this.prefixddOpcodes[0xe5]=[function() 
        {
            const ix=self.registers.ixl|(self.registers.ixh<<8); 
            self.pushWord(ix);
            self.incPc(2); 
        }, "PUSH IX", 15, 0, false];

    }

    // execution

    executeOne()
    {
        if (this.maskableInterruptWaiting)
        {
            this.pushWord(this.registers.pc);
            this.registers.pc = 0x0038;
            this.maskableInterruptWaiting = false;
            this.maskableInterruptsEnabled = false;
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
                this.totCycles+=instrCode[2];
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
                this.totCycles+=instrCode[2];
            }
        }
        else if (b1==0xdd)
        {
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            if (b2==0xcb)
            {
                // 0xddcb prefixed opcodes
                var b3=this.theMMU.readAddr(this.registers.pc+2);

                
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
                    this.totCycles+=instrCode[2];
                }
            }
        }
        else if (b1==0xfd)
        {
            var b2=this.theMMU.readAddr(this.registers.pc+1);
            if (b2==0xcb)
            {
                // 0xfdcb prefixed opcodes
                var b3=this.theMMU.readAddr(this.registers.pc+2);

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
                    this.totCycles+=instrCode[2];
                }
            }
        }
        else
        {
            // normal (unprefixed) opcodes
            var instrCode=this.unprefixedOpcodes[b1];
            if (instrCode==undefined)
            {
                console.log("z80CPU::unhandled opcode "+b1.toString(16));
            }
            else
            {
                instrCode[0]();
                this.totCycles+=instrCode[2];
            }
        }
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
