/* sms VDP, derived from the Texas Instruments TMS9918 */

class smsVDP
{
    constructor()
    {
        this.colorRam=new Array();
        for (var c=0;c<32;c++)
        {
            this.colorRam.push(0);            
        }

        this.vRam=new Array();
        for (var b=0;b<0x4000;b++)
        {
            this.vRam.push(b);            
        }
    }


}
