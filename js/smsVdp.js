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
        /* video RAM */
        this.vRam=new Array();
        for (var b=0;b<0x4000;b++)
        {
            this.vRam.push(0);            
        }

        /* 32 bytes of color RAM (CRAM) - write only */
        this.colorRam=new Array();
        for (var c=0;c<0x20;c++)
        {
            this.colorRam.push(0);            
        }

        this.clockCyclesPerScanline=226;
        this.currentScanlineIndex=0; // 0-262

        this.controlWordFlag=false;
        this.controlWord=0;
        this.dataPortReadWriteAddress=0;
        this.dataPortWriteMode=vdpDataPortWriteMode.toVRAM;
        this.readBufferByte=0;
        this.statusFlags=0;

        this.nameTableBaseAddress=0;
        this.spriteAttributeTableBaseAddress=0;
        this.spritePatternGeneratorBaseAddress=0;

        this.vcounter=0;
        this.hcounter=0;

        this.register00=0;
        this.register01=0;
        this.register06=0;
        this.register08=0;
        this.register09=0;
        this.register0a=0; // line counter

        this.glbResolutionX=256;
        this.glbResolutionY=192;
        this.glbFrameBuffer=new Uint8ClampedArray(this.glbResolutionX*this.glbResolutionY*4);
        this.glbImgData=undefined;
        this.glbCanvasRenderer=undefined;
    }

    writeByteToRegister(registerIndex, dataByte)
    {
        console.log("VDP::write byte 0x"+dataByte.toString(16).padStart(2,'0')+" to register "+registerIndex);

        if (registerIndex==0)
        {
            /* Register $00 - Mode Control No. 1 */
            this.register00=dataByte;

            //D4 - (IE1) 1= Line interrupt enable
            if (this.register00&0x10)
            {
                console.log("VDP::warning: line interrupt enabled");
            }
        }
        else if (registerIndex==1)
        {
            /*  Register $01 - Mode Control No. 2 */
            this.register01=dataByte;
        }
        else if (registerIndex==2)        
        {
            /*  Register $02 - Name Table Base Address */
            this.nameTableBaseAddress = dataByte;
        }
        else if (registerIndex==5)
        {
            /*  Register $05 - Sprite attribute Table Base Address */
            this.spriteAttributeTableBaseAddress = (dataByte & 0x7e) << 7;
        }
        else if (registerIndex==6)
        {
            /*  Register $06 - Sprite pattern generator Base Address */
            this.spritePatternGeneratorBaseAddress=(dataByte & 0x04) << 11;
            this.register06=dataByte;
        }
        else if (registerIndex==8)
        {
            /* Register $08 - Background X Scroll */
            this.register08=dataByte;
        }
        else if (registerIndex==9)
        {
            /* Register $09 - Background Y Scroll */
            this.register09=dataByte;
        }
        else if (registerIndex==0x0a)
        {
            /* Register $0A - Line counter */
            this.register0a=dataByte;
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
            this.dataPortReadWriteAddress = (this.dataPortReadWriteAddress & 0x3f00) | b;
		} 
        else 
        {
			this.controlWord=(this.controlWord&0xff) | ((b&0x3f)<<8);
			this.controlWordFlag=false;

			let controlCode=(b>>6)&3;
			this.dataPortReadWriteAddress=(this.controlWord&0x3fff);        

            //console.log("VDP::word written to control port, controlCode "+controlCode.toString(16)+" address "+this.dataPortReadWriteAddress.toString(16));

            if (controlCode==0)
            {
                this.dataPortWriteMode = vdpDataPortWriteMode.toVRAM;

				this.readBufferByte = this.vRam[this.dataPortReadWriteAddress&0x3fff]&0xff;

				this.dataPortReadWriteAddress++;
				this.dataPortReadWriteAddress &= 0x3fff;                
            }
            else if (controlCode==1)
            {
                this.dataPortWriteMode=vdpDataPortWriteMode.toVRAM;
            }
            else if (controlCode==2)
            {
                //this.dataPortWriteMode=vdpDataPortWriteMode.toVRAM;

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
		this.readBufferByte=b;

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
    }

    readByteFromDataPort()
    {
		this.controlWordFlag = false;

		let byte = this.readBufferByte;
		this.readBufferByte = this.vRam[this.dataPortReadWriteAddress];

		this.dataPortReadWriteAddress++;
		this.dataPortReadWriteAddress &= 0x3fff;

		return byte;
	}    

    /*
        Reading the control port returns a byte containing status flags:

        MSB                         LSB
        INT OVR COL --- --- --- --- ---
    */    

    readByteFromControlPort()
    {
		this.controlWordFlag = false;
		var currentStatusFlags = this.statusFlags;

		// Clear the flags.
		this.statusFlags &= 0x1f;
		currentStatusFlags |= 0x1f;

		return currentStatusFlags;
	}    

    readDataPort(p)
    {
        if (p==0x7e)
        {
            return this.vcounter;
        }

        return 0;
    }

    drawTiledbg(ctx,addr,x,y,pal)
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
                var curbyte=this.colorRam[cramIdx+(pal*16)];
                var red=(curbyte&0x03)*64;
                var green=((curbyte>>2)&0x03)*64;
                var blue=((curbyte>>4)&0x03)*64;

                ctx.fillStyle = "rgba("+red+","+green+","+blue+",1)"; 
                ctx.fillRect(x+xt,y+yt,1,1);
            }

            addr+=4;
        }        
    }

    drawTile(ctx,addr,x,y,pal,fliph,flipv)
    {
        var addrInc=4;
        if (flipv) 
        {
            addr+=7*4;
            addrInc=-4;
        }

        for (var yt=0;yt<8;yt++)
        {
            for (var xt=0;xt<8;xt++)
            {
                var byte0=this.vRam[addr]
                var byte1=this.vRam[addr+1]
                var byte2=this.vRam[addr+2]
                var byte3=this.vRam[addr+3]

                if (fliph)
                {
                    byte0>>=xt; byte0&=1;
                    byte1>>=xt; byte1&=1;
                    byte2>>=xt; byte2&=1;
                    byte3>>=xt; byte3&=1;
                }
                else
                {
                    byte0>>=(7-xt); byte0&=1;
                    byte1>>=(7-xt); byte1&=1;
                    byte2>>=(7-xt); byte2&=1;
                    byte3>>=(7-xt); byte3&=1;
                }

                var cramIdx=(byte0|(byte1<<1)|(byte2<<2)|(byte3<<3))&0x0f;
                var curbyte=this.colorRam[cramIdx+(pal*16)];
                var red=(curbyte&0x03)*64;
                var green=((curbyte>>2)&0x03)*64;
                var blue=((curbyte>>4)&0x03)*64;

                var xtile=x+xt;
                var ytile=y+yt;

                if ((xtile>=0)&&(xtile<256)&&(ytile>=0)&&(ytile<192))
                {
                    this.glbFrameBuffer[(x+xt+((y+yt)*this.glbResolutionX))*4+0]=red;
                    this.glbFrameBuffer[(x+xt+((y+yt)*this.glbResolutionX))*4+1]=green;
                    this.glbFrameBuffer[(x+xt+((y+yt)*this.glbResolutionX))*4+2]=blue;
                    this.glbFrameBuffer[(x+xt+((y+yt)*this.glbResolutionX))*4+3]=255;
                }
            }

            addr+=addrInc;
        }        
    }

    drawSprite(addr,spriteX,spriteY)    
    {
        addr+=this.spritePatternGeneratorBaseAddress;

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

                var cramIdx=(byte0|(byte1<<1)|(byte2<<2)|(byte3<<3))&0x0f;
                var curbyte=this.colorRam[cramIdx+(16)];

                if (cramIdx!=0)
                {
                    var red=(curbyte&0x03)*64;
                    var green=((curbyte>>2)&0x03)*64;
                    var blue=((curbyte>>4)&0x03)*64;

                    const cx=spriteX+xt;
                    const cy=spriteY+yt;

                    if ((cx>=0)&&(cx<this.glbResolutionX)&&(cy>=0)&&(cy<this.glbResolutionY))
                    {
                        this.glbFrameBuffer[(spriteX+xt+((spriteY+yt)*this.glbResolutionX))*4+0]=red;
                        this.glbFrameBuffer[(spriteX+xt+((spriteY+yt)*this.glbResolutionX))*4+1]=green;
                        this.glbFrameBuffer[(spriteX+xt+((spriteY+yt)*this.glbResolutionX))*4+2]=blue;
                        this.glbFrameBuffer[(spriteX+xt+((spriteY+yt)*this.glbResolutionX))*4+3]=255;
                    }
                }
            }

            addr+=4;
        }        
    }

    debugTiles(ctx,x,y)
    {
        var addrInMemory=0;
        for (var ytile=0;ytile<32;ytile++)
        {
            for (var xtile=0;xtile<16;xtile++)
            {
                //this.drawTiledbg(ctx,addrInMemory,x+(xtile*8),y+(ytile*8),0);
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

    hyperBlit(ctx)
    {
        if (this.glbImgData==undefined) this.glbImgData = ctx.getImageData(0, 0, this.glbResolutionX,this.glbResolutionY);
        this.glbImgData.data.set(this.glbFrameBuffer);
    
        if (this.glbCanvasRenderer==undefined)
        {
            this.glbCanvasRenderer = document.createElement('canvas');
            this.glbCanvasRenderer.width = this.glbImgData.width;
            this.glbCanvasRenderer.height = this.glbImgData.height;
        }
        this.glbCanvasRenderer.getContext('2d', { willReadFrequently: true }).putImageData(this.glbImgData, 0, 0);
        ctx.drawImage(this.glbCanvasRenderer,0,0,this.glbResolutionX,this.glbResolutionY);
    }

    update(theCPU,cycles)
    {
        // TODO check this
        this.hcounter+=cycles;
        if (this.hcounter>=this.clockCyclesPerScanline)
        {
            this.hcounter%=this.clockCyclesPerScanline;

            if (this.currentScanlineIndex == 219) 
            {
                this.vcounter = 213;
            } 
            else 
            {
                this.vcounter++;
                this.vcounter&=0xff;
            }

            if (this.currentScanlineIndex==192)
            {
                this.statusFlags|=0x80;
            }

            if (this.currentScanlineIndex==193)
            {
                if (this.register01&0x20)
                {
                    theCPU.raiseMaskableInterrupt();
                }
            }

            this.currentScanlineIndex++;
            if (this.currentScanlineIndex == 262) 
            {
                this.currentScanlineIndex = 0;
            }            
        }
    }

    /*
        Each word in the name table has the following layout:

        MSB          LSB
        ---pcvhn nnnnnnnn

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
        // check for blanked display
        // D6 - (BLK) 1= Display visible, 0= display blanked.

        if (!(this.register01&0x40))
        {
            // display is blanked
            for (var i=0;i<(this.glbResolutionX*this.glbResolutionY*4);i+=4)
            {
                this.glbFrameBuffer[i]=0;
                this.glbFrameBuffer[i+1]=0;
                this.glbFrameBuffer[i+2]=0;
                this.glbFrameBuffer[i+3]=255;
            }

            return;
        }

        // background tiles
        var nameTableBaseAddress=((this.nameTableBaseAddress>>1)&0x07)<<11;

        var screenMap=Array();
        for (var y=0;y<28;y++)
        {
            for (var x=0;x<32;x++)
            {
                var word=this.vRam[nameTableBaseAddress];
                word|=this.vRam[nameTableBaseAddress+1]<<8;
                screenMap.push(word);
                nameTableBaseAddress+=2;             
            }
        }

        var initialTile=32-((this.register08)>>3);
        const finescrollx=this.register08&0x7;
        var initialRow=Math.floor((this.register09)/8);
        const finescrolly=-(this.register09%8);

        for (var y=0;y<24;y++)
        {
            for (var x=0;x<32;x++)
            {
                const word=screenMap[((x+initialTile)%32)+(((y+initialRow)%28)*32)];

                const flipH=(word>>9)&0x01;
                const flipV=(word>>10)&0x01;
                const pal=(word>>11)&0x01;
                const priFlag=(word>>12)&0x01;

                this.drawTile(ctx,(word&0x1ff)*32,(x*8)+finescrollx,(y*8)+finescrolly,pal,flipH,flipV);   
            }
        }

        // sprites
        var sat=this.spriteAttributeTableBaseAddress;

        for (var s = 0; s < 64; s++) 
        {
			var spriteY=this.vRam[sat+s];
			if (spriteY == 0xd0)
            {
				break;
			}
			spriteY++;

            //if (spriteY >= 240) spriteY -= 256;

            var spriteX=this.vRam[sat + (s*2) +(0x10*0x8)];

            if (this.register00&0x08)
            {
                spriteX-=8;
            }

            var spriteIdx=this.vRam[sat + (s*2) +(0x10*0x8)+1];

            this.drawSprite(spriteIdx*32,spriteX,spriteY);

            // check for 8x16 sprites

            if (this.register00&0x04) // Mode4
            {
                if (this.register01&0x02)
                {
                    // sprites are 8x16, draw second half
                    spriteIdx++;
                    this.drawSprite(spriteIdx*32,spriteX,spriteY+8);
                }
            }

        }
    }
}
