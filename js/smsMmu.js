/* sms mmu */

class smsMmu
{
    constructor(theCart,theVDP)
    {
        this.theCartridge=theCart;
        this.theVDP=theVDP;

        // system RAM

        this.ram8k=new Array(0x2000);
        for (var i=0;i<0x2000;i++)
        {
            this.ram8k[i]=0;
        }

        // SEGA mapper

        this.cartridgeRam=new Uint8Array(0x4000);
        for (var i=0;i<0x4000;i++)
        {
            this.cartridgeRam[i]=0;
        }

        this.romBanks = [];
        this.mapperSlots = [];
        
        for (let i = 0; i < 64; i++) 
        {
			this.romBanks[i] = new Uint8Array(0x4000);
		}

		for (let i = 0; i < 3; i++) 
        {
			this.mapperSlots[i] = null;
		}

        for (let i = 0; i < this.romBanks.length; i++) 
        {
			var romBank = this.romBanks[i];

			for (let j = 0; j < romBank.length; j++) 
            {
				romBank[j] = 0;
			}
		}        

    	let bankIndex = 0;
    	let bankByteIndex = 0;

        for (let i = 0; i < theCart.cartridgeRom.length; i++) 
        {
            this.romBanks[bankIndex][bankByteIndex] = theCart.cartridgeRom[i];
            bankByteIndex++;

            if (bankByteIndex == 0x4000) 
            {
                bankIndex++;
                bankByteIndex = 0;
                console.log('MMU::Loading bank ' + bankIndex);
            }
        }

        // SEGA mapper
        for (let i = 0; i < 3; i++) 
        {
            this.mapperSlots[i] = i < this.romBanks.length ? this.romBanks[i] : null;
        }

        //

        this.portAB=0xff;
        this.mapperSlot2IsCartridgeRam = false;

        console.log("MMU::Inited");
    }

    readAddr(addr)
    {
        addr&=0xffff;

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
            return 0;
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

    // I/O ports&input

    pressButton1()
    {
        this.portAB&=0xff^0x10;
    }

    depressButton1()
    {
        this.portAB|=0x10;
    }

    pressButton2()
    {
        this.portAB&=0xff^0x20;
    }

    depressButton2()
    {
        this.portAB|=0x20;
    }

    pressDown()
    {
        this.portAB&=0xff^0x02;
    }

    depressDown()
    {
        this.portAB|=0x02;
    }

    pressUp()
    {
        this.portAB&=0xff^0x01;
    }

    depressUp()
    {
        this.portAB|=0x01;
    }

    pressLeft()
    {
        this.portAB&=0xff^0x04;
    }

    depressLeft()
    {
        this.portAB|=0x04;
    }

    pressRight()
    {
        this.portAB&=0xff^0x08;
    }

    depressRight()
    {
        this.portAB|=0x08;
    }

    //

    writePort(port,v)
    {
        if ((port >= 0x40) && (port <= 0x7f))
        {
            // TODO soundchip
		} 
        else if ((port >= 0x80) && (port <= 0xbf))
        {
			if ((port % 2) == 0) 
            {
                this.theVDP.writeByteToDataPort(v);
			} 
            else 
            {
                this.theVDP.writeByteToControlPort(v);
			}
		} 
        else if ((port >= 0xc0) && (port <= 0xff))
        {
			// No effect.
		}
        else
        {
            console.log("MMU::write to unhandled port "+port.toString(16)+" of value "+v);
        }

    }

    readPort(port)
    {
        if ((port >= 0x40) && (port < 0x80))
        {
            // Reads from even addresses return the V counter
            // Reads from odd addresses return the H counter
            if ((port & 0x01) == 0x00)
            {
                return this.theVDP.readDataPort(0x7e);
            }
            else
            {
                return this.theVDP.readDataPort(0x7f);
            }
        }
        else if (port >= 0x80 && port <= 0xbf) 
        {
			if (port % 2 == 0) 
            {
				return this.theVDP.readByteFromDataPort();
			} 
            else 
            {
				return this.theVDP.readByteFromControlPort();
			}        
        }
        else if (port >= 0xc0 && port <= 0xff) 
        {
			if (port % 2 == 0) 
            {
                // TODO
                return this.portAB;
			} 
            else 
            {
                // TODO
				//return this.input.readByteFromPortBMisc();
                return 0xff;
			}
		}        
        else
        {
            console.log("MMU::reading from unknown port "+port.toString(16));
        }

        return 0;
    }

}
