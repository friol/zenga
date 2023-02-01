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
        if ((n&0x80)==0x80) this.registers.pc-=(n&0x7f);
        else this.registers.pc+=n;
        this.registers.pc&=0xffff;
    }

    // tables structure:
    // execution function, debug string, cycles, num of additional bytes, undocumented true/false

    initUnprefixedTable()
    {
        let self = this;
        this.unprefixedOpcodes[0x0e]=[undefined, "LD C,%d", 7, 1, false];
        this.unprefixedOpcodes[0x18]=[function() { var jq=self.theMMU.readAddr(self.registers.pc+1); self.incPc(2); self.jumpRel(jq); }, "JR %d", 12, 1, false];
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
        this.unprefixedOpcodes[0x31]=[function() 
        { 
            var m1=self.theMMU.readAddr(self.registers.pc+1);
            var m2=self.theMMU.readAddr(self.registers.pc+2);
            self.registers.sp=(m2<<8)|m1;
            self.incPc(3); 
        }, "LD SP,%d", 10, 2, false];
        this.unprefixedOpcodes[0x7e]=[function()
        {
            var addr=self.registers.l|(self.registers.h<<8);
            self.registers.a=self.theMMU.readAddr(addr);
            self.incPc(1);
        }, "LD A,(HL)", 7, 0, false];
        this.unprefixedOpcodes[0xc9]=[undefined, "RET", 10, 0, false];
        this.unprefixedOpcodes[0xf3]=[function() { self.maskableInterruptsEnabled = false; self.incPc(1); },"DI", 4, 0, false];
        this.unprefixedOpcodes[0xfb]=[undefined, "EI", 4, 0, false];
    }

    initEdTable()
    {
        let self = this;
        this.prefixedOpcodes[0x56]=[function() { self.interruptMode = 1; self.incPc(2); }, "IM 1", 8, 0, false];
        this.prefixedOpcodes[0x61]=[undefined, "OUT (C),H", 12, 0, false];
        this.prefixedOpcodes[0x69]=[undefined, "OUT (C),L", 12, 0, false];
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
                console.log("z80CPU::unhandled opcode "+b1.toString(16)+b2.toString(16));
            }
            else
            {
                instrCode[0]();
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
