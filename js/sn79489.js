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

        //
        // audio engine
        //

        this.eventsQueue=new Array();
        this.internalClock=0;
        this.internalClockPos=0;

        this.audioInitialized=false;
    }

    startMix(thecpu)
    {
        try 
        {
            this.audioEnabled=true;
            //this.audioEnabled=false;
            //return;

            this.audioBufSize=1024;

            var self=this;
            this.webAudioAPIsupported=true;
    
            window.AudioContext = window.AudioContext||window.webkitAudioContext;
            this.context = new AudioContext();
    
            this.gainNode = this.context.createGain();
            this.gainNode.gain.value = 0.5;
    
            this.jsNode = this.context.createScriptProcessor(this.audioBufSize, 0, 2);
            this.jsNode.onaudioprocess = function(e)
            {
                self.mixFunction(e);
            }
    
            this.jsNode.connect(this.gainNode);
    
            this.gainNode.connect(this.context.destination);

            this.multiplier=Math.floor(thecpu.clockRate/this.jsNode.context.sampleRate);
            this.sampleArray=new Array(this.multiplier);
            for (var i=0;i<this.multiplier;i++)
            {
                this.sampleArray[i]=0.0;
            }

            this.audioInitialized=true;
        }
        catch(e) 
        {
            alert('Error: Web Audio API is not supported in this browser. Buy a new one.');
            this.webAudioAPIsupported=false;
        }        
    }

    step(totCpuCycles)
    {
        this.internalClock=totCpuCycles;
    }

    mixFunction(e)
    {
        if (!this.audioEnabled) return;
        if (!this.audioInitialized) return;

        var dataL = e.outputBuffer.getChannelData(0);
        var dataR = e.outputBuffer.getChannelData(1);

        var numClocksToCover=this.internalClock-this.internalClockPos;
        if (numClocksToCover<=0) return;
        var realStep=numClocksToCover/(this.multiplier*this.audioBufSize);


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
