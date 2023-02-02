/* sms mmu */

class smsMmu
{
    constructor(theCart)
    {
        this.ram8k=new Array(0x2000);
        for (var i=0;i<0x2000;i++)
        {
            this.ram8k[i]=0;
        }

        this.theCartridge=theCart;

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

    }

    // I/O ports

    writePort(p,v)
    {
        
    }

}
