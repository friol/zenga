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

        console.log("CPU::Inited");
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
        // TODO flags
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
        if (newValue & 0x04) 
        {
            this.registers.f |= z80flags.FLAG_F3;
        }

        // H: Set if the first 4 bits of the subtraction resulted in a borrow.
        if ((v & 0x0f) - 1 < 0) 
        {
            this.registers.f |= z80flags.FLAG_H;
        }

        // F5: Set if bit 5 of the test byte is set.
        if (newValue & 0x10) 
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
        // TODO
		/*if (self.parityLookUp[newValue]) 
        {
			r.f |= CPU_FLAG_PV;
		}*/

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
        // TODO
		/*if (self.parityLookUp[newValue]) 
        {
			r.f |= CPU_FLAG_PV;
		}*/

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
        // TODO
		/*if (self.parityLookUp[newValue]) {
			r.f |= CPU_FLAG_PV;
		}*/

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
			this.registers.f |= z80flags.CPU_FLAG_PV;
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
        this.unprefixedOpcodes[0x05]=[function() { self.registers.b=self.dec_8bit(self.registers.b); self.incPc(1); }, "DEC B", 4, 0, false];
        this.unprefixedOpcodes[0x06]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.b=m1; self.incPc(2); }, "LD B,%d", 7, 1, false];
        this.unprefixedOpcodes[0x09]=[function() 
        { 
            var hl=self.registers.l|(self.registers.h<<8);
            var bc=self.registers.c|(self.registers.b<<8);
            hl=self.add_16bit(hl,bc);
            self.registers.l=hl&0xff;
            self.registers.h=hl>>8;
            self.incPc(1); 
        }, "ADD HL,BC", 11, 0, false];
        this.unprefixedOpcodes[0x0c]=[function() { self.registers.c=self.inc_8bit(self.registers.c); self.incPc(1); }, "INC C", 4, 0, false];
        this.unprefixedOpcodes[0x0d]=[function() { self.registers.c=self.dec_8bit(self.registers.c); self.incPc(1); }, "DEC C", 4, 0, false];
        this.unprefixedOpcodes[0x0e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.c=m1; self.incPc(2); }, "LD C,%d", 7, 1, false];

        this.unprefixedOpcodes[0x11]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.d=m2;
            self.registers.e=m1;
            self.incPc(3); 
        }, "LD DE,%d",10, 2, false];

        this.unprefixedOpcodes[0x13]=[function()
        {
            var de=self.registers.e|(self.registers.d<<8);
            de+=1; de&=0xffff;
            self.registers.e=de&0xff;
            self.registers.d=(de>>8)&0xff;
            self.incPc(1);
        }, "INC DE", 6, 0, false];
    
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
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
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

        this.unprefixedOpcodes[0x2e]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.l=m1;
            self.incPc(2);
        }, "LD L,%d", 7, 1, false];
    
        this.unprefixedOpcodes[0x30]=[function() 
        { 
            // TODO 12/7 cycles (12 if jumped, 7 otherwise)
            var jq=self.theMMU.readAddr(self.registers.pc+1); 
            self.incPc(2); 
            if (!self.registers.f&z80flags.FLAG_C)
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
            
        this.unprefixedOpcodes[0x3e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.a=m1; self.incPc(2); }, "LD A,%d", 7, 1, false];
        this.unprefixedOpcodes[0x41]=[function() { self.registers.b=self.registers.c; self.incPc(1); }, "LD B,C", 4, 0, false];
        this.unprefixedOpcodes[0x45]=[function() { self.registers.b=self.registers.l; self.incPc(1); }, "LD B,L", 4, 0, false];
        this.unprefixedOpcodes[0x4f]=[function() { self.registers.c=self.registers.a; self.incPc(1); }, "LD C,A", 4, 0, false];
        this.unprefixedOpcodes[0x5f]=[function() { self.registers.e=self.registers.a; self.incPc(1); }, "LD E,A", 4, 0, false];
        this.unprefixedOpcodes[0x6f]=[function() { self.registers.l=self.registers.a; self.incPc(1); }, "LD L,A", 4, 0, false];
        this.unprefixedOpcodes[0x70]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.theMMU.writeAddr(addr,self.registers.b);
            self.incPc(1);
        }, "LD (HL),B",7, 0, false];
        this.unprefixedOpcodes[0x78]=[function() { self.registers.a=self.registers.b; self.incPc(1); }, "LD A,B", 4, 0, false];
        this.unprefixedOpcodes[0x79]=[function() { self.registers.a=self.registers.c; self.incPc(1); }, "LD A,C", 4, 0, false];
        this.unprefixedOpcodes[0x7d]=[function() { self.registers.a=self.registers.l; self.incPc(1); }, "LD A,L", 4, 0, false];
        this.unprefixedOpcodes[0x7e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD A,(HL)", 7, 0, false];

        this.unprefixedOpcodes[0x90]=[function() 
        { 
            self.registers.a=self.sub_8bit(self.registers.a,self.registers.b);
            self.incPc(1); 
        }, "SUB B", 4, 0, false];
    
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
        this.unprefixedOpcodes[0xc9]=[function()
        {
            self.registers.pc=self.popWord();
        }, "RET", 10, 0, false];
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
        this.unprefixedOpcodes[0xd3]=[function() { var port=self.theMMU.readAddr(self.registers.pc+1); self.theMMU.writePort(port,self.registers.a); self.incPc(2); }, "OUT (%d),A", 11, 1, false];
        this.unprefixedOpcodes[0xd6]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.sub_8bit(self.registers.a,m1);
            self.incPc(2); 
        }, "SUB %d", 7, 1, false];
        this.unprefixedOpcodes[0xdb]=[function() 
        { 
            var port=self.theMMU.readAddr(self.registers.pc+1); 
            self.registers.a=self.theMMU.readPort(port); 
            self.incPc(2); 
        }, "IN A,(%d)", 11, 1, false];
        this.unprefixedOpcodes[0xe1]=[function() { const hl=self.popWord(); self.registers.l=hl&0xff; self.registers.h=(hl>>8); self.incPc(1); },"POP HL", 10, 0, false];
        this.unprefixedOpcodes[0xe5]=[function() { const hl=self.registers.l|(self.registers.h<<8); self.pushWord(hl); self.incPc(1); },"PUSH HL", 11, 0, false];
        this.unprefixedOpcodes[0xe6]=[function()
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a=self.and_8bit(self.registers.a,m1);
            self.incPc(2); 
        },"AND %d", 7, 1, false];
        this.unprefixedOpcodes[0xee]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a = self.xor_8bit(self.registers.a, m1);
            self.incPc(2);
        }, "XOR %d", 7, 1, false];
        this.unprefixedOpcodes[0xf1]=[function() { const af=self.popWord(); self.registers.f=af&0xff; self.registers.a=(af>>8); self.incPc(1); },"POP AF", 10, 0, false];
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
        this.prefixedOpcodes[0x56]=[function() { self.interruptMode = 1; self.incPc(2); }, "IM 1", 8, 0, false];
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
        this.prefixedOpcodes[0xb0]=[function() { self.executeLoadIncrementRepeat(); }, "LDIR", 16, 0, false];
        this.prefixedOpcodes[0xb3]=[function() { self.executeOutIncrementRepeat(); }, "OTIR", 16, 0, false];
    }

    // execution

    executeOne()
    {
        var b1=this.theMMU.readAddr(this.registers.pc);
        if (b1==0xcb)
        {
            // 0xcb prefix opcodes
            var b2=this.theMMU.readAddr(this.registers.pc+1);

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
