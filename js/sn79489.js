/* SN79489 soundchip - vic's not vic ii */

/*
    The SN76489 has 8 "registers" - 4 x 4 bit volume registers, 3 x 10 bit
    tone registers and 1 x 4 bit noise register*.

    Channel   Volume registers   Tone/noise registers
    0 (%00)       Vol0                Tone0
    1 (%01)       Vol1                Tone1
    2 (%10)       Vol2                Tone2
    3 (%11)       Vol3                Noise
*/

class sn79489
{
    constructor()
    {
        this.volregister=[0xf,0xf,0xf,0xf];
        this.toneregister=[0,0,0,0];

        this.chan2belatched=0;
        this.what2latch=0;
        this.data=0x0;
    }

    writeByte(b)
    {
        if (b&0x80)
        {
            /* If bit 7 is 1 then the byte is a LATCH/DATA byte. */

            this.chan2belatched=(b>>5)&0x03;
            this.what2latch=(b>>4)&0x01; /* Bit 4 determines whether to latch volume (1) or tone/noise (0) data */
            this.data=b&0xf;

            if (this.what2latch==1)
            {
                this.volregister[this.chan2belatched]=this.data;
            }
            else
            {
                this.toneregister[this.chan2belatched]|=this.data;
            }
        }
        else
        {
            /* If bit 7 is 0 then the byte is a DATA byte. */

            /*If the currently latched register is a tone register then the low 6
            bits of the byte are placed into the high 6 bits of the latched
            register. Otherwise, the low 4 bits are placed into the low 4 bits
            of the relevant register*.*/

            if (this.what2latch==1)
            {
                this.volregister[this.chan2belatched]=b&0xf;
            }
            else
            {
                this.toneregister[this.chan2belatched]|=(b&0x3f)<<6;
            }
        }
    }
}
