/* sms VDP, derived from the Texas Instruments TMS9918 */

const vdpDataPortWriteMode = 
{
    toVRAM: 0,
    toCRAM: 1
};

class smsVDP
{
    constructor()
    {
        /* 32 bytes of color RAM (CRAM) - write only */
        this.colorRam=new Array();
        for (var c=0;c<0x20;c++)
        {
            this.colorRam.push(0);            
        }

        /* video RAM */
        this.vRam=new Array();
        for (var b=0;b<0x4000;b++)
        {
            this.vRam.push(b);            
        }

        this.controlWordFlag=false;
        this.controlWord=0;
        this.dataPortReadWriteAddress=0;
        this.dataPortWriteMode=vdpDataPortWriteMode.toVRAM;
        this.readBufferByte=0;

        this.nameTableBaseAddress=0;
        this.vcounter=0;
        this.hcounter=0;
    }

    writeByteToRegister(registerIndex, dataByte)
    {
        console.log("VDP::write byte 0x"+dataByte.toString(16).padStart(2,'0')+" to register "+registerIndex);

        if (registerIndex==2)        
        {
            /*  Register $02 - Name Table Base Address */
            console.log("VDP::register 2 write (name table base address)");
            this.nameTableBaseAddress = dataByte;
        }
    }

/*
    When the first byte is written, the lower 8 bits of the address register are
    updated. When the second byte is written, the upper 6 bits of the address
    register and the code register are updated, and the VDP may carry out
    additional processing based on the value of the code register:

    Code value         Actions taken

        0               A byte of VRAM is read from the location defined by the
                        address register and is stored in the read buffer. The
                        address register is incremented by one. Writes to the
                        data port go to VRAM.
        1               Writes to the data port go to VRAM.
        2               This value signifies a VDP register write, explained
                        below. Writes to the data port go to VRAM.
        3               Writes to the data port go to CRAM.    
*/
    writeByteToControlPort(b)
    {
        if (!this.controlWordFlag) 
        {
			this.controlWord=b;
			this.controlWordFlag=true;
		} 
        else 
        {
			this.controlWord |= (b<<8);
			this.controlWordFlag=false;

			let controlCode=(this.controlWord&0xc000) >> 14;
			this.dataPortReadWriteAddress=(this.controlWord&0x3fff);        

            console.log("VDP::word written to control port, controlCode "+controlCode.toString(16)+" address "+this.dataPortReadWriteAddress.toString(16));

            if (controlCode==0)
            {
            }
            else if (controlCode==1)
            {
                this.dataPortWriteMode=vdpDataPortWriteMode.toVRAM;
            }
            else if (controlCode==2)
            {
                let registerIndex = (this.controlWord & 0x0f00) >> 8;
				let dataByte = this.controlWord & 0x00ff;

				this.writeByteToRegister(registerIndex, dataByte);                
            }
            else if (controlCode==3)
            {
                this.dataPortWriteMode=vdpDataPortWriteMode.toCRAM;
            }
        }
    }

    writeByteToDataPort(b)
    {
        this.controlWordFlag = false;

        if (this.dataPortWriteMode==vdpDataPortWriteMode.toVRAM)
        {
            if (this.dataPortReadWriteAddress<0x4000) 
            {
				this.vRam[this.dataPortReadWriteAddress]=b;
			}
            else 
            {
				console.log('VDP::Attempt to write to illegal VRAM address: ' + this.dataPortReadWriteAddress.toString(16));
			}
        }
        else if (this.dataPortWriteMode==vdpDataPortWriteMode.toCRAM)
        {
            let cramAddress=this.dataPortReadWriteAddress&0x1f;

			if (cramAddress < 0x20) 
            {
				this.colorRam[cramAddress]=b;
			} 
            else 
            {
				console.log('VDP::Attempt to write to illegal CRAM address: ' + cramAddress.toString(16));
			}            
        }

		this.dataPortReadWriteAddress++;
		this.dataPortReadWriteAddress&=0x3fff;
		this.readBufferByte=b;
    }

    readDataPort(p)
    {
        if (p==0x7e)
        {
            return this.vcounter;
        }

        return 0;
    }

    drawTile(ctx,addr,x,y)
    {
        for (var yt=0;yt<8;yt++)
        {
            for (var xt=0;xt<8;xt++)
            {
                var byte0=this.vRam[addr]
                var byte1=this.vRam[addr+1]
                var byte2=this.vRam[addr+2]
                var byte3=this.vRam[addr+3]

                byte0>>=(7-xt); byte0&=1;
                byte1>>=(7-xt); byte1&=1;
                byte2>>=(7-xt); byte2&=1;
                byte3>>=(7-xt); byte3&=1;

                var cramIdx=byte0|(byte1<<1)|(byte2<<2)|(byte3<<3);
                var curbyte=this.colorRam[cramIdx];
                var red=(curbyte&0x03)*64;
                var green=((curbyte>>2)&0x03)*64;
                var blue=((curbyte>>4)&0x03)*64;
                ctx.fillStyle = "rgba("+red+","+green+","+blue+",1)"; 
    
                ctx.fillRect(x+xt,y+yt,1,1);
            }

            addr+=4;
        }        
    }

    debugTiles(ctx,x,y)
    {
        var addrInMemory=0;
        for (var ytile=0;ytile<16;ytile++)
        {
            for (var xtile=0;xtile<16;xtile++)
            {
                this.drawTile(ctx,addrInMemory,x+(xtile*8),y+(ytile*8));
                addrInMemory+=32; /* Each tile uses 32 bytes */
            }
        }
    }

    debugPalette(ctx,x,y)
    {
        for (var color=0;color<0x20;color++)
        {
            var curbyte=this.colorRam[color];
            var red=(curbyte&0x03)*64;
            var green=((curbyte>>2)&0x03)*64;
            var blue=((curbyte>>4)&0x03)*64;

            const quadSize=10;
            ctx.fillStyle = "rgba("+red+","+green+","+blue+",1)"; 
            ctx.fillRect(x+(color*quadSize),y,quadSize,quadSize);
        }

    }

    update()
    {
        // TODO check this
        // update counters like V and H
        this.hcounter+=1;
        if (this.hcounter>256)
        {
            this.hcounter=0;
            this.vcounter+=1;

            if (this.vcounter>192)
            {
                this.vcounter=0;
            }
        }
    }

    /*
        Each word in the name table has the following layout:

        MSB          LSB
        ---pcvhnnnnnnnnn

        - = Unused. Some games use these bits as flags for collision and damage
            zones. (such as Wonderboy in Monster Land, Zillion 2)
        p = Priority flag. When set, sprites will be displayed underneath the
            background pattern in question.
        c = Palette select.
        v = Vertical flip flag.
        h = Horizontal flip flag.
        n = Pattern index, any one of 512 patterns in VRAM can be selected.    
    */

    drawScreen(ctx)
    {
        var nameTableBaseAddress=((this.nameTableBaseAddress>>1)&0x07)<<11;

        for (var y=0;y<24;y++)
        {
            for (var x=0;x<32;x++)
            {
                var word=this.vRam[nameTableBaseAddress];
                word|=this.vRam[nameTableBaseAddress+1]<<8;

                this.drawTile(ctx,(word&0x1ff)*32,x*8,y*8);   
                nameTableBaseAddress+=2;             
            }
        }

    }

}
