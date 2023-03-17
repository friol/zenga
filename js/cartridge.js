/* cartridge */

class cartridge
{
    constructor(name)
    {
        this.cartridgeSize=0;
        this.cartridgeRom=[];
        this.cartName=name;
    }

    checkForTmrSega(h)
    {
        const tmrSega=['T','M','R',' ','S','E','G','A'];

        for (var b=0;b<8;b++)
        {
            if (h[b]!=tmrSega[b]) return false;
        }

        return true;
    }

    /*
        Value	System/region
        $3	SMS Japan
        $4	SMS Export
        $5	GG Japan
        $6	GG Export
        $7	GG International
    */
    
    printRegionCode(c)
    {
        if (c==0x03)
        {
            console.log("Cartridge::Region code: SMS Japan");
        }
        else if (c==0x04)
        {
            console.log("Cartridge::Region code: SMS Export");
        }
    }

    /*
        Value	Rom size	Comment
        $a	8KB	Unused
        $b	16KB	Unused
        $c	32KB	 
        $d	48KB	Unused, buggy
        $e	64KB	Rarely used
        $f	128KB	 
        $0	256KB	 
        $1	512KB	Rarely used
        $2	1MB	Unused, buggy    
    */
    
    printRomSize(c)
    {
        if (c==0x0c)
        {
            console.log("Cartridge::Size 32k");
        }
        else if (c==0x0f)
        {
            console.log("Cartridge::Size 128k");
        }
        else if (c==0x0)
        {
            console.log("Cartridge::Size 256k");
        }
    }

    calcChecksum()
    {
        var cs=0;

        if ((this.cartridgeRom.length%4)!=0)
        {
            throw("Cartridge::Error: ROM lenght not multiple of 4, can't calculate checksum");
        }

        for (var i=0;i<this.cartridgeRom.length;i+=4)
        {
            var u32=0;
            u32=this.cartridgeRom[i];
            u32|=this.cartridgeRom[i+1]<<8;
            u32|=this.cartridgeRom[i+2]<<16;
            u32|=this.cartridgeRom[i+3]<<24;

            cs+=u32;
            cs&=0xffffffff;       
        }

        cs=Math.abs(cs);     
        return cs;
    }

    load(buf)
    {
        this.cartridgeSize=buf.byteLength;

        var uint8ArrayNew  = new Uint8Array(buf);

        for (var b=0;b<this.cartridgeSize;b++)
        {
            this.cartridgeRom.push(uint8ArrayNew[b]);
        }

        if (this.cartridgeSize<(32*1024))
        {
            console.log("Cartridge::Error: cartridge of size < 32k");
        }

        // f*ing 512 bytes header?
		if (this.cartridgeRom.length % 0x4000 == 512) 
        {
			let tempRomBytes = [];
			for (let i = 512; i < this.cartridgeRom.length; i++) 
            {
				tempRomBytes.push(this.cartridgeRom[i]);
			}

			this.cartridgeRom = tempRomBytes;
		}

        // calculate checksum of ROM
        this.romChecksum=this.calcChecksum();
        console.log("Cartridge::Checksum is "+this.romChecksum.toString(16).padStart(8,'0'));

        // check for header
        var header=new Array();
        for (var b=0;b<16;b++)
        {
            header.push(this.cartridgeRom[0x7ff0+b]);
        }

        var sHeader=[];
        header.forEach(i => {
            sHeader.push(String.fromCharCode(i));
        });
        //console.log("Cartridge::Header: ["+sHeader+"]");

        if (this.checkForTmrSega(sHeader))
        {
            console.log("Cartridge:found SEGA header at 0x7ff0");
        }
        else
        {
            return;
        }

        this.printRegionCode(header[0x0f]>>4);
        this.printRomSize(header[0x0f]&0x0f);
    }
}
