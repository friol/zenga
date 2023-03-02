/* sms mmu */

class smsMmu
{
    constructor(theCart,theVDP,theSoundchip)
    {
        this.theCartridge=theCart;
        this.theVDP=theVDP;
        this.theSoundchip=theSoundchip;

        // system RAM

        this.ram8k=new Array(0x2000);
        for (var i=0;i<0x2000;i++)
        {
            this.ram8k[i]=0;
        }

        // SEGA mapper

        this.portAB=0xff;
        this.mapperSlot2IsCartridgeRam = false;

        this.cartridgeRam=new Array(0x4000);
        for (var i=0;i<0x4000;i++)
        {
            this.cartridgeRam[i]=0;
        }

        this.romBanks = [];
        this.mapperSlots = [];
        this.mapperSlotsIdx = [];
        
        for (let i = 0; i < 64; i++) 
        {
			this.romBanks[i] = new Uint8Array(0x4000);
		}

		for (let i = 0; i < 3; i++) 
        {
			this.mapperSlots[i] = null;
		}

        // blank romBanks
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

        this.numRealBanks=theCart.cartridgeRom.length/0x4000;

        // copy cartridge into banks
        for (let i = 0; i < theCart.cartridgeRom.length; i++) 
        {
            this.romBanks[bankIndex][bankByteIndex] = theCart.cartridgeRom[i];
            bankByteIndex++;

            if (bankByteIndex == 0x4000) 
            {
                bankIndex++;
                bankByteIndex = 0;
            }
        }

        // SEGA mapper
        for (let i = 0; i < 3; i++) 
        {
            this.mapperSlots[i] = i < this.romBanks.length ? this.romBanks[i] : null;
            this.mapperSlotsIdx[i] = i < this.romBanks.length ? i : -1;
        }

        console.log("MMU::Inited");
    }

    readAddr(addr)
    {
        addr&=0xffff;

        /* When mapping in slot 0, the first 1KB is unaffected, in order to preserve the interrupt vectors. */
        if (addr <= 0x03ff) 
        {
            return this.romBanks[0][addr];
		} 
        else if (addr <= 0x3fff) 
        {
			// ROM mapper slot 0.
			let mapperSlot = this.mapperSlots[0];
			const byte = mapperSlot != null ? mapperSlot[addr] : 0;
            return byte;
		} 
        else if (addr <= 0x7fff) 
        {
			// ROM mapper slot 1.
			let mapperSlot = this.mapperSlots[1];
			const byte = mapperSlot != null ? mapperSlot[addr - 0x4000] : 0;
            return byte;
		} 
        else if (addr <= 0xbfff) 
        {
			// ROM/RAM mapper slot 2.
			if (this.mapperSlot2IsCartridgeRam) 
            {
				return this.cartridgeRam[addr - 0x8000];
			} 
            else 
            {
				let mapperSlot = this.mapperSlots[2];
				const byte = mapperSlot != null ? mapperSlot[addr - 0x8000] : 0;
                return byte;
			}
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
        if ((addr>=0x8000)&&(addr<=0xbfff))
        {
			if (this.mapperSlot2IsCartridgeRam) 
            {
				// ROM/RAM mapper slot 2.
				this.cartridgeRam[addr - 0x8000] = value;
			} 
            else 
            {
				// We can't write to this!
				console.log("MMU::can't write to address: " + addr.toString(16));
			}
		}        
        else if ((addr>=0xc000)&&(addr<=0xdfff))
        {
            this.ram8k[addr-0xc000]=value;
        }
        else if ((addr>=0xe000)&&(addr<=0xffff))
        {
            this.ram8k[addr-0xe000]=value;

            // SEGA mapper control addresses
            if (addr == 0xfffc) 
            {
                this.setMapperControl(value);
            } 
            else if (addr == 0xfffd) 
            {
                this.setMapperSlot(0, value);
            } 
            else if (addr == 0xfffe) 
            {
                this.setMapperSlot(1, value);
            } 
            else if (addr == 0xffff) 
            {
                this.setMapperSlot(2, value);
            }            
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

    //

    setMapperControl(byte) 
    {
		// Check bit 0-1: Bank shift.
		let bankShift = byte & 0x03;
		if (bankShift != 0) 
        {
			throw 'Unimplemented ROM bank shift.';
		}

		// Check bit 2: RAM bank select.
		if ((byte & 0x04) > 0) 
        {
			throw 'Unimplemented RAM bank select.';
		}

		// Check bit 3: System RAM override.
		if ((byte & 0x10) > 0) 
        {
			throw 'Unimplemented system RAM override.';
		}

		// Check bit 4: Cartridge RAM enable slot 2).
		this.mapperSlot2IsCartridgeRam = (byte & 0x08) > 0;
	}

	setMapperSlot(slotIndex, byte) 
    {
		let bankIndex = byte&(this.numRealBanks-1);

		this.mapperSlots[slotIndex] = this.romBanks[bankIndex];
        this.mapperSlotsIdx[slotIndex]=bankIndex;

		//this.log('Mapper slot ' + slotIndex + ' set to ROM bank ' + byte + '.');
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
            this.theSoundchip.writeByte(v);
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
            if (port==0xde) return 0xff;
            if (port==0xdf) return 0xff; // Unknown use
            if (port==0xf2) return 0; // YM2413            

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
