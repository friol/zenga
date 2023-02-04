/* sms mmu */

class smsMmu
{
    constructor(theCart,theVDP)
    {
        this.ram8k=new Array(0x2000);
        for (var i=0;i<0x2000;i++)
        {
            this.ram8k[i]=0;
        }

        this.theCartridge=theCart;
        this.theVDP=theVDP;

        console.log("MMU::Inited");
    }

    readAddr(addr)
    {
        if ((addr>=0)&&(addr<=0x7fff))
        {
            // unbanked cartridge, for now
            return this.theCartridge.cartridgeRom[addr];
        }
        else if ((addr>=0xc000)&&(addr<=0xdfff)) /* The work RAM is only 8K, and is mirrored at $E000-$FFFF */
        {
            return this.ram8k[addr-0xc000];
        }
        else if ((addr>=0xe000)&&(addr<=0xffff))
        {
            return this.ram8k[addr-0xe000];
        }
        else
        {
            console.log("MMU::Read from unknown address ["+addr+"]");
        }
    }

    writeAddr(addr,value)
    {
        if ((addr>=0xc000)&&(addr<=0xdfff))
        {
            this.ram8k[addr-0xc000]=value;
        }
        else if ((addr>=0xe000)&&(addr<=0xffff))
        {
            this.ram8k[addr-0xe000]=value;
        }
    }

    readAddr16bit(address)
    {
		let byte1 = this.readAddr(address);
		let byte2 = this.readAddr(address + 1);
		return byte1 | byte2 << 8;        
    }

	writeAddr16bit(address, word) 
    {
		var byte1 = word & 0xFF;
		var byte2 = word >> 8;

		this.writeAddr(address, byte1);
		this.writeAddr(address + 1, byte2);
	}    

    // I/O ports

    writePort(p,v)
    {
        if (p==0xbf)
        {
            this.theVDP.writeByteToControlPort(v);
        }
        else if (p==0xbe)
        {
            this.theVDP.writeByteToDataPort(v);
        }

    }

    readPort(p)
    {
        if (p==0x7e)
        {
            return this.theVDP.readDataPort(p);
        }

        return 0;
    }

}
