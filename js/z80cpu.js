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
			self.registers.f |= z80flags.FLAG_Z;
		}

		// S: Set if the twos-compliment value is negative.
		if (newValue & 0x80) 
        {
			self.registers.f |= z80flags.FLAG_S;
		}

		return newValue;
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

    // tables structure:
    // execution function, debug string, cycles, num of additional bytes, undocumented true/false

    initUnprefixedTable()
    {
        let self = this;

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
        this.unprefixedOpcodes[0x0d]=[function() { self.registers.c=self.dec_8bit(self.registers.c); self.incPc(1); }, "DEC C", 4, 0, false];
        this.unprefixedOpcodes[0x0e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.c=m1; self.incPc(2); }, "LD C,%d", 7, 1, false];
        this.unprefixedOpcodes[0x18]=[function() { var jq=self.theMMU.readAddr(self.registers.pc+1); self.incPc(2); self.jumpRel(jq); }, "JR %d", 12, 1, false];
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
        this.unprefixedOpcodes[0x31]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.sp=(m2<<8)|m1;
            self.incPc(3); 
        }, "LD SP,%d", 10, 2, false];
        this.unprefixedOpcodes[0x3e]=[function() { var m1=self.theMMU.readAddr(self.registers.pc+1); self.registers.a=m1; self.incPc(2); }, "LD A,%d", 7, 1, false];
        this.unprefixedOpcodes[0x78]=[function() { self.registers.a=self.registers.b; self.incPc(1); }, "LD A,B", 4, 0, false];
        this.unprefixedOpcodes[0x79]=[function() { self.registers.a=self.registers.c; self.incPc(1); }, "LD A,C", 4, 0, false];
        this.unprefixedOpcodes[0x7e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD A,(HL)", 7, 0, false];
        this.unprefixedOpcodes[0xc3]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.pc=(m2<<8)|m1;
        }, "JP %d", 10, 2, false];
        this.unprefixedOpcodes[0xc9]=[undefined, "RET", 10, 0, false];
        this.unprefixedOpcodes[0xd3]=[function() { var port=self.theMMU.readAddr(self.registers.pc+1); self.theMMU.writePort(port,self.registers.a); self.incPc(2); }, "OUT (%d),A", 11, 1, false];
        this.unprefixedOpcodes[0xee]=[function()
        {
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            self.registers.a = self.xor_8bit(self.registers.a, m1);
            self.incPc(2);
        }, "XOR %d", 7, 1, false];
        this.unprefixedOpcodes[0xf3]=[function() { self.maskableInterruptsEnabled = false; self.incPc(1); },"DI", 4, 0, false];
        this.unprefixedOpcodes[0xfb]=[undefined, "EI", 4, 0, false];
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
        this.prefixedOpcodes[0x61]=[undefined, "OUT (C),H", 12, 0, false];
        this.prefixedOpcodes[0x69]=[undefined, "OUT (C),L", 12, 0, false];
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
