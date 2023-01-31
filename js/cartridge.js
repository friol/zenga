/* cartridge */

class cartridge
{
    constructor()
    {
        this.cartridgeSize=0;
        this.cartridgeRom=[];
    }

    load(buf)
    {
        this.cartridgeSize=buf.byteLength;

        var uint8ArrayNew  = new Uint8Array(buf);

        for (var b=0;b<this.cartridgeSize;b++)
        {
            this.cartridgeRom.push(uint8ArrayNew[b]);
        }

    }
}
